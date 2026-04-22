
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { ethers } from 'ethers';
import * as crypto from 'crypto';
import { defaultMarketConfig } from 'src/libs/market.config';
import { Cell, getCellId } from 'src/libs/cell';
import { EventName } from 'src/modules/socket/types';
import { BigNumber } from 'bignumber.js';
import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://localhost:5001/api';
const WSS_URL = 'http://localhost:5001';
const TIMEOUT_MS = 15000;

// Params
const NUM_USERS = process.env.N ? parseInt(process.env.N) : 10;
const ORDERS_PER_USER = process.env.M ? parseInt(process.env.M) : 10;
const P95_THRESHOLD = process.env.P95 ? parseInt(process.env.P95) : 30;
const P99_THRESHOLD = process.env.P99 ? parseInt(process.env.P99) : 50;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface OrderTiming {
    start: number;
    end?: number;
    duration?: number;
    orderId?: string;
    success: boolean;
}

interface User {
    id: number;
    wallet: ethers.HDNodeWallet;
    address: string;
    accessToken?: string;
    wssKey?: string;
    socket?: Socket;
    orders: OrderTiming[]; // Track M orders
    activeOrdersCount: number;
    completedOrdersCount: number;
}

let currentGrid: Cell[] = [];
let currentPrice: number = 0;

async function setupUser(index: number): Promise<User> {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const user: User = {
        id: index,
        wallet,
        address,
        orders: [],
        activeOrdersCount: 0,
        completedOrdersCount: 0
    };

    try {
        const challengeRes = await axios.get(`${API_URL}/auth/challenge`, { params: { address } });
        const challenge = challengeRes.data.challenge;
        const signature = await wallet.signMessage(challenge);
        const loginRes = await axios.post(`${API_URL}/auth/login`, { address, signature });
        user.accessToken = loginRes.data.accessToken;

        const wssKeyRes = await axios.get(`${API_URL}/auth/wss-key`, {
            headers: { Authorization: `Bearer ${user.accessToken}` }
        });
        user.wssKey = wssKeyRes.data.key;

        // Deposit enough for M orders
        await axios.post(`${API_URL}/payment/debug/deposit`, {
            amount: (1000 * ORDERS_PER_USER).toString(),
            txHash: ethers.hexlify(ethers.randomBytes(32)),
            logIndex: 0
        }, {
            headers: { Authorization: `Bearer ${user.accessToken}` }
        });

        const wssChallengeRes = await axios.get(`${API_URL}/auth/challenge`, { params: { address } });
        const wssChallenge = wssChallengeRes.data.challenge;
        const socket: Socket = io(WSS_URL);
        user.socket = socket;

        return new Promise((resolve) => {
            socket.on('connect', () => {
                const message = address;
                const hmac = crypto.createHmac('sha256', Buffer.from(user.wssKey!, 'hex'));
                hmac.update(message);
                hmac.update(wssChallenge);
                const wssSignature = hmac.digest('hex');

                socket.emit('subscribe_user', {
                    userId: address,
                    signature: wssSignature
                });
            });

            socket.on('subscribed', (data) => {
                if (data.status === 'success' && data.room.includes('user:')) {
                    resolve(user);
                }
            });

            if (index === 0) {
                const events = Object.values(EventName);
                events.forEach(evt => {
                    socket.on(evt, (data) => {
                        if (evt === EventName.GridUpdate) {
                            currentGrid = data;
                        } else if (evt === EventName.PriceNow) {
                            currentPrice = data.price;
                        }
                    });
                });
            }
        });

    } catch (err: any) {
        console.error(`User ${index} setup failed:`, err.message);
        throw err;
    }
}

async function run() {
    console.log(`--- Starting E2E SLO Benchmark ---`);
    console.log(`N (Users) = ${NUM_USERS}`);
    console.log(`M (Orders/User) = ${ORDERS_PER_USER}`);
    console.log(`P95 Threshold = ${P95_THRESHOLD}ms`);
    console.log(`P99 Threshold = ${P99_THRESHOLD}ms`);

    // Preparation Phase
    console.log('--- Preparation Phase: Login & Deposit ---');
    const userPromises: Promise<User>[] = [];
    for (let i = 0; i < NUM_USERS; i++) {
        userPromises.push(setupUser(i));
    }
    const users = await Promise.all(userPromises);
    console.log(`All ${NUM_USERS} users prepared and connected.`);

    // Wait for Grid data
    console.log('Waiting for grid data...');
    while (!currentGrid.length || !currentPrice) {
        await sleep(500);
    }
    await sleep(2000);

    const now = Date.now();
    // We need M valid cells. 
    // Filter cells that are valid for placing orders (time constraint)
    const validCells = currentGrid
        .filter(cell => cell.startTs > now + defaultMarketConfig.gridXSize + 1000)
        .sort((a, b) => a.startTs - b.startTs); // Sort by time

    if (validCells.length < ORDERS_PER_USER) {
        console.warn(`Warning: Only found ${validCells.length} valid cells, but need ${ORDERS_PER_USER} per user based on M.`);
        // Proceed with what we have or abort? 
        // Let's abort to be safe, user requested M orders.
        // Assuming user will ensure grid is large enough or M is small enough.
        console.error("Not enough valid cells on grid. Benchmark aborted.");
        process.exit(1);
    }

    // Select M target cells
    const targetCells = validCells.slice(0, ORDERS_PER_USER);
    console.log(`Selected ${targetCells.length} target cells.`);

    const marketId = 'BTCUSDT';
    const amount = '10';

    // Prepare Listeners
    let totalOrdersCompleted = 0;
    const totalExpectedOrders = NUM_USERS * ORDERS_PER_USER;

    users.forEach(u => {
        u.socket!.on('order_update', (data) => {
            if (data.status === 'OPEN' && data.userId === u.address) {
                // Find matching pending order? 
                // Since we send M orders for M DIFFERENT cells, we can match by cellId or infer by order. 
                // However, without explicitly passed ID back or complex matching, 
                // we can assume FIFO or just find the first order for this cell that isn't finished.
                // data.cell contains the cell info.

                // Let's try to match by cellId if possible, order update usually contains cell info or orderId.
                // The order update message structure:
                /* 
                export interface OrderUpdateMessage {
                    orderId: string;
                    userId: string;
                    marketId: string;
                    cell: Cell;
                    status: OrderStatus;
                    ...
                }
                */
                // Yes, it has `cell`.
                const cellId = getCellId(data.cell);

                // Find order record for this user that matches this cell and has no end time
                // We stored M orders, we can store their expected cellId.
                const orderRecord = u.orders.find(o => o.orderId === `${u.address}:${cellId}`);

                if (orderRecord && !orderRecord.end) {
                    orderRecord.end = Date.now();
                    orderRecord.duration = orderRecord.end - orderRecord.start;
                    orderRecord.success = true;
                    u.completedOrdersCount++;
                    totalOrdersCompleted++;
                    process.stdout.write('.');
                }
            }
        });
    });

    // Trigger Concurrent Requests
    console.log('\n--- Benchmark Phase: Concurrent Bet Placement ---');
    console.log('Sending requests...');
    const startGlobal = Date.now();

    users.forEach(u => {
        targetCells.forEach(cell => {
            const cellId = getCellId(cell);
            const message = `${cell.gridTs}:${cellId}:${amount}`;
            const hmac = crypto.createHmac('sha256', Buffer.from(u.wssKey!, 'hex'));
            hmac.update(message);
            const signature = hmac.digest('hex');

            const payload = {
                userId: u.address,
                marketId,
                amount,
                cell: cell,
                userSignature: signature
            };

            const orderTiming: OrderTiming = {
                start: Date.now(),
                orderId: `${u.address}:${cellId}`, // Derived ID
                success: false
            };
            u.orders.push(orderTiming);

            u.socket!.emit('place_bet', payload);
        });
    });

    // Wait for completion
    const waitStart = Date.now();
    while (totalOrdersCompleted < totalExpectedOrders && (Date.now() - waitStart) < TIMEOUT_MS) {
        await sleep(100);
    }

    console.log('\n\n--- Analysis ---');

    // Collect all durations
    const allDurations: number[] = [];
    users.forEach(u => {
        u.orders.forEach(o => {
            if (o.success && o.duration) {
                allDurations.push(o.duration);
            }
        });
        u.socket!.disconnect();
    });

    if (allDurations.length === 0) {
        console.log("No successful orders.");
        process.exit(0);
    }

    allDurations.sort((a, b) => a - b);

    const getPercentile = (p: number) => {
        const index = Math.ceil((p / 100) * allDurations.length) - 1;
        return allDurations[Math.max(0, index)];
    };

    const avg = allDurations.reduce((a, b) => a + b, 0) / allDurations.length;
    const p95_val = getPercentile(95);
    const p99_val = getPercentile(99);
    const min = allDurations[0];
    const max = allDurations[allDurations.length - 1];

    console.log(`Total Orders: ${totalExpectedOrders}`);
    console.log(`Successful: ${allDurations.length}`);
    console.log(`Min: ${min}ms`);
    console.log(`Max: ${max}ms`);
    console.log(`Avg: ${avg.toFixed(2)}ms`);
    console.log(`P95: ${p95_val}ms (Threshold: ${P95_THRESHOLD}ms)`);
    console.log(`P99: ${p99_val}ms (Threshold: ${P99_THRESHOLD}ms)`);

    const p95_pass = p95_val <= P95_THRESHOLD;
    const p99_pass = p99_val <= P99_THRESHOLD;

    const resultMd = `
# Benchmark SLO Result

- **Timestamp**: ${new Date().toISOString()}
- **Parameters**: 
  - N (Users): ${NUM_USERS}
  - M (Orders/User): ${ORDERS_PER_USER}
  - P95 Threshold: ${P95_THRESHOLD}ms
  - P99 Threshold: ${P99_THRESHOLD}ms

## Statistics
- **Total Orders**: ${totalExpectedOrders}
- **Successful**: ${allDurations.length}
- **Min**: ${min}ms
- **Max**: ${max}ms
- **Avg**: ${avg.toFixed(2)}ms
- **P95**: ${p95_val}ms
- **P99**: ${p99_val}ms

## SLO Check
- **P95 Compliance**: ${p95_pass ? 'PASS' : 'FAIL'}
- **P99 Compliance**: ${p99_pass ? 'PASS' : 'FAIL'}
`;

    const resultsDir = path.join(__dirname, '../../benchmark-results');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
    }

    const filename = `slo-${NUM_USERS}-${ORDERS_PER_USER}-${P99_THRESHOLD}-${P95_THRESHOLD}-${Date.now()}.md`;
    fs.writeFileSync(path.join(resultsDir, filename), resultMd);
    console.log(`\nResults written to benchmark-results/${filename}`);
}

run().catch(console.error);

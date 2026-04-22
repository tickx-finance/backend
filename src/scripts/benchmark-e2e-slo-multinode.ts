
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

// --- CONFIGURATION ---
const DATA_WSS_URL = process.env.DATA_WSS_URL || 'http://localhost:5001'; // Source for Price/Grid
const NODES_CONFIG = process.env.NODES ? JSON.parse(process.env.NODES) : [
    { api: 'http://localhost:5002/api', ws: 'http://localhost:5002' },
    // Add more nodes here or via env var
    // { api: 'http://localhost:5003/api', ws: 'http://localhost:5003' },
    // { api: 'http://localhost:5003/api', ws: 'http://localhost:5004' }
];

const TIMEOUT_MS = 30000;

// Params
const NUM_USERS = process.env.N ? parseInt(process.env.N) : 10;
const ORDERS_PER_USER = process.env.M ? parseInt(process.env.M) : 10;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface OrderTiming {
    start: number;
    end?: number;
    duration?: number;
    orderId?: string; // We'll rely on cellId match if needed, or assume first-in-first-match per cell
    cellId: string;
    success: boolean;
}

interface User {
    id: number;
    wallet: ethers.HDNodeWallet;
    address: string;
    accessToken?: string;
    wssKey?: string;
    socket?: Socket;
    nodeIndex: number;
    orders: Record<string, OrderTiming>; // Track M orders
    completedOrdersCount: number;
}

let currentGrid: Cell[] = [];
let currentPrice: number = 0;

function getAssignedNode(index: number) {
    return { index, config: NODES_CONFIG[index % NODES_CONFIG.length] };
}

async function setupUser(index: number): Promise<User> {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const { index: nodeIndex, config: nodeConfig } = getAssignedNode(index);
    const API_URL = nodeConfig.api;
    const WSS_URL = nodeConfig.ws;

    const user: User = {
        id: index,
        wallet,
        address,
        nodeIndex,
        orders: {},
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

            // Note: Users DO NOT listen to global events (grid/price) from their node.
            // That comes from the separate DATA_WSS_URL stream managed by the main script.
        });

    } catch (err: any) {
        console.error(`User ${index} setup failed on Node ${nodeIndex}:`, err.message);
        throw err;
    }
}

async function run() {
    console.log(`--- Starting Multi-Node E2E SLO Benchmark ---`);
    console.log(`Nodes: ${NODES_CONFIG.length}`);
    console.log(`N (Users) = ${NUM_USERS}`);
    console.log(`M (Orders/User) = ${ORDERS_PER_USER}`);
    console.log(`Data WSS: ${DATA_WSS_URL}`);

    // --- Connect to Data Stream ---
    console.log('Connecting to Data Stream check price & grid...');
    const dataSocket = io(DATA_WSS_URL);
    dataSocket.on('connect', () => {
        console.log('Connected to Data WSS');
        // Assuming public events don't need auth, or we might need to auth just like a user?
        // Usually grid/price are public.
    });

    // We might need to subscribe to something if the server requires it (e.g. join 'market:BTCUSDT')
    // Assuming backend auto-emits or we need a join. 
    // The previous benchmark didn't emit 'join', so likely global broadcast or auto-join on connect?
    // Wait, previous benchmark did: socket.on('grid_update').
    // If namespaces/rooms are used, we might be missing it. 
    // `OrderGateway` handles `handleConnection`. verify-e2e didn't emit join. 

    dataSocket.on(EventName.GridUpdate, (data) => {
        currentGrid = data;
    });
    dataSocket.on(EventName.PriceNow, (data) => {
        currentPrice = data.price;
    });

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
        .sort((a, b) => a.startTs - b.startTs);

    if (validCells.length < ORDERS_PER_USER) {
        console.error(`Not enough valid cells on grid (found ${validCells.length}, need ${ORDERS_PER_USER}). Benchmark aborted.`);
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
                const cellId = getCellId(data.cell);

                // Find order record for this user that matches this cell and has no end time
                const orderRecord = u.orders[cellId];

                if (orderRecord) {
                    orderRecord.end = Date.now();
                    orderRecord.duration = orderRecord.end - orderRecord.start;
                    orderRecord.success = true;
                    u.completedOrdersCount++;
                    totalOrdersCompleted++;
                    // Optional: process.stdout.write('.');
                }
            }
        });
    });

    // Trigger Concurrent Requests
    console.log('\n--- Benchmark Phase: Concurrent Bet Placement ---');
    console.log('Sending requests...');

    const socketCalls: { socket: Socket, payload: any }[] = []
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
                cellId: cellId,
                success: false
            };
            u.orders[cellId] = orderTiming;

            socketCalls.push({ socket: u.socket!, payload })

            // u.socket!.emit('place_bet', payload);
        });
    });

    socketCalls.map(({ socket, payload }) => socket.emit('place_bet', payload))

    // Wait for completion
    const waitStart = Date.now();
    while (totalOrdersCompleted < totalExpectedOrders && (Date.now() - waitStart) < TIMEOUT_MS) {
        await sleep(100);
        process.stdout.write(`\rCompleted: ${totalOrdersCompleted}/${totalExpectedOrders}  `);
    }

    console.log('\n\n--- Analysis ---');

    const allDurations: number[] = [];
    users.forEach(u => {
        Object.values(u.orders).forEach(o => {
            if (o.success && o.duration) {
                allDurations.push(o.duration);
            }
        });
        u.socket!.disconnect();
    });
    dataSocket.disconnect();

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
    console.log(`P95: ${p95_val}ms`);
    console.log(`P99: ${p99_val}ms`);

    // Output Markdown
    const timestamp = new Date().toISOString();
    const mdContent = `
# Benchmark Results - Multi-Node

*   **Timestamp:** ${timestamp}
*   **Users (N):** ${NUM_USERS}
*   **Orders/User (M):** ${ORDERS_PER_USER}
*   **Nodes:** ${NODES_CONFIG.length}

## Metrics

| Metric | Value |
| :--- | :--- |
| **Total Orders** | ${totalExpectedOrders} |
| **Successful** | ${allDurations.length} |
| **Min Latency** | ${min} ms |
| **Max Latency** | ${max} ms |
| **Avg Latency** | ${avg.toFixed(2)} ms |
| **P95 Latency** | ${p95_val} ms |
| **P99 Latency** | ${p99_val} ms |
`;

    const resultsDir = path.join(__dirname, '../../benchmark-results');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
    }

    const filename = `multinode-slo-${Date.now()}.md`;
    const filePath = path.join(resultsDir, filename);

    fs.writeFileSync(filePath, mdContent.trim());
    console.log(`\nResults written to benchmark-results/${filename}`);
}

run().catch(console.error);

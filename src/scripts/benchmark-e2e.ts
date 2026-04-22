
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { ethers } from 'ethers';
import * as crypto from 'crypto';
import { defaultMarketConfig } from 'src/libs/market.config';
import { Cell, getCellId } from 'src/libs/cell';
import { EventName } from 'src/modules/socket/types';
import { BigNumber } from 'bignumber.js';

const API_URL = 'http://localhost:5001/api';
const WSS_URL = 'http://localhost:5001';
const NUM_USERS = process.env.NUM_USERS ? parseInt(process.env.NUM_USERS) : 10;
const TIMEOUT_MS = 10000;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface User {
    id: number;
    wallet: ethers.HDNodeWallet;
    address: string;
    accessToken?: string;
    wssKey?: string;
    socket?: Socket;
    timings: {
        start?: number;
        end?: number;
        duration?: number;
    };
    done: boolean;
}

let currentGrid: Cell[] = [];
let currentPrice: number = 0;

async function setupUser(index: number): Promise<User> {
    // 1. Generate User
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const user: User = { id: index, wallet, address, timings: {}, done: false };

    try {
        // 2a. Get Challenge
        const challengeRes = await axios.get(`${API_URL}/auth/challenge`, { params: { address } });
        const challenge = challengeRes.data.challenge;

        // 2b. Sign Challenge
        const signature = await wallet.signMessage(challenge);

        // 2c. Login
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            address,
            signature
        });
        user.accessToken = loginRes.data.accessToken;

        // 2d. Get WSS Key
        // Need to set header for this request
        const wssKeyRes = await axios.get(`${API_URL}/auth/wss-key`, {
            headers: { Authorization: `Bearer ${user.accessToken}` }
        });
        user.wssKey = wssKeyRes.data.key;

        // 3. Deposit
        await axios.post(`${API_URL}/payment/debug/deposit`, {
            amount: '100000',
            txHash: ethers.hexlify(ethers.randomBytes(32)),
            logIndex: 0
        }, {
            headers: { Authorization: `Bearer ${user.accessToken}` }
        });

        // 4. Get New Challenge for WSS
        const wssChallengeRes = await axios.get(`${API_URL}/auth/challenge`, { params: { address } });
        const wssChallenge = wssChallengeRes.data.challenge;

        // 5. Connect WSS
        const socket: Socket = io(WSS_URL);
        user.socket = socket;

        return new Promise((resolve) => {
            socket.on('connect', () => {
                // 6. Subscribe
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

            // Monitor grid updates (only need one user to update global state really, but redundancy is fine)
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
    console.log(`--- Starting E2E Benchmark with ${NUM_USERS} users ---`);

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
    await sleep(2000); // Wait a bit more for stability

    // Find a valid cell
    const now = Date.now();
    const xSize = defaultMarketConfig.gridXSize; // Verify this import path or mock it
    // Assuming defaultMarketConfig might need to be imported or hardcoded if verify-e2e had it
    // Using simple hardcoded if import fails, but verify-e2e had it. 

    // Filter valid cells
    const firstValidCells = currentGrid.filter(cell => cell.startTs > now + defaultMarketConfig.gridXSize);
    // Just pick the first valid cell structure available to use as a template, 
    // real validation might fail if logic is strict, but for benchmark we just want to emit.
    // However, verify-e2e logic:
    // const firstValidCells = currentGrid.filter(cell => cell.startTs > now + defaultMarketConfig.gridXSize);
    // const cell = firstValidCells.find(cell => BigNumber(cell.lowerPrice).lte(currentPrice) && BigNumber(cell.upperPrice).gte(currentPrice))

    // We need a cell that won't error out immediately on backend before WSS fanout? 
    // Or we just want to measure roundtrip of accept -> order_update?
    // If we place an order, we expect an 'order_update' event with status 'OPEN'.

    const targetCell = firstValidCells.find(cell => BigNumber(cell.lowerPrice).lte(currentPrice) && BigNumber(cell.upperPrice).gte(currentPrice));
    // Finding a cell that matches current price is tricky if market is volatile or mock is static. 
    // Let's relax: just pick a forward cell.
    if (!targetCell) {
        console.error("No valid future cells found. Benchmark aborted.");
        process.exit(1);
    }

    console.log('--- Benchmark Phase: Concurrent Bet Placement ---');
    console.log(`Target Cell: ID=${getCellId(targetCell)} Start=${targetCell.startTs}`);

    const marketId = 'BTCUSDT';
    const amount = '10';

    // Prepare Listeners
    let completed = 0;
    users.forEach(u => {
        u.socket!.on('order_update', (data) => {
            if (u.done) return;
            // Check if it matches our order (optional) or just take first update
            // Ideally we check orderId or something, but simplified:
            if (data.status === 'OPEN' && data.userId === u.address) {
                u.timings.end = Date.now();
                u.timings.duration = u.timings.end - u.timings.start!;
                u.done = true;
                completed++;
                process.stdout.write('.');
            }
        });
    });

    // Trigger Concurrent Requests
    console.log('\n sending requests...');
    const startGlobal = Date.now();

    users.forEach(u => {
        const message = `${targetCell!.gridTs}:${getCellId(targetCell!)}:${amount}`;
        const hmac = crypto.createHmac('sha256', Buffer.from(u.wssKey!, 'hex'));
        hmac.update(message);
        const signature = hmac.digest('hex');

        const payload = {
            userId: u.address,
            marketId,
            amount,
            cell: targetCell,
            userSignature: signature
        };

        u.timings.start = Date.now(); // approximate client send time
        u.socket!.emit('place_bet', payload);
    });

    // Wait for completion
    const waitStart = Date.now();
    while (completed < NUM_USERS && (Date.now() - waitStart) < TIMEOUT_MS) {
        await sleep(100);
    }

    console.log('\n\n--- Results ---');
    let totalDuration = 0;
    let actualCount = 0;

    users.forEach(u => {
        if (u.done && u.timings.duration) {
            console.log(`User ${u.id}: ${u.timings.duration}ms`);
            totalDuration += u.timings.duration;
            actualCount++;
        } else {
            console.log(`User ${u.id}: TIMEOUT/FAILED`);
        }
        u.socket!.disconnect();
    });

    if (actualCount > 0) {
        console.log(`\nAverage Execution Time: ${(totalDuration / actualCount).toFixed(2)}ms`);
        console.log(`Total Successful: ${actualCount}/${NUM_USERS}`);
    } else {
        console.log('No successful orders recorded.');
    }
}

run().catch(console.error);

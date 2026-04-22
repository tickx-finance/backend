
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { ethers } from 'ethers';
import * as crypto from 'crypto';
import { defaultMarketConfig } from 'src/libs/market.config';
import { Cell, getCellId, signCell } from 'src/libs/cell';
import { env } from 'src/config';

const API_URL = 'http://localhost:5001/api';
const WSS_URL = 'http://localhost:5001';

async function run() {
    console.log('--- Starting E2E Verification ---');
    console.log(`API URL: ${API_URL}`);
    console.log(`WSS URL: ${WSS_URL}`);

    // 1. Generate User
    const wallet = new ethers.Wallet('0x294e743bd73a8afae3f023ac7fba42f0b40713b91904a8a4fc46536f673971e8');
    const address = wallet.address;
    console.log(`\n1. Generated User: ${address}`);
    console.log(`   Private Key: ${wallet.privateKey}`);

    try {
        // 2. Login
        console.log('\n2. Logging In...');
        // 2a. Get Challenge
        const challengeRes = await axios.get(`${API_URL}/auth/challenge`, { params: { address } });
        const challenge = challengeRes.data.challenge;
        console.log(`   Challenge: ${challenge}`);

        // 2b. Sign Challenge
        const signature = await wallet.signMessage(challenge);
        console.log(`   Signature: ${signature}`);

        // 2c. Login
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            address,
            signature
        });
        const accessToken = loginRes.data.accessToken;
        console.log(`   Login Success! JWT obtained. ${accessToken}`);

        // 2d. Get WSS Key
        const wssKeyRes = await axios.get(`${API_URL}/auth/wss-key`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const wssKey = wssKeyRes.data.key;
        console.log(`   WSS Key: ${wssKey}`);

        // 3. Deposit
        console.log('\n3. Debug Deposit...');
        const depositAmount = '1000';
        await axios.post(`${API_URL}/payment/debug/deposit`, {
            userId: address,
            amount: depositAmount,
            txHash: ethers.hexlify(ethers.randomBytes(32)),
            logIndex: 0
        });
        console.log(`   Deposited ${depositAmount} to user.`);

        // 4. Get New Challenge for WSS user subscription
        console.log('\n4. Getting fresh challenge for WSS Subscription...');
        const wssChallengeRes = await axios.get(`${API_URL}/auth/challenge`, { params: { address } });
        const wssChallenge = wssChallengeRes.data.challenge;
        console.log(`   WSS Challenge: ${wssChallenge}`);


        // 5. Connect WSS
        console.log('\n5. Connecting to WSS...');
        const socket: Socket = io(WSS_URL);

        socket.on('connect', async () => {
            console.log('   Connected to WSS!');

            // 6. Subscribe User
            console.log('\n6. Subscribing to User Channel...');

            // Signature: HMAC(SHA256, userId + challenge, wssKey)
            // Note: The backend logic checks:
            // hmac.update(userId)
            // if (withChallenge) hmac.update(challenge)

            const message = address;
            const hmac = crypto.createHmac('sha256', Buffer.from(wssKey, 'hex'));
            hmac.update(message);
            hmac.update(wssChallenge);
            const wssSignature = hmac.digest('hex');

            socket.emit('subscribe_user', {
                userId: address,
                signature: wssSignature
            });
        });

        socket.on('subscribed', (data) => {
            console.log('   [Event] subscribed:', data);

            if (data.status === 'success' && data.room.includes('user:')) {
                // 7. Place Order
                console.log('\n7. Placing Order via WSS...');
                placeOrder(socket, address, wssKey);
            }
        });

        socket.on('exception', (data) => {
            console.error('   [Exception]', data);
        });

        // Listen for all events
        const events = [
            'grid_update', 'balance_update', 'order_update', 'deposit_success',
            'withdraw_queued', 'withdraw_cancelled', 'withdraw_success', 'error'
        ];

        events.forEach(evt => {
            socket.on(evt, (data) => {
                console.log(`   [Event] ${evt}:`, JSON.stringify(data, null, 2));
            });
        });

        socket.on('message', (msg) => {
            console.log(`   [Message] ${msg}`);
        });

    } catch (error: any) {
        if (error.response) {
            console.error('API Error:', error.response.status, error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    }
}

function placeOrder(socket: Socket, userId: string, wssKey: string) {
    const marketId = 'BTCUSDT';
    const amount = '100';

    // Create a dummy cell
    const now = Date.now();
    const startTs = now + 60000 - (now % defaultMarketConfig.gridXSize); // Next minute

    // Cell matching logic

    const cell = new Cell(startTs, startTs, startTs + defaultMarketConfig.gridXSize, '90', '110', '2', '')
    cell.gridSignature = signCell(cell, env.secret.cellSignerKey)

    // Signature for PlaceBet: HMAC(userId + ...? No)
    // Backend: message = `${cell.gridTs}:${cell.id}:${amount}`
    // authService.validateWssSignature(userId, message, userSignature, false) -> No challenge

    const message = `${cell.gridTs}:${getCellId(cell)}:${amount}`;
    const hmac = crypto.createHmac('sha256', Buffer.from(wssKey, 'hex'));
    hmac.update(message);
    const signature = hmac.digest('hex');

    const payload = {
        userId,
        marketId,
        amount,
        cell,
        userSignature: signature
    };

    console.log('   Sending place_bet:', payload);
    socket.emit('place_bet', payload);
}

run();

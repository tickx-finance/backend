import axios from 'axios';
import { Wallet } from 'ethers';

const API_URL = 'http://localhost:3000';

async function verifyAuth() {
    try {
        console.log('--- Starting Auth Verification ---');

        // 1. Create Wallet
        const wallet = Wallet.createRandom();
        const address = wallet.address;
        console.log(`1. Created wallet: ${address}`);

        // 2. Get Challenge
        console.log('2. Requesting challenge...');
        const challengeRes = await axios.get(`${API_URL}/auth/challenge`, { params: { address } });
        const challenge = challengeRes.data.challenge;
        console.log(`   Challenge received: "${challenge}"`);

        // 3. Sign Challenge
        console.log('3. Signing challenge...');
        const signature = await wallet.signMessage(challenge);
        console.log(`   Signature: ${signature.substring(0, 20)}...`);

        // 4. Login
        console.log('4. Logging in...');
        const loginRes = await axios.post(`${API_URL}/auth/login`, { address, signature });
        const { accessToken, wssKey, wssKeyExpiresAt } = loginRes.data;
        console.log('   Login successful!');
        console.log(`   JWT: ${accessToken.substring(0, 20)}...`);
        console.log(`   WSS Key: ${wssKey}`);
        console.log(`   WSS Expires: ${wssKeyExpiresAt}`);

        // 5. Verify WSS Key retrieval with JWT
        console.log('5. Requesting new WSS key with JWT...');
        const wssKeyRes = await axios.post(
            `${API_URL}/auth/wss-key`,
            {},
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        console.log(`   New WSS Key: ${wssKeyRes.data.key}`);

        console.log('--- Verification Passed ---');

    } catch (error: any) {
        console.error('--- Verification Failed ---');
        console.error(error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }
}

verifyAuth();

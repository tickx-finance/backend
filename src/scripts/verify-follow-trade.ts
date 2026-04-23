import { createHmac } from 'crypto';
import { io, Socket } from 'socket.io-client';
import { Wallet } from 'ethers';

type SignerLike = {
    address: string;
    signMessage(message: string): Promise<string>;
};

type AuthResponse = {
    accessToken: string;
    wssKey: string;
    wssKeyExpiresAt: number;
};

type GridCell = {
    gridTs: number;
    startTs: number;
    endTs: number;
    lowerPrice: string;
    upperPrice: string;
    rewardRate: string;
    gridSignature: string;
};

type FollowedOrderUpdate = {
    targetUserId: string;
    orderId: string;
    marketId: string;
    amount: string;
    cell: GridCell;
    status: string;
    settledTimestamp?: number;
    settledWin?: boolean;
};

const APP_ORIGIN = process.env.VERIFY_APP_ORIGIN ?? 'http://localhost:5001';
const API_BASE_URL = process.env.VERIFY_API_BASE_URL ?? `${APP_ORIGIN}/api`;
const SOCKET_URL = process.env.VERIFY_SOCKET_URL ?? APP_ORIGIN;
const MARKET_ID = process.env.VERIFY_MARKET_ID ?? 'BTCUSDT';
const ORDER_AMOUNT = process.env.VERIFY_ORDER_AMOUNT ?? '100';
const REQUEST_TIMEOUT_MS = Number(process.env.VERIFY_REQUEST_TIMEOUT_MS ?? 15000);
const SOCKET_TIMEOUT_MS = Number(process.env.VERIFY_SOCKET_TIMEOUT_MS ?? 30000);

async function main() {
    const userA = Wallet.createRandom();
    const userB = Wallet.createRandom();

    console.log(`Using API: ${API_BASE_URL}`);
    console.log(`Using socket: ${SOCKET_URL}`);
    console.log(`User A (target): ${userA.address}`);
    console.log(`User B (follower): ${userB.address}`);

    const authA = await loginWallet(userA);
    const authB = await loginWallet(userB);
    console.log('Logged in both users');

    await faucetDeposit(authA.accessToken, ORDER_AMOUNT);
    console.log(`Deposited ${ORDER_AMOUNT} to user A`);

    await registerFollow(authB.accessToken, userA.address);
    console.log('User B now follows user A');

    const subscribeChallengeB = await getChallenge(userB.address);
    const socketB = io(SOCKET_URL, {
        transports: ['websocket'],
        timeout: SOCKET_TIMEOUT_MS,
    });

    try {
        await waitForSocketConnect(socketB);
        console.log('Follower socket connected');

        const subscribed = waitForEvent<{ room: string; status: string }>(socketB, 'subscribed', SOCKET_TIMEOUT_MS);
        socketB.emit('subscribe_order_follows', {
            userId: userB.address,
            targetUserId: userA.address,
            signature: signWssMessage(authB.wssKey, userB.address, subscribeChallengeB),
        });
        const subscribedPayload = await subscribed;
        console.log('Subscribed follow room:', subscribedPayload.room);

        const nextGridCellPromise = waitForGridCell(socketB, SOCKET_TIMEOUT_MS);
        const followedOrderUpdatePromise = waitForEvent<FollowedOrderUpdate>(
            socketB,
            'followed_order_update',
            SOCKET_TIMEOUT_MS,
        );

        const cell = await nextGridCellPromise;
        console.log(
            `Picked grid cell startTs=${cell.startTs} range=[${cell.lowerPrice}, ${cell.upperPrice}] rewardRate=${cell.rewardRate}`,
        );

        await placeOrder(authA.accessToken, {
            amount: ORDER_AMOUNT,
            marketId: MARKET_ID,
            cell,
        });
        console.log('User A placed order');

        const followed = await followedOrderUpdatePromise;
        console.log('Follower received followed_order_update:');
        console.log(JSON.stringify(followed, null, 2));

        if (followed.targetUserId !== userA.address) {
            throw new Error(`Unexpected targetUserId ${followed.targetUserId}`);
        }
        if (followed.status !== 'OPEN') {
            throw new Error(`Unexpected order status ${followed.status}`);
        }

        console.log('verify-follow-trade passed');
    } finally {
        socketB.close();
    }
}

async function loginWallet(wallet: SignerLike): Promise<AuthResponse> {
    const challenge = await getChallenge(wallet.address);
    const signature = await wallet.signMessage(challenge);

    return request<AuthResponse>('/auth/login', {
        method: 'POST',
        body: {
            address: wallet.address,
            signature,
        },
    });
}

async function getChallenge(address: string): Promise<string> {
    const response = await request<{ challenge: string }>(`/auth/challenge?address=${encodeURIComponent(address)}`, {
        method: 'GET',
    });
    return response.challenge;
}

async function faucetDeposit(accessToken: string, amount: string): Promise<void> {
    await request('/payment/debug/deposit', {
        method: 'POST',
        accessToken,
        body: { amount },
    });
}

async function registerFollow(accessToken: string, targetUserId: string): Promise<void> {
    await request('/order-follows', {
        method: 'POST',
        accessToken,
        body: { targetUserId },
    });
}

async function placeOrder(
    accessToken: string,
    input: { amount: string; marketId: string; cell: GridCell },
): Promise<void> {
    await request('/orders', {
        method: 'POST',
        accessToken,
        body: input,
    });
}

async function request<T = unknown>(
    path: string,
    options: {
        method: 'GET' | 'POST' | 'DELETE';
        accessToken?: string;
        body?: unknown;
    },
): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method,
        headers: {
            'content-type': 'application/json',
            ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status} for ${path}: ${text}`);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return response.json() as Promise<T>;
}

function signWssMessage(wssKeyHex: string, message: string, challenge?: string): string {
    const hmac = createHmac('sha256', Buffer.from(wssKeyHex, 'hex')).update(message);
    if (challenge) {
        hmac.update(challenge);
    }
    return hmac.digest('hex');
}

async function waitForSocketConnect(socket: Socket): Promise<void> {
    if (socket.connected) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Socket connect timeout after ${SOCKET_TIMEOUT_MS}ms`));
        }, SOCKET_TIMEOUT_MS);

        const onConnect = () => {
            cleanup();
            resolve();
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };

        const cleanup = () => {
            clearTimeout(timeout);
            socket.off('connect', onConnect);
            socket.off('connect_error', onError);
        };

        socket.on('connect', onConnect);
        socket.on('connect_error', onError);
    });
}

async function waitForGridCell(socket: Socket, timeoutMs: number): Promise<GridCell> {
    return new Promise<GridCell>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for grid_update after ${timeoutMs}ms`));
        }, timeoutMs);

        const onGridUpdate = (cells: GridCell[]) => {
            const now = Date.now();
            const candidate = cells.find((cell) => cell.startTs > now + 1000);
            if (!candidate) {
                return;
            }
            cleanup();
            resolve(candidate);
        };

        const cleanup = () => {
            clearTimeout(timeout);
            socket.off('grid_update', onGridUpdate);
        };

        socket.on('grid_update', onGridUpdate);
    });
}

async function waitForEvent<T>(socket: Socket, eventName: string, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for socket event "${eventName}" after ${timeoutMs}ms`));
        }, timeoutMs);

        const onEvent = (payload: T) => {
            cleanup();
            resolve(payload);
        };
        const onMessage = (payload: unknown) => {
            cleanup();
            reject(new Error(`Socket message error while waiting for "${eventName}": ${String(payload)}`));
        };

        const cleanup = () => {
            clearTimeout(timeout);
            socket.off(eventName, onEvent);
            socket.off('message', onMessage);
        };

        socket.on(eventName, onEvent);
        socket.on('message', onMessage);
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

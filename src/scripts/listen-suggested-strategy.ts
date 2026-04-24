import { io, Socket } from 'socket.io-client';

type SuggestedStrategyMessage = {
    cells: Array<{
        startTs: number;
        endTs: number;
        lowerPrice: string;
        upperPrice: string;
        rewardRate: string;
    }>;
    volatilityRegime: 'low' | 'medium' | 'high';
    sigma: number | null;
    atrMean: number | null;
    timestamp: number;
};

const APP_ORIGIN = process.env.VERIFY_APP_ORIGIN ?? 'http://localhost:5001';
const SOCKET_URL = process.env.VERIFY_SOCKET_URL ?? APP_ORIGIN;
const SOCKET_TIMEOUT_MS = Number(process.env.VERIFY_SOCKET_TIMEOUT_MS ?? 30000);

async function main() {
    console.log(`Using socket: ${SOCKET_URL}`);
    console.log('Listening for suggested_strategy_update. Press Ctrl+C to stop.');

    const socket = io(SOCKET_URL, {
        transports: ['websocket'],
        timeout: SOCKET_TIMEOUT_MS,
    });

    try {
        await waitForSocketConnect(socket);
        console.log('Socket connected');

        socket.emit('subscribe_suggested_strategy');

        socket.on('subscribed', (payload) => {
            console.log('Subscribed:', payload);
        });

        socket.on('disconnect', (reason) => {
            console.log(`Socket disconnected: ${reason}`);
        });

        socket.on('connect_error', (error) => {
            console.error('Socket connect_error:', error);
        });

        socket.on('suggested_strategy_update', (payload: SuggestedStrategyMessage) => {
            console.log(`[${new Date(payload.timestamp).toISOString()}] suggested_strategy_update`);
            console.log(`regime=${payload.volatilityRegime} sigma=${payload.sigma ?? 'n/a'} atrMean=${payload.atrMean ?? 'n/a'}`);
            console.log(`cells (first 10 of ${payload.cells.length}):`);
            console.log(JSON.stringify(payload.cells.slice(0, 10), null, 2));
        });

        await new Promise<void>(() => undefined);
    } finally {
        socket.close();
    }
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

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

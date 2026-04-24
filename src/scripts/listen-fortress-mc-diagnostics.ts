import { io, Socket } from 'socket.io-client';

type FortressMcDiagnosticsMessage = {
    paths: number[][];
    pRaw: number[][];
};

const APP_ORIGIN = process.env.VERIFY_APP_ORIGIN ?? 'http://localhost:5001';
const SOCKET_URL = process.env.VERIFY_SOCKET_URL ?? APP_ORIGIN;
const SOCKET_TIMEOUT_MS = Number(process.env.VERIFY_SOCKET_TIMEOUT_MS ?? 30000);

async function main() {
    console.log(`Using socket: ${SOCKET_URL}`);
    console.log('Listening for fortress_mc_diagnostics. Press Ctrl+C to stop.');

    const socket = io(SOCKET_URL, {
        transports: ['websocket'],
        timeout: SOCKET_TIMEOUT_MS,
    });

    try {
        await waitForSocketConnect(socket);
        console.log('Socket connected');

        socket.on('disconnect', (reason) => {
            console.log(`Socket disconnected: ${reason}`);
        });

        socket.on('connect_error', (error) => {
            console.error('Socket connect_error:', error);
        });

        socket.on('fortress_mc_diagnostics', (payload: FortressMcDiagnosticsMessage) => {
            console.log(`[${new Date().toISOString()}] fortress_mc_diagnostics`);
            console.log(`pRaw surface (first 3 rows): ${JSON.stringify(payload.pRaw.slice(0, 3))}`);
            console.log(`paths (first 10 of ${payload.paths.length}):`);
            console.log(JSON.stringify(payload.paths.slice(0, 10), null, 2));
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

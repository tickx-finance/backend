import { Injectable } from '@nestjs/common';
import { Wallet } from 'ethers';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { io } from 'socket.io-client';
import { z } from 'zod';

const DEFAULT_APP_ORIGIN = process.env.TAPFUN_APP_ORIGIN ?? process.env.VERIFY_APP_ORIGIN ?? 'http://localhost:5001';
const DEFAULT_API_BASE_URL = process.env.TAPFUN_API_BASE_URL ?? process.env.VERIFY_API_BASE_URL ?? `${DEFAULT_APP_ORIGIN}/api`;
const DEFAULT_SOCKET_URL = process.env.TAPFUN_SOCKET_URL ?? process.env.VERIFY_SOCKET_URL ?? DEFAULT_APP_ORIGIN;
const DEFAULT_MARKET_ID = process.env.TAPFUN_MARKET_ID ?? process.env.VERIFY_MARKET_ID ?? 'BTCUSDT';
const REQUEST_TIMEOUT_MS = Number(process.env.TAPFUN_REQUEST_TIMEOUT_MS ?? 15000);
const SOCKET_TIMEOUT_MS = Number(process.env.TAPFUN_SOCKET_TIMEOUT_MS ?? 15000);
const MARKET_WAIT_TIMEOUT_MS = Number(process.env.TAPFUN_MARKET_WAIT_TIMEOUT_MS ?? 15000);

const cellSchema = z.object({
    gridTs: z.number(),
    startTs: z.number(),
    endTs: z.number(),
    lowerPrice: z.string(),
    upperPrice: z.string(),
    rewardRate: z.string(),
    gridSignature: z.string(),
});

type Cell = z.infer<typeof cellSchema>;

type LatestPriceState = {
    price: number;
    qty: number;
    tradeId: number;
    isSell: boolean;
    ts: number;
};

type SuggestedStrategy = {
    cells: Cell[];
    volatilityRegime: 'low' | 'medium' | 'high';
    sigma: number | null;
    atrMean: number | null;
    timestamp: number;
};

type AuthSession = {
    address: string;
    accessToken: string;
    wssKey?: string;
    wssKeyExpiresAt?: number;
    authType?: string;
    humanVerified?: boolean;
    miniAppUserId?: string | null;
    miniAppUsername?: string | null;
};

type OrderStatus = 'OPEN' | 'WON' | 'LOST' | 'CANCELLED';

type McpSdk = {
    McpServer: new (...args: any[]) => any;
    WebStandardStreamableHTTPServerTransport: new (...args: any[]) => any;
};

type SessionContext = {
    runtime: TapfunRuntime;
    transport: any;
    server: any;
    createdAt: number;
};

class TapfunRuntime {
    apiBaseUrl = DEFAULT_API_BASE_URL;
    socketUrl = DEFAULT_SOCKET_URL;
    defaultMarketId = DEFAULT_MARKET_ID;
    session: AuthSession | null = null;

    private socket: ReturnType<typeof io> | null = null;
    private socketConnectPromise: Promise<void> | null = null;
    private latestGrid: Cell[] | null = null;
    private latestGridReceivedAt: number | null = null;
    private latestPrice: LatestPriceState | null = null;
    private latestPriceReceivedAt: number | null = null;
    private latestSuggestedStrategy: SuggestedStrategy | null = null;
    private latestSuggestedStrategyReceivedAt: number | null = null;

    configure(input: { apiBaseUrl?: string; socketUrl?: string; marketId?: string }) {
        const socketUrlChanged = typeof input.socketUrl === 'string' && input.socketUrl !== this.socketUrl;
        if (input.apiBaseUrl) {
            this.apiBaseUrl = trimTrailingSlash(input.apiBaseUrl);
        }
        if (input.socketUrl) {
            this.socketUrl = trimTrailingSlash(input.socketUrl);
        }
        if (input.marketId) {
            this.defaultMarketId = input.marketId;
        }
        if (socketUrlChanged) {
            this.resetSocket();
        }
    }

    dispose() {
        this.resetSocket();
    }

    setSession(session: AuthSession) {
        this.session = session;
    }

    clearSession() {
        this.session = null;
    }

    getStatus() {
        return {
            apiBaseUrl: this.apiBaseUrl,
            socketUrl: this.socketUrl,
            defaultMarketId: this.defaultMarketId,
            session: this.session
                ? {
                    address: this.session.address,
                    authType: this.session.authType ?? null,
                    humanVerified: this.session.humanVerified ?? false,
                    miniAppUserId: this.session.miniAppUserId ?? null,
                    miniAppUsername: this.session.miniAppUsername ?? null,
                    hasAccessToken: true,
                    hasWssKey: Boolean(this.session.wssKey),
                    wssKeyExpiresAt: this.session.wssKeyExpiresAt ?? null,
                }
                : null,
            marketCache: {
                latestPriceReceivedAt: this.latestPriceReceivedAt,
                latestGridReceivedAt: this.latestGridReceivedAt,
                latestSuggestedStrategyReceivedAt: this.latestSuggestedStrategyReceivedAt,
                gridCellCount: this.latestGrid?.length ?? 0,
                suggestedCellCount: this.latestSuggestedStrategy?.cells.length ?? 0,
            },
        };
    }

    async loginWithPrivateKey(privateKey: string) {
        const wallet = new Wallet(privateKey);
        const challengeResponse = await this.request<{ challenge: string }>(
            `/auth/challenge?address=${encodeURIComponent(wallet.address)}`,
            { method: 'GET' },
        );
        const signature = await wallet.signMessage(challengeResponse.challenge);
        const auth = await this.request<AuthSession>('/auth/login', {
            method: 'POST',
            body: {
                address: wallet.address,
                signature,
            },
        });

        this.session = {
            ...auth,
            address: wallet.address,
        };
        return this.session;
    }

    async getBalance() {
        const session = this.requireSession();
        return this.request('/account/balance', {
            method: 'GET',
            accessToken: session.accessToken,
        });
    }

    async listOrders(input: { status?: OrderStatus; limit?: number; offset?: number }) {
        const session = this.requireSession();
        const params = new URLSearchParams();
        if (input.status) {
            params.set('status', input.status);
        }
        if (typeof input.limit === 'number') {
            params.set('limit', String(input.limit));
        }
        if (typeof input.offset === 'number') {
            params.set('offset', String(input.offset));
        }
        const suffix = params.size > 0 ? `?${params.toString()}` : '';
        return this.request(`/orders/user${suffix}`, {
            method: 'GET',
            accessToken: session.accessToken,
        });
    }

    async debugFaucetDeposit(amount: string) {
        const session = this.requireSession();
        return this.request('/payment/debug/deposit', {
            method: 'POST',
            accessToken: session.accessToken,
            body: { amount },
        });
    }

    async placeOrder(input: { cell: Cell; amount: string; marketId?: string }) {
        const session = this.requireSession();
        return this.request('/orders', {
            method: 'POST',
            accessToken: session.accessToken,
            body: {
                cell: input.cell,
                amount: input.amount,
                marketId: input.marketId ?? this.defaultMarketId,
            },
        });
    }

    async placeOrderFromLatestGrid(input: {
        amount: string;
        cellIndex: number;
        marketId?: string;
        futureOnly?: boolean;
        limit?: number;
    }) {
        const snapshot = await this.getMarketSnapshot({
            gridLimit: input.limit ?? 50,
            futureOnly: input.futureOnly ?? true,
            suggestedLimit: 10,
            waitForData: true,
        });
        const cell = snapshot.grid[input.cellIndex];
        if (!cell) {
            throw new Error(`Cell index ${input.cellIndex} is out of range for latest grid`);
        }
        return this.placeOrder({
            cell,
            amount: input.amount,
            marketId: input.marketId,
        });
    }

    async placeOrderFromSuggestedStrategy(input: {
        amount: string;
        suggestionIndex: number;
        marketId?: string;
        limit?: number;
    }) {
        const snapshot = await this.getMarketSnapshot({
            gridLimit: 20,
            suggestedLimit: input.limit ?? 10,
            futureOnly: true,
            waitForData: true,
        });
        const cell = snapshot.suggestedStrategy?.cells[input.suggestionIndex];
        if (!cell) {
            throw new Error(`Suggestion index ${input.suggestionIndex} is out of range for latest suggested strategy`);
        }
        return this.placeOrder({
            cell,
            amount: input.amount,
            marketId: input.marketId,
        });
    }

    async getMarketSnapshot(input: {
        gridLimit?: number;
        suggestedLimit?: number;
        futureOnly?: boolean;
        waitForData?: boolean;
    }) {
        await this.ensureSocketConnected();
        if (input.waitForData !== false) {
            await this.waitForMarketData();
        }

        const now = Date.now();
        const grid = (this.latestGrid ?? [])
            .filter((cell) => (input.futureOnly ?? true ? cell.startTs > now : true))
            .slice(0, input.gridLimit ?? 20);

        const suggestedStrategy = this.latestSuggestedStrategy
            ? {
                ...this.latestSuggestedStrategy,
                cells: this.latestSuggestedStrategy.cells
                    .filter((cell) => (input.futureOnly ?? true ? cell.startTs > now : true))
                    .slice(0, input.suggestedLimit ?? 10),
            }
            : null;

        return {
            price: this.latestPrice,
            priceReceivedAt: this.latestPriceReceivedAt,
            grid,
            gridReceivedAt: this.latestGridReceivedAt,
            suggestedStrategy,
            suggestedStrategyReceivedAt: this.latestSuggestedStrategyReceivedAt,
            marketId: this.defaultMarketId,
        };
    }

    private async request<T = unknown>(
        path: string,
        options: {
            method: 'GET' | 'POST' | 'DELETE';
            accessToken?: string;
            body?: unknown;
        },
    ): Promise<T> {
        const response = await fetch(`${this.apiBaseUrl}${path}`, {
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

    private requireSession() {
        if (!this.session?.accessToken) {
            throw new Error('No active auth session. Use login_wallet or set_access_token first.');
        }
        return this.session;
    }

    private async ensureSocketConnected() {
        if (this.socket?.connected) {
            return;
        }
        if (this.socketConnectPromise) {
            return this.socketConnectPromise;
        }

        this.socketConnectPromise = new Promise<void>((resolve, reject) => {
            this.resetSocket();
            const socket = io(this.socketUrl, {
                transports: ['websocket'],
                timeout: SOCKET_TIMEOUT_MS,
            });
            this.socket = socket;

            const cleanup = () => {
                socket.off('connect', onConnect);
                socket.off('connect_error', onError);
            };

            const onConnect = () => {
                socket.emit('subscribe_suggested_strategy');
                cleanup();
                resolve();
            };

            const onError = (error: Error) => {
                cleanup();
                this.socketConnectPromise = null;
                reject(error);
            };

            socket.on('connect', onConnect);
            socket.on('connect_error', onError);
            socket.on('price_now', (price: LatestPriceState) => {
                this.latestPrice = price;
                this.latestPriceReceivedAt = Date.now();
            });
            socket.on('grid_update', (cells: Cell[]) => {
                this.latestGrid = cells;
                this.latestGridReceivedAt = Date.now();
            });
            socket.on('suggested_strategy_update', (message: SuggestedStrategy) => {
                this.latestSuggestedStrategy = message;
                this.latestSuggestedStrategyReceivedAt = Date.now();
            });
            socket.on('disconnect', () => {
                this.socketConnectPromise = null;
            });
        });

        try {
            await this.socketConnectPromise;
        } finally {
            this.socketConnectPromise = null;
        }
    }

    private async waitForMarketData() {
        if (this.latestGrid && this.latestPrice) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out waiting for market data after ${MARKET_WAIT_TIMEOUT_MS}ms`));
            }, MARKET_WAIT_TIMEOUT_MS);
            const interval = setInterval(() => {
                if (this.latestGrid && this.latestPrice) {
                    cleanup();
                    resolve();
                }
            }, 100);
            const cleanup = () => {
                clearTimeout(timeout);
                clearInterval(interval);
            };
        });
    }

    private resetSocket() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.close();
            this.socket = null;
        }
        this.socketConnectPromise = null;
    }
}

function trimTrailingSlash(value: string) {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

function formatResult(data: Record<string, unknown>) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(data, null, 2),
            },
        ],
        structuredContent: data,
    };
}

@Injectable()
export class McpService {
    private readonly sessions = new Map<string, SessionContext>();
    private sdkPromise: Promise<McpSdk> | null = null;

    getHealth() {
        return {
            status: 'ok',
            service: 'tapfun-mcp',
            timestamp: new Date().toISOString(),
            sessions: this.sessions.size,
        };
    }

    async handleExpressRequest(req: ExpressRequest, res: ExpressResponse) {
        const sessionId = getHeader(req, 'mcp-session-id');
        let context: SessionContext | undefined;
        let pendingContext:
            | (Awaited<ReturnType<McpService['createSessionContext']>> & { getSessionId: () => string | undefined })
            | undefined;

        if (sessionId) {
            context = this.sessions.get(sessionId);
            if (!context) {
                res.status(404).json({ error: `Unknown MCP session ${sessionId}` });
                return;
            }
        } else {
            pendingContext = await this.createSessionContext();
            context = pendingContext;
        }

        try {
            const webRequest = this.toWebRequest(req);
            const webResponse = await context.transport.handleRequest(webRequest, {
                parsedBody: req.body,
            });

            if (pendingContext) {
                const createdSessionId = pendingContext.getSessionId();
                if (createdSessionId) {
                    this.sessions.set(createdSessionId, {
                        runtime: pendingContext.runtime,
                        transport: pendingContext.transport,
                        server: pendingContext.server,
                        createdAt: pendingContext.createdAt,
                    });
                } else {
                    pendingContext.runtime.dispose();
                    await pendingContext.server.close();
                }
            }

            await this.writeWebResponse(webResponse, res);
        } catch (error) {
            if (pendingContext) {
                pendingContext.runtime.dispose();
                await pendingContext.server.close();
            }
            res.status(500).json({
                error: error instanceof Error ? error.message : 'Internal MCP error',
            });
        }
    }

    async shutdown() {
        await Promise.all(
            Array.from(this.sessions.values()).map(async (context) => {
                context.runtime.dispose();
                await context.server.close();
            }),
        );
        this.sessions.clear();
    }

    private async loadSdk(): Promise<McpSdk> {
        if (!this.sdkPromise) {
            this.sdkPromise = (0, eval)('import("@modelcontextprotocol/server")') as Promise<McpSdk>;
        }
        return this.sdkPromise;
    }

    private async createSessionContext() {
        const sdk = await this.loadSdk();
        const runtime = new TapfunRuntime();
        let createdSessionId: string | undefined;

        const transport = new sdk.WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => cryptoRandomSessionId(),
            enableJsonResponse: true,
            onsessioninitialized: async (sessionId: string) => {
                createdSessionId = sessionId;
            },
            onsessionclosed: async (sessionId: string) => {
                const existing = this.sessions.get(sessionId);
                if (!existing) {
                    return;
                }
                existing.runtime.dispose();
                await existing.server.close();
                this.sessions.delete(sessionId);
            },
        });

        const server = this.buildMcpServer(runtime, sdk);
        await server.connect(transport);

        return {
            runtime,
            transport,
            server,
            createdAt: Date.now(),
            getSessionId: () => createdSessionId,
        };
    }

    private buildMcpServer(runtime: TapfunRuntime, sdk: McpSdk) {
        const server = new sdk.McpServer({
            name: 'tapfun-agent',
            version: '1.0.0',
        });

        server.registerTool(
            'configure_connection',
            {
                description: 'Override API base URL, socket URL, or default market ID used by the TapFun MCP session.',
                inputSchema: z.object({
                    apiBaseUrl: z.string().url().optional(),
                    socketUrl: z.string().url().optional(),
                    marketId: z.string().optional(),
                }),
            },
            async (input: { apiBaseUrl?: string; socketUrl?: string; marketId?: string }) => {
                runtime.configure(input);
                return formatResult(runtime.getStatus() as Record<string, unknown>);
            },
        );

        server.registerTool(
            'get_runtime_status',
            {
                description: 'Return current connection config, auth session status, and market cache timestamps.',
                inputSchema: z.object({}),
            },
            async () => formatResult(runtime.getStatus() as Record<string, unknown>),
        );

        server.registerTool(
            'login_wallet',
            {
                description: 'Login by signing the backend challenge with a wallet private key. Stores the JWT session in this MCP process.',
                inputSchema: z.object({
                    privateKey: z.string().min(1),
                }),
            },
            async ({ privateKey }: { privateKey: string }) => formatResult((await runtime.loginWithPrivateKey(privateKey)) as Record<string, unknown>),
        );

        server.registerTool(
            'set_access_token',
            {
                description: 'Inject an already-issued backend JWT session into this MCP process without performing wallet login.',
                inputSchema: z.object({
                    address: z.string().min(1),
                    accessToken: z.string().min(1),
                    wssKey: z.string().optional(),
                    wssKeyExpiresAt: z.number().optional(),
                    authType: z.string().optional(),
                    humanVerified: z.boolean().optional(),
                    miniAppUserId: z.string().nullable().optional(),
                    miniAppUsername: z.string().nullable().optional(),
                }),
            },
            async (input: AuthSession) => {
                runtime.setSession(input);
                return formatResult(runtime.getStatus() as Record<string, unknown>);
            },
        );

        server.registerTool(
            'clear_session',
            {
                description: 'Clear the current auth session from this MCP process.',
                inputSchema: z.object({}),
            },
            async () => {
                runtime.clearSession();
                return formatResult(runtime.getStatus() as Record<string, unknown>);
            },
        );

        server.registerTool(
            'get_balance',
            {
                description: 'Read the current user account balance through the backend account API.',
                inputSchema: z.object({}),
            },
            async () => formatResult((await runtime.getBalance()) as Record<string, unknown>),
        );

        server.registerTool(
            'debug_faucet_deposit',
            {
                description: 'Call the hackathon faucet deposit debug endpoint for the current session user.',
                inputSchema: z.object({
                    amount: z.string().min(1),
                }),
            },
            async ({ amount }: { amount: string }) => formatResult((await runtime.debugFaucetDeposit(amount)) as Record<string, unknown>),
        );

        server.registerTool(
            'get_market_snapshot',
            {
                description: 'Return the latest cached price, current grid cells, and suggested strategy cells from the backend websocket stream.',
                inputSchema: z.object({
                    gridLimit: z.number().int().min(1).max(200).optional(),
                    suggestedLimit: z.number().int().min(1).max(50).optional(),
                    futureOnly: z.boolean().optional(),
                    waitForData: z.boolean().optional(),
                }),
            },
            async (input: { gridLimit?: number; suggestedLimit?: number; futureOnly?: boolean; waitForData?: boolean }) =>
                formatResult((await runtime.getMarketSnapshot(input)) as Record<string, unknown>),
        );

        server.registerTool(
            'place_order',
            {
                description: 'Place an order using an explicit grid cell payload.',
                inputSchema: z.object({
                    amount: z.string().min(1),
                    marketId: z.string().optional(),
                    cell: cellSchema,
                }),
            },
            async (input: { amount: string; marketId?: string; cell: Cell }) => formatResult((await runtime.placeOrder(input)) as Record<string, unknown>),
        );

        server.registerTool(
            'place_order_from_latest_grid',
            {
                description: 'Place an order by referencing a cell index from the latest cached grid snapshot.',
                inputSchema: z.object({
                    amount: z.string().min(1),
                    cellIndex: z.number().int().min(0),
                    marketId: z.string().optional(),
                    futureOnly: z.boolean().optional(),
                    limit: z.number().int().min(1).max(200).optional(),
                }),
            },
            async (input: { amount: string; cellIndex: number; marketId?: string; futureOnly?: boolean; limit?: number }) =>
                formatResult((await runtime.placeOrderFromLatestGrid(input)) as Record<string, unknown>),
        );

        server.registerTool(
            'place_order_from_suggested_strategy',
            {
                description: 'Place an order by referencing a cell index from the latest suggested strategy stream.',
                inputSchema: z.object({
                    amount: z.string().min(1),
                    suggestionIndex: z.number().int().min(0),
                    marketId: z.string().optional(),
                    limit: z.number().int().min(1).max(50).optional(),
                }),
            },
            async (input: { amount: string; suggestionIndex: number; marketId?: string; limit?: number }) =>
                formatResult((await runtime.placeOrderFromSuggestedStrategy(input)) as Record<string, unknown>),
        );

        server.registerTool(
            'list_orders',
            {
                description: 'List the current user orders from the backend.',
                inputSchema: z.object({
                    status: z.enum(['OPEN', 'WON', 'LOST', 'CANCELLED']).optional(),
                    limit: z.number().int().min(1).max(200).optional(),
                    offset: z.number().int().min(0).optional(),
                }),
            },
            async (input: { status?: OrderStatus; limit?: number; offset?: number }) => formatResult((await runtime.listOrders(input)) as Record<string, unknown>),
        );

        return server;
    }

    private toWebRequest(req: ExpressRequest) {
        const protocol = req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http';
        const url = new URL(req.originalUrl ?? req.url ?? '/', `${protocol}://${req.headers.host}`);
        const headers = new Headers();

        for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'undefined') {
                continue;
            }
            if (Array.isArray(value)) {
                for (const entry of value) {
                    headers.append(key, entry);
                }
                continue;
            }
            headers.set(key, value);
        }

        return new Request(url, {
            method: req.method,
            headers,
        });
    }

    private async writeWebResponse(webResponse: Response, res: ExpressResponse) {
        res.status(webResponse.status);
        webResponse.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });

        if (!webResponse.body) {
            res.end();
            return;
        }

        const nodeStream = Readable.fromWeb(webResponse.body as globalThis.ReadableStream);
        nodeStream.on('error', (error) => {
            res.destroy(error);
        });
        nodeStream.pipe(res);
    }
}

function getHeader(req: ExpressRequest, key: string) {
    const raw = req.headers[key];
    return Array.isArray(raw) ? raw[0] : raw;
}

function cryptoRandomSessionId() {
    return (0, eval)('require("node:crypto")').randomUUID() as string;
}

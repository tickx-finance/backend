import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Wallet } from 'ethers';
import { io } from 'socket.io-client';
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

const DEFAULT_APP_ORIGIN = process.env.TAPFUN_APP_ORIGIN ?? process.env.VERIFY_APP_ORIGIN ?? 'http://localhost:5001';
const DEFAULT_API_BASE_URL = process.env.TAPFUN_API_BASE_URL ?? process.env.VERIFY_API_BASE_URL ?? `${DEFAULT_APP_ORIGIN}/api`;
const DEFAULT_SOCKET_URL = process.env.TAPFUN_SOCKET_URL ?? process.env.VERIFY_SOCKET_URL ?? DEFAULT_APP_ORIGIN;
const DEFAULT_MARKET_ID = process.env.TAPFUN_MARKET_ID ?? process.env.VERIFY_MARKET_ID ?? 'BTCUSDT';
const REQUEST_TIMEOUT_MS = Number(process.env.TAPFUN_REQUEST_TIMEOUT_MS ?? 15000);
const SOCKET_TIMEOUT_MS = Number(process.env.TAPFUN_SOCKET_TIMEOUT_MS ?? 15000);
const MARKET_WAIT_TIMEOUT_MS = Number(process.env.TAPFUN_MARKET_WAIT_TIMEOUT_MS ?? 15000);
const MCP_HOST = process.env.MCP_HOST ?? '0.0.0.0';
const MCP_PORT = Number(process.env.MCP_PORT ?? 3010);

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

type SessionContext = {
  runtime: TapfunRuntime;
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
};

const sessions = new Map<string, SessionContext>();

function trimTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function formatResult(data: unknown) {
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

function buildMcpServer(runtime: TapfunRuntime) {
  const server = new McpServer({
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
    async (input) => {
      runtime.configure(input);
      return formatResult(runtime.getStatus());
    },
  );

  server.registerTool(
    'get_runtime_status',
    {
      description: 'Return current connection config, auth session status, and market cache timestamps.',
      inputSchema: z.object({}),
    },
    async () => formatResult(runtime.getStatus()),
  );

  server.registerTool(
    'login_wallet',
    {
      description: 'Login by signing the backend challenge with a wallet private key. Stores the JWT session in this MCP process.',
      inputSchema: z.object({
        privateKey: z.string().min(1),
      }),
    },
    async ({ privateKey }) => formatResult(await runtime.loginWithPrivateKey(privateKey)),
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
    async (input) => {
      runtime.setSession(input);
      return formatResult(runtime.getStatus());
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
      return formatResult(runtime.getStatus());
    },
  );

  server.registerTool(
    'get_balance',
    {
      description: 'Read the current user account balance through the backend account API.',
      inputSchema: z.object({}),
    },
    async () => formatResult(await runtime.getBalance()),
  );

  server.registerTool(
    'debug_faucet_deposit',
    {
      description: 'Call the hackathon faucet deposit debug endpoint for the current session user.',
      inputSchema: z.object({
        amount: z.string().min(1),
      }),
    },
    async ({ amount }) => formatResult(await runtime.debugFaucetDeposit(amount)),
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
    async (input) => formatResult(await runtime.getMarketSnapshot(input)),
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
    async (input) => formatResult(await runtime.placeOrder(input)),
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
    async (input) => formatResult(await runtime.placeOrderFromLatestGrid(input)),
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
    async (input) => formatResult(await runtime.placeOrderFromSuggestedStrategy(input)),
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
    async (input) => formatResult(await runtime.listOrders(input)),
  );

  return server;
}

function getSessionIdFromRequest(req: IncomingMessage) {
  const raw = req.headers['mcp-session-id'];
  return Array.isArray(raw) ? raw[0] : raw;
}

async function createSessionContext() {
  const runtime = new TapfunRuntime();
  let createdSessionId: string | undefined;

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: async (sessionId) => {
      createdSessionId = sessionId;
    },
    onsessionclosed: async (sessionId) => {
      const existing = sessions.get(sessionId);
      if (!existing) {
        return;
      }
      existing.runtime.dispose();
      await existing.server.close();
      sessions.delete(sessionId);
    },
  });

  const server = buildMcpServer(runtime);
  await server.connect(transport);

  return {
    runtime,
    transport,
    server,
    createdAt: Date.now(),
    getSessionId: () => createdSessionId,
  };
}

async function readRawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(req: IncomingMessage) {
  const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host = req.headers.host ?? `localhost:${MCP_PORT}`;
  const url = new URL(req.url ?? '/', `${protocol}://${host}`);
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

  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(req);

  return new Request(url, {
    method,
    headers,
    body,
    duplex: body ? 'half' : undefined,
  });
}

async function writeWebResponse(webResponse: Response, res: ServerResponse) {
  res.statusCode = webResponse.status;

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

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  const sessionId = getSessionIdFromRequest(req);

  let context: SessionContext | undefined;
  let pendingContext:
    | Awaited<ReturnType<typeof createSessionContext>>
    | undefined;

  if (sessionId) {
    context = sessions.get(sessionId);
    if (!context) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown MCP session ${sessionId}` }));
      return;
    }
  } else {
    pendingContext = await createSessionContext();
    context = pendingContext;
  }

  try {
    const webRequest = await toWebRequest(req);
    const webResponse = await context.transport.handleRequest(webRequest);

    if (pendingContext) {
      const createdSessionId = pendingContext.getSessionId();
      if (createdSessionId) {
        sessions.set(createdSessionId, {
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

    await writeWebResponse(webResponse, res);
  } catch (error) {
    if (pendingContext) {
      pendingContext.runtime.dispose();
      await pendingContext.server.close();
    }
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal MCP error',
      }),
    );
  }
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${MCP_PORT}`}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'tapfun-mcp',
        timestamp: new Date().toISOString(),
        sessions: sessions.size,
      }),
    );
    return;
  }

  if (url.pathname === '/mcp') {
    await handleMcpRequest(req, res);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

httpServer.listen(MCP_PORT, MCP_HOST, () => {
  console.log(`TapFun MCP server listening on http://${MCP_HOST}:${MCP_PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    httpServer.close();
    await Promise.all(
      Array.from(sessions.values()).map(async (context) => {
        context.runtime.dispose();
        await context.server.close();
      }),
    );
    sessions.clear();
    process.exit(0);
  });
}

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import WebSocket from 'ws';
import { AggTradePayload, LatestPriceState, PriceTick } from 'src/libs/price-tick';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';
import { OrderPriceTickChannel } from '../order/price-tick.channel';

import { env } from 'src/config';
import { OhlcService } from './ohlc.service';

@Injectable()
export class PriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceService.name);
  private readonly WS_URL = 'wss://fstream.binance.com/ws/btcusdt@aggTrade';
  private readonly WS_STALE_AFTER_MS = 15_000;
  private readonly WS_HEALTHCHECK_INTERVAL_MS = 5_000;
  private readonly WS_RECONNECT_BASE_DELAY_MS = 1_000;
  private readonly WS_RECONNECT_MAX_DELAY_MS = 30_000;

  constructor(
    @Inject(EVENT_PUBLISHER)
    private readonly eventPublisher: EventPublisher,
    private readonly orderPriceTickChannel: OrderPriceTickChannel,
    private readonly ohlcService: OhlcService,
  ) { }

  // ========================
  // In-memory latest trade
  // ========================
  private latestTrade?: LatestPriceState;

  // ========= READ ONLY =========
  getLatestTrade(): LatestPriceState | null {
    return this.latestTrade ?? null;
  }

  // ========================
  // WS related
  // ========================
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private snapshotTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private lastMessageAt?: number;
  private lastConnectAttemptAt?: number;
  private lastDisconnectAt?: number;
  private reconnectAttempts = 0;

  // ========================
  // Lifecycle
  // ========================
  onModuleInit() {
    if (!env.flag.runPriceTick) return;

    this.connectWS();
    this.startSnapshotLoop();
    this.startHealthCheckLoop();
  }

  onModuleDestroy() {
    this.isShuttingDown = true;
    this.clearReconnectTimer();

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);

    this.disconnectWS();
  }

  // ========================
  // Connect Binance WS
  // ========================
  private connectWS() {
    if (this.isShuttingDown) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.disconnectWS();
    this.clearReconnectTimer();
    this.lastConnectAttemptAt = Date.now();

    this.logger.log('Connecting to Binance aggTrade WS...');
    const socket = new WebSocket(this.WS_URL);
    this.ws = socket;

    socket.on('open', () => {
      if (this.ws !== socket) return;

      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.logger.log('✅ Binance aggTrade WS connected');
    });

    socket.on('message', (data) => {
      if (this.ws !== socket) return;

      let msg: AggTradePayload;
      try {
        msg = JSON.parse(data.toString()) as AggTradePayload;
      } catch (error) {
        this.logger.warn(`Failed to parse Binance WS payload: ${String(error)}`);
        return;
      }

      this.lastMessageAt = Date.now();

      // drop outdated trade
      if (this.latestTrade && msg.a <= this.latestTrade.tradeId) return;

      this.latestTrade = {
        price: Number(msg.p),
        qty: Number(msg.q),
        tradeId: msg.a,
        isSell: msg.m, // true = sell market
        ts: msg.T,
      };
    });

    socket.on('close', (code, reason) => {
      if (this.ws !== socket) return;

      this.ws = undefined;
      this.lastDisconnectAt = Date.now();

      const reasonText = reason.toString() || 'no reason';
      this.logger.warn(
        `❌ Binance aggTrade WS closed (code=${code}, reason=${reasonText})`,
      );
      this.scheduleReconnect('socket closed');
    });

    socket.on('error', (err) => {
      if (this.ws !== socket) return;

      this.logger.error(
        `Binance aggTrade WS error: ${err.message}`,
        err.stack,
      );
      this.forceReconnect('socket error');
    });
  }

  private disconnectWS() {
    const socket = this.ws;
    if (!socket) return;

    this.ws = undefined;
    this.lastDisconnectAt = Date.now();
    socket.removeAllListeners();

    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
      socket.terminate();
      return;
    }

    if (
      socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.CLOSING
    ) {
      socket.terminate();
    }
  }

  private forceReconnect(reason: string) {
    if (this.isShuttingDown) return;

    this.logger.warn(`Forcing Binance aggTrade WS reconnect: ${reason}`);
    this.disconnectWS();
    this.scheduleReconnect(reason);
  }

  private scheduleReconnect(reason: string) {
    if (this.isShuttingDown || this.reconnectTimer) return;

    const delay = Math.min(
      this.WS_RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts,
      this.WS_RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempts += 1;

    this.logger.warn(
      `Reconnecting Binance aggTrade WS in ${delay}ms (${reason})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectWS();
    }, delay);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private startHealthCheckLoop() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isShuttingDown || this.reconnectTimer) return;

      const now = Date.now();
      const socket = this.ws;

      if (!socket || socket.readyState === WebSocket.CLOSED) {
        this.scheduleReconnect('socket not connected');
        return;
      }

      if (
        socket.readyState === WebSocket.CONNECTING &&
        this.lastConnectAttemptAt &&
        now - this.lastConnectAttemptAt > this.WS_STALE_AFTER_MS
      ) {
        this.forceReconnect('connect timeout');
        return;
      }

      if (
        socket.readyState === WebSocket.OPEN &&
        this.lastMessageAt &&
        now - this.lastMessageAt > this.WS_STALE_AFTER_MS
      ) {
        this.forceReconnect(`no trade received for ${now - this.lastMessageAt}ms`);
      }
    }, this.WS_HEALTHCHECK_INTERVAL_MS);
  }

  // ========================
  // Snapshot loop (ANTI LAG)
  // ========================
  private startSnapshotLoop() {
    this.snapshotTimer = setInterval(() => {
      if (!this.latestTrade) return;

      // const { price, qty, isSell } = this.latestTrade;

      this.eventPublisher.emitNewPrice(this.latestTrade);

      const priceTick: PriceTick = {
        timestamp: this.latestTrade.ts,
        price: this.latestTrade.price,
      };
      this.orderPriceTickChannel.send(priceTick);

      // Feed price tick to OHLC service for candle aggregation
      this.ohlcService.processPriceTick(priceTick);

      // this.logger.debug(
      //   `TRADE PRICE: ${price} | QTY: ${qty} | SIDE: ${isSell ? 'SELL' : 'BUY'
      //   }`,
      // );
    }, 100);
  }

  getLatestTradePrice(): number | null {
    return this.latestTrade?.price ?? null;
  }

  getStreamHealth() {
    const now = Date.now();
    const readyState = this.ws
      ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws.readyState] ?? 'UNKNOWN'
      : 'CLOSED';
    const lastMessageAgeMs = this.lastMessageAt ? now - this.lastMessageAt : null;
    const healthy =
      !env.flag.runPriceTick ||
      (this.ws?.readyState === WebSocket.OPEN &&
        lastMessageAgeMs !== null &&
        lastMessageAgeMs <= this.WS_STALE_AFTER_MS);

    return {
      enabled: env.flag.runPriceTick,
      healthy,
      readyState,
      reconnectScheduled: Boolean(this.reconnectTimer),
      reconnectAttempts: this.reconnectAttempts,
      lastMessageAt: this.lastMessageAt ?? null,
      lastMessageAgeMs,
      lastConnectAttemptAt: this.lastConnectAttemptAt ?? null,
      lastDisconnectAt: this.lastDisconnectAt ?? null,
      staleAfterMs: this.WS_STALE_AFTER_MS,
      latestTradeTs: this.latestTrade?.ts ?? null,
    };
  }
}

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import WebSocket from 'ws';
import { AggTradePayload, LatestPriceState } from 'src/libs/price-tick';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';

@Injectable()
export class PriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceService.name);
  constructor(
    @Inject(EVENT_PUBLISHER)
    private readonly eventPublisher: EventPublisher) { }

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

  private readonly WS_URL = 'wss://fstream.binance.com/ws/btcusdt@aggTrade';

  // ========================
  // Lifecycle
  // ========================
  onModuleInit() {
    this.connectWS();
    this.startSnapshotLoop();
  }

  onModuleDestroy() {
    this.ws?.close();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }

  // ========================
  // Connect Binance WS
  // ========================
  private connectWS() {
    this.logger.log('Connecting to Binance aggTrade WS...');
    this.ws = new WebSocket(this.WS_URL);

    this.ws.on('open', () => {
      this.logger.log('✅ Binance aggTrade WS connected');
    });

    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as AggTradePayload;

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

    this.ws.on('close', () => {
      this.logger.warn('❌ WS closed – reconnecting...');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.logger.error('WS error', err);
      this.ws?.close();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectWS();
    }, 1000);
  }

  // ========================
  // Snapshot loop (ANTI LAG)
  // ========================
  private startSnapshotLoop() {
    setInterval(() => {
      if (!this.latestTrade) return;

      const { price, qty, isSell } = this.latestTrade;

      this.eventPublisher.emitNewPrice(this.latestTrade);

      this.logger.debug(
        `TRADE PRICE: ${price} | QTY: ${qty} | SIDE: ${isSell ? 'SELL' : 'BUY'
        }`,
      );
    }, 100);
  }

  getLatestTradePrice(): number | null {
    return this.latestTrade?.price ?? null;
  }
}

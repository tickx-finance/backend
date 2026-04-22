import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { keccak256, toHex, concat } from 'viem';
import { InternalCandleData, OHLCCandle, OhlcResponse } from './types';

/**
 * Time-to-live for in-memory candles: 30 minutes in milliseconds
 */
const CANDLE_TTL_MS = 30 * 60 * 1000;

/**
 * Cleanup interval: 1 minute
 */
const CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * Candle interval: 1 second in milliseconds
 */
const CANDLE_INTERVAL_MS = 1000;

interface PriceTick {
  timestamp: number;
  price: number;
}

interface CandleBuilder {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  hasData: boolean;
}

@Injectable()
export class OhlcService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OhlcService.name);

  // In-memory storage: key = candle timestamp (seconds), value = candle data
  private candles = new Map<number, InternalCandleData>();

  // Current candle being built from real-time ticks
  private currentCandle: CandleBuilder | null = null;

  // Cleanup interval handle
  private cleanupInterval?: NodeJS.Timeout;

  // Track last processed timestamp to detect gaps
  private lastProcessedTimestamp = 0;

  onModuleInit() {
    this.startCleanupInterval();
    this.logger.log('OHLC Service initialized with 30-minute TTL');
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Process a new price tick from WebSocket
   * Aggregates ticks into 1-second candles
   */
  processPriceTick(tick: PriceTick): void {
    const candleTimestamp = Math.floor(tick.timestamp / 1000);

    // Initialize new candle if needed
    if (
      !this.currentCandle ||
      this.currentCandle.timestamp !== candleTimestamp
    ) {
      // Save previous candle if exists
      if (this.currentCandle && this.currentCandle.hasData) {
        this.saveCandle(this.currentCandle);
      }

      // Handle gaps - fill missing candles with last known close price
      if (
        this.currentCandle &&
        candleTimestamp > this.currentCandle.timestamp + 1
      ) {
        this.fillGaps(
          this.currentCandle.timestamp,
          candleTimestamp,
          this.currentCandle.close,
        );
      }

      // Start new candle
      this.currentCandle = {
        timestamp: candleTimestamp,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        hasData: true,
      };
    } else {
      // Update current candle
      this.currentCandle.high = Math.max(this.currentCandle.high, tick.price);
      this.currentCandle.low = Math.min(this.currentCandle.low, tick.price);
      this.currentCandle.close = tick.price;
    }

    this.lastProcessedTimestamp = candleTimestamp;
  }

  /**
   * Get OHLC data for a time window
   * Returns real data from cache if available, or generates mock data
   */
  getOhlcData(
    windowStart: number,
    windowEnd: number,
    source: string,
  ): OhlcResponse {
    const now = Math.floor(Date.now() / 1000);
    const maxLookback = 30 * 60; // 30 minutes in seconds

    // Validate window
    if (windowEnd <= windowStart) {
      throw new Error('windowEnd must be greater than windowStart');
    }

    if (windowEnd > now) {
      throw new Error('windowEnd cannot be in the future');
    }

    // Check if requested window is within our cache range
    if (windowStart < now - maxLookback) {
      // Requested window is too old, generate deterministic mock data
      return this.generateMockOhlc(windowStart, windowEnd, source);
    }

    // Try to get from cache
    const candles = this.getCandlesFromCache(windowStart, windowEnd);

    if (candles.length === 0) {
      // No data in cache yet, generate mock
      return this.generateMockOhlc(windowStart, windowEnd, source);
    }

    // Calculate deterministic hash
    const hash = this.computeHash(candles, windowStart, windowEnd);

    return {
      windowStart,
      windowEnd,
      candles,
      count: candles.length,
      hash,
    };
  }

  /**
   * Check if data is available for a given window
   */
  hasDataForWindow(windowStart: number, windowEnd: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    const maxLookback = 30 * 60; // 30 minutes

    // If window is within cache range, check if we have all candles
    if (windowStart >= now - maxLookback) {
      for (let ts = windowStart; ts < windowEnd; ts++) {
        if (!this.candles.has(ts)) {
          return false;
        }
      }
      return true;
    }

    // For older windows, we can always generate mock data
    return true;
  }

  /**
   * Get current cache statistics
   */
  getCacheStats(): {
    size: number;
    oldest: number | null;
    newest: number | null;
  } {
    const timestamps = Array.from(this.candles.keys()).sort((a, b) => a - b);
    return {
      size: this.candles.size,
      oldest: timestamps[0] ?? null,
      newest: timestamps[timestamps.length - 1] ?? null,
    };
  }

  private saveCandle(builder: CandleBuilder): void {
    const candle: InternalCandleData = {
      timestamp: builder.timestamp,
      open: builder.open.toFixed(2),
      high: builder.high.toFixed(2),
      low: builder.low.toFixed(2),
      close: builder.close.toFixed(2),
      createdAt: Date.now(),
    };

    this.candles.set(builder.timestamp, candle);
  }

  /**
   * Fill gaps in candle data with last known price
   */
  private fillGaps(
    lastTimestamp: number,
    currentTimestamp: number,
    lastClose: number,
  ): void {
    const now = Date.now();
    for (let ts = lastTimestamp + 1; ts < currentTimestamp; ts++) {
      const candle: InternalCandleData = {
        timestamp: ts,
        open: lastClose.toFixed(2),
        high: lastClose.toFixed(2),
        low: lastClose.toFixed(2),
        close: lastClose.toFixed(2),
        createdAt: now,
      };
      this.candles.set(ts, candle);
    }
  }

  private getCandlesFromCache(
    windowStart: number,
    windowEnd: number,
  ): OHLCCandle[] {
    const result: OHLCCandle[] = [];

    for (let ts = windowStart; ts < windowEnd; ts++) {
      const candle = this.candles.get(ts);
      if (candle) {
        result.push({
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });
      }
    }

    return result;
  }

  /**
   * Generate deterministic mock OHLC data based on seed
   * Used for historical data or when cache is empty
   */
  private generateMockOhlc(
    windowStart: number,
    windowEnd: number,
    source: string,
  ): OhlcResponse {
    const candles: OHLCCandle[] = [];
    const count = windowEnd - windowStart;

    // Base price ~$96,000 BTC
    const basePrice = 96000;

    // Use windowStart + source as seed for deterministic generation
    const seed = windowStart + (source === 'chainlink' ? 1 : 0);

    for (let i = 0; i < count; i++) {
      const timestamp = windowStart + i;

      // Generate pseudo-random volatility ±0.1%
      const randomFactor = this.pseudoRandom(seed + i);
      const volatility = (randomFactor - 0.5) * 0.002; // ±0.1%

      const price = basePrice * (1 + volatility);
      const open = price;
      const close =
        price * (1 + (this.pseudoRandom(seed + i + 1000) - 0.5) * 0.002);
      const high =
        Math.max(open, close) *
        (1 + this.pseudoRandom(seed + i + 2000) * 0.001);
      const low =
        Math.min(open, close) *
        (1 - this.pseudoRandom(seed + i + 3000) * 0.001);

      candles.push({
        timestamp,
        open: open.toFixed(2),
        high: high.toFixed(2),
        low: low.toFixed(2),
        close: close.toFixed(2),
      });
    }

    const hash = this.computeHash(candles, windowStart, windowEnd);

    return {
      windowStart,
      windowEnd,
      candles,
      count: candles.length,
      hash,
    };
  }

  /**
   * Pseudo-random number generator (deterministic)
   */
  private pseudoRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  /**
   * Compute deterministic keccak256 hash of candle data
   */
  private computeHash(
    candles: OHLCCandle[],
    windowStart: number,
    windowEnd: number,
  ): string {
    // Encode candle data for hashing
    const encoded = candles
      .map((c) => `${c.timestamp}:${c.open}:${c.high}:${c.low}:${c.close}`)
      .join('|');

    const data = `${windowStart}:${windowEnd}:${encoded}`;
    return keccak256(toHex(data));
  }

  /**
   * Start periodic cleanup of old candles
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldCandles();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Remove candles older than 30 minutes
   */
  private cleanupOldCandles(): void {
    const cutoffTime = Date.now() - CANDLE_TTL_MS;
    let removedCount = 0;

    for (const [timestamp, candle] of this.candles.entries()) {
      if (candle.createdAt < cutoffTime) {
        this.candles.delete(timestamp);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.debug(
        `Cleaned up ${removedCount} old candles. Current cache: ${this.candles.size} candles`,
      );
    }
  }
}

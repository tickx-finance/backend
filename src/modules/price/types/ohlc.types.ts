/**
 * OHLC Candle data structure
 */
export interface OHLCCandle {
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Opening price */
  open: string;
  /** Highest price */
  high: string;
  /** Lowest price */
  low: string;
  /** Closing price */
  close: string;
}

/**
 * OHLC API Response
 */
export interface OhlcResponse {
  /** Window start timestamp */
  windowStart: number;
  /** Window end timestamp */
  windowEnd: number;
  /** Array of OHLC candles */
  candles: OHLCCandle[];
  /** Number of candles */
  count: number;
  /** Deterministic hash of the data */
  hash: string;
}

/**
 * Query parameters for OHLC endpoint
 */
export interface OhlcQueryParams {
  /** Unix timestamp (seconds) - window start */
  windowStart: number;
  /** Unix timestamp (seconds) - window end */
  windowEnd: number;
  /** Data source: 'internal' or 'chainlink' */
  source: 'internal' | 'chainlink';
}

/**
 * Error response for OHLC endpoint
 */
export interface OhlcErrorResponse {
  error: string;
  message: string;
  retryable: boolean;
}

/**
 * Internal candle data with metadata for cleanup
 */
export interface InternalCandleData extends OHLCCandle {
  /** Timestamp when this candle was created (for TTL) */
  createdAt: number;
}

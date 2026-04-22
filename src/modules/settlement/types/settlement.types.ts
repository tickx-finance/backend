/**
 * Deposit item in settlement batch
 */
export interface SettlementDeposit {
  /** User account address (userId) */
  account: string;
  /** Amount in wei */
  amount: string;
}

/**
 * Withdrawal item in settlement batch
 */
export interface SettlementWithdrawal {
  /** User account address (userId) */
  account: string;
  /** Amount in wei */
  amount: string;
}

/**
 * Settlement item (bet outcome)
 */
export interface SettlementItem {
  /** User account address (userId) */
  account: string;
  /** Bet/Order ID */
  betId: string;
  /** Outcome: WIN or LOSS */
  outcome: 'WIN' | 'LOSS';
  /** Payout amount in wei */
  payout: string;
  /** Original stake amount in wei */
  originalStake: string;
}

/**
 * Settlement Batch
 */
export interface SettlementBatch {
  /** Unique batch ID */
  batchId: string;
  /** Window start timestamp */
  windowStart: number;
  /** Window end timestamp */
  windowEnd: number;
  /** Deposits in this batch */
  deposits: SettlementDeposit[];
  /** Withdrawals in this batch */
  withdrawals: SettlementWithdrawal[];
  /** Settlements in this batch */
  settlements: SettlementItem[];
}

/**
 * Settlement Batches Response
 */
export interface SettlementBatchesResponse {
  /** Array of batches */
  batches: SettlementBatch[];
}

/**
 * Query parameters for settlement batches endpoint
 */
export interface SettlementBatchesQuery {
  /** Unix timestamp (seconds) - window start */
  windowStart: number;
  /** Unix timestamp (seconds) - window end */
  windowEnd: number;
}

/**
 * Error response for settlement endpoint
 */
export interface SettlementErrorResponse {
  error: string;
  message: string;
  retryable: boolean;
}

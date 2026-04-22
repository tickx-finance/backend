// ==================== Contract ABI Interfaces ====================

// Common event signatures for all contracts that emit ExpectedWorkflowIdUpdated
export const workflowIdUpdatedAbiInterface = [
  'event ExpectedWorkflowIdUpdated(bytes32 indexed previousId, bytes32 indexed newId)',
];

export enum WorkflowIdUpdatedAbi {
  ExpectedWorkflowIdUpdated = 'ExpectedWorkflowIdUpdated(bytes32,bytes32)',
}

// ==================== CRE Events ABI Interfaces ====================

// PriceIntegrity contract events
export const priceIntegrityAbiInterface = [
  'event PriceIntegrityBatchReported(uint256 indexed epochId, uint256 windowStart, uint256 candleCount, bytes32 internalCandlesHash, bytes32 chainlinkCandlesHash, uint256 ohlcMaeBps, uint256 ohlcP95Bps, uint256 ohlcMaxBps, uint256 directionMatchBps, uint256 outlierCount, uint256 scoreBps, bytes32 diffMerkleRoot)',
  'event BatchSubmitted(uint256 indexed epochId, uint256 scoreBps, uint256 ohlcP95Bps, bool isPassed, uint8 failureFlags)',
];

export enum PriceIntegrityAbi {
  PriceIntegrityBatchReported = 'PriceIntegrityBatchReported(uint256,uint256,uint256,bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint256,bytes32)',
  BatchSubmitted = 'BatchSubmitted(uint256,uint256,uint256,bool,uint8)',
}

// Settlement contract events
export const settlementAbiInterface = [
  'event SettlementBatchCommitted(bytes32 indexed batchId, bytes32 merkleRoot, uint256 totalPayout, uint256 withdrawableCap, uint256 windowStart, uint256 windowEnd)',
];

export enum SettlementAbi {
  SettlementBatchCommitted = 'SettlementBatchCommitted(bytes32,bytes32,uint256,uint256,uint256,uint256)',
}

// PoolReserve contract events
export const poolReserveAbiInterface = [
  'event SolvencyReported(uint256 indexed epochId, uint256 poolBalance, uint256 totalLiability, uint256 utilizationBps, uint256 maxSingleBetExposure)',
];

export enum PoolReserveAbi {
  SolvencyReported = 'SolvencyReported(uint256,uint256,uint256,uint256,uint256)',
}

// LPDistributor contract events
export const lpDistributorAbiInterface = [
  'event CCIPDistributionRequested(uint256 indexed epochId, uint256 amount, uint64 dstChainSelector, address receiver)',
  'event ReserveAllocatedToDistributor(uint256 amount, address indexed receiver)',
];

export enum LPDistributorAbi {
  CCIPDistributionRequested = 'CCIPDistributionRequested(uint256,uint256,uint64,address)',
  ReserveAllocatedToDistributor = 'ReserveAllocatedToDistributor(uint256,address)',
}

// StrategyManager contract events
export const strategyManagerAbiInterface = [
  'event VolatilityRegimeChanged(uint256 indexed regimeId, uint256 fortressSpreadBps, uint256 maxMultiplier)',
];

export enum StrategyManagerAbi {
  VolatilityRegimeChanged = 'VolatilityRegimeChanged(uint256,uint256,uint256)',
}

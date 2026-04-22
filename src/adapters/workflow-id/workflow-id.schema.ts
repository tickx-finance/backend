import { BaseParsedEvent } from 'src/utils/base/base-parsed-event';

// ==================== ENUMS ====================
export enum WorkflowIdEvent {
  ExpectedWorkflowIdUpdated = 'ExpectedWorkflowIdUpdated',
}

export enum PriceIntegrityEvent {
  PriceIntegrityBatchReported = 'PriceIntegrityBatchReported',
  BatchSubmitted = 'BatchSubmitted',
}

export enum SettlementEvent {
  SettlementBatchCommitted = 'SettlementBatchCommitted',
}

export enum PoolReserveEvent {
  SolvencyReported = 'SolvencyReported',
}

export enum LPDistributorEvent {
  CCIPDistributionRequested = 'CCIPDistributionRequested',
  ReserveAllocatedToDistributor = 'ReserveAllocatedToDistributor',
}

export enum StrategyManagerEvent {
  VolatilityRegimeChanged = 'VolatilityRegimeChanged',
}

// ==================== DTOs ====================
export class ExpectedWorkflowIdUpdatedDto {
  previousId: string;
  newId: string;
}

// PriceIntegrity DTOs
export class PriceIntegrityBatchReportedDto {
  epochId: string;
  windowStart: string;
  candleCount: string;
  internalCandlesHash: string;
  chainlinkCandlesHash: string;
  ohlcMaeBps: string;
  ohlcP95Bps: string;
  ohlcMaxBps: string;
  directionMatchBps: string;
  outlierCount: string;
  scoreBps: string;
  diffMerkleRoot: string;
}

export class BatchSubmittedDto {
  epochId: string;
  scoreBps: string;
  ohlcP95Bps: string;
  isPassed: boolean;
  failureFlags: number;
}

// Settlement DTOs
export class SettlementBatchCommittedDto {
  batchId: string;
  merkleRoot: string;
  totalPayout: string;
  withdrawableCap: string;
  windowStart: string;
  windowEnd: string;
}

// PoolReserve DTOs
export class SolvencyReportedDto {
  epochId: string;
  poolBalance: string;
  totalLiability: string;
  utilizationBps: string;
  maxSingleBetExposure: string;
}

// LPDistributor DTOs
export class CCIPDistributionRequestedDto {
  epochId: string;
  amount: string;
  dstChainSelector: string;
  receiver: string;
}

export class ReserveAllocatedToDistributorDto {
  amount: string;
  receiver: string;
}

// StrategyManager DTOs
export class VolatilityRegimeChangedDto {
  regimeId: string;
  fortressSpreadBps: string;
  maxMultiplier: string;
}

// ==================== Parsed Events ====================
export class ParsedExpectedWorkflowIdUpdatedEvent extends BaseParsedEvent {
  type: WorkflowIdEvent.ExpectedWorkflowIdUpdated;
  args: ExpectedWorkflowIdUpdatedDto;
}

export class ParsedPriceIntegrityBatchReportedEvent extends BaseParsedEvent {
  type: PriceIntegrityEvent.PriceIntegrityBatchReported;
  args: PriceIntegrityBatchReportedDto;
}

export class ParsedBatchSubmittedEvent extends BaseParsedEvent {
  type: PriceIntegrityEvent.BatchSubmitted;
  args: BatchSubmittedDto;
}

export class ParsedSettlementBatchCommittedEvent extends BaseParsedEvent {
  type: SettlementEvent.SettlementBatchCommitted;
  args: SettlementBatchCommittedDto;
}

export class ParsedSolvencyReportedEvent extends BaseParsedEvent {
  type: PoolReserveEvent.SolvencyReported;
  args: SolvencyReportedDto;
}

export class ParsedCCIPDistributionRequestedEvent extends BaseParsedEvent {
  type: LPDistributorEvent.CCIPDistributionRequested;
  args: CCIPDistributionRequestedDto;
}

export class ParsedReserveAllocatedToDistributorEvent extends BaseParsedEvent {
  type: LPDistributorEvent.ReserveAllocatedToDistributor;
  args: ReserveAllocatedToDistributorDto;
}

export class ParsedVolatilityRegimeChangedEvent extends BaseParsedEvent {
  type: StrategyManagerEvent.VolatilityRegimeChanged;
  args: VolatilityRegimeChangedDto;
}

// ==================== Response ====================
export class WorkflowIdEventResponse {
  expectedWorkflowIdUpdatedEvents: ParsedExpectedWorkflowIdUpdatedEvent[];
  priceIntegrityBatchReportedEvents: ParsedPriceIntegrityBatchReportedEvent[];
  batchSubmittedEvents: ParsedBatchSubmittedEvent[];
  settlementBatchCommittedEvents: ParsedSettlementBatchCommittedEvent[];
  solvencyReportedEvents: ParsedSolvencyReportedEvent[];
  ccipDistributionRequestedEvents: ParsedCCIPDistributionRequestedEvent[];
  reserveAllocatedToDistributorEvents: ParsedReserveAllocatedToDistributorEvent[];
  volatilityRegimeChangedEvents: ParsedVolatilityRegimeChangedEvent[];
}

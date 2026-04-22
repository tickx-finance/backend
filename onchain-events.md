# CRE Event Indexing Spec (Backend)

## Purpose

Index all smart-contract events that represent successful CRE workflow writes so backend services can build reliable read models for app state, audit, and analytics.

## Scope

- Chain: target EVM chain(s) where Tap.fun contracts are deployed.
- Contracts:
  - `PriceIntegrity`
  - `Settlement`
  - `PoolReserve`
  - `LPDistributor`
  - `StrategyManager`
- Event source: successful transactions emitting CRE-related events (including forwarded CRE reports and equivalent direct admin calls).

## Indexing Rules

- Start block: deployment block per contract.
- Finality policy: index at `safe`/`finalized` confirmation level (recommended finalized for financial state).
- Idempotency key per log: `(chainId, txHash, logIndex)`.
- Reorg handling:
  - store `blockNumber`, `blockHash`, `txHash`, `logIndex`
  - on reorg, remove/rewrite orphaned logs.
- Store raw log + decoded payload for every indexed event.

## Events To Index

## 1) Price Integrity

### Event: `PriceIntegrityBatchReported`
```solidity
event PriceIntegrityBatchReported(
  uint256 indexed epochId,
  uint256 windowStart,
  uint256 candleCount,
  bytes32 internalCandlesHash,
  bytes32 chainlinkCandlesHash,
  uint256 ohlcMaeBps,
  uint256 ohlcP95Bps,
  uint256 ohlcMaxBps,
  uint256 directionMatchBps,
  uint256 outlierCount,
  uint256 scoreBps,
  bytes32 diffMerkleRoot
);
```
- Business unique key: `(chainId, contractAddress, epochId)`.

### Event: `BatchSubmitted`
```solidity
event BatchSubmitted(
  uint256 indexed epochId,
  uint256 scoreBps,
  uint256 ohlcP95Bps,
  bool isPassed,
  uint8 failureFlags
);
```
- Business unique key: `(chainId, contractAddress, epochId)`.
- Note: `isPassed`/`failureFlags` are authoritative pass/fail outputs for backend status.

## 2) Settlement

### Event: `SettlementBatchCommitted`
```solidity
event SettlementBatchCommitted(
  bytes32 indexed batchId,
  bytes32 merkleRoot,
  uint256 totalPayout,
  uint256 withdrawableCap,
  uint256 windowStart,
  uint256 windowEnd
);
```
- Business unique key: `(chainId, contractAddress, batchId)`.

## 3) Pool Solvency PoR

### Event: `SolvencyReported`
```solidity
event SolvencyReported(
  uint256 indexed epochId,
  uint256 poolBalance,
  uint256 totalLiability,
  uint256 utilizationBps,
  uint256 maxSingleBetExposure
);
```
- Business unique key: `(chainId, contractAddress, epochId)`.

## 4) LP Distribution

### Event: `CCIPDistributionRequested`
```solidity
event CCIPDistributionRequested(
  uint256 indexed epochId,
  uint256 amount,
  uint64 dstChainSelector,
  address receiver
);
```
- Business unique key: `(chainId, contractAddress, epochId, dstChainSelector, receiver)`.

### Event: `ReserveAllocatedToDistributor`
```solidity
event ReserveAllocatedToDistributor(
  uint256 amount,
  address indexed receiver
);
```
- Business correlation: join to `CCIPDistributionRequested` by `(txHash)` first, then fallback by `(receiver, amount, blockNumber proximity)`.

## 5) Strategy Rebalance

### Event: `VolatilityRegimeChanged`
```solidity
event VolatilityRegimeChanged(
  uint256 indexed regimeId,
  uint256 fortressSpreadBps,
  uint256 maxMultiplier
);
```
- Business unique key: `(chainId, contractAddress, regimeId)`.

## Suggested Backend Tables

- `price_integrity_batches`
  - `epoch_id`, `window_start`, `candle_count`, `score_bps`, `is_passed`, `failure_flags`, hashes, metadata.
- `settlement_batches`
  - `batch_id`, `merkle_root`, `total_payout`, `withdrawable_cap`, window bounds.
- `solvency_reports`
  - `epoch_id`, `pool_balance`, `total_liability`, `utilization_bps`, `max_single_bet_exposure`.
- `lp_distribution_requests`
  - `epoch_id`, `amount`, `dst_chain_selector`, `receiver`, `reserve_allocated_tx_hash`.
- `volatility_regimes`
  - `regime_id`, `fortress_spread_bps`, `max_multiplier`.
- `chain_event_logs` (raw canonical log store)
  - `chain_id`, `contract_address`, `block_number`, `block_hash`, `tx_hash`, `log_index`, `event_name`, `topics`, `data`, `decoded_json`.

## Processing Checklist

- [ ] Subscribe/poll logs for all target contracts.
- [ ] Decode and persist all events in this spec.
- [ ] Upsert read-model tables by business unique keys.
- [ ] Keep raw canonical log table for replay/rebuild.
- [ ] Implement reorg-safe rollback/replay logic.
- [ ] Backfill from deployment block to current head.

## Non-Scope Events

Do not treat these as CRE workflow success signals:
- `RoleUpdated`
- LP/trader user action events (`LPDeposited`, `TraderDeposited`, etc.)
- receiver admin/security events from `ReceiverTemplate`
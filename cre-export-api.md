# CRE Workflows - Acceptance Criteria & API Specifications

## Overview

This document defines the acceptance criteria for each of the 5 Chainlink Runtime Environment (CRE) workflows. Since official APIs and deployed contracts are not yet available, this spec also defines:

1. **API Contracts** - What the app backend must provide
2. **Mock Specifications** - How to test workflows without real APIs
3. **Acceptance Criteria** - What "done" looks like for each workflow
4. **Testing Strategy** - How to validate workflows in isolation

---

## API Contracts (App Backend → CRE)

### Base URL
```
APP_API_BASE_URL (configured via CRE secrets)
```

### Authentication
All API requests include:
```
Authorization: Bearer {APP_API_KEY}
```

---

### API 1: Price Integrity - OHLC Candles

**Endpoint:** `GET /api/v1/ohlc`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `windowStart` | integer | Unix timestamp (seconds) |
| `windowEnd` | integer | Unix timestamp (seconds) |
| `source` | string | `"internal"` or `"chainlink"` |

**Response (200 OK):**
```json
{
  "windowStart": 1704067200,
  "windowEnd": 1704068100,
  "candles": [
    {
      "timestamp": 1704067200,
      "open": "96240.50",
      "high": "96280.00",
      "low": "96230.00",
      "close": "96260.00"
    }
  ],
  "count": 900,
  "hash": "0xabc123..."
}
```

**Error Response (4xx/5xx):**
```json
{
  "error": "data_unavailable",
  "message": "Candles not available for requested window",
  "retryable": true
}
```

---

### API 2: Settlement - Pending Batches

**Endpoint:** `GET /api/v1/settlement/batches/pending`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `windowStart` | integer | Unix timestamp (seconds) |
| `windowEnd` | integer | Unix timestamp (seconds) |

**Response (200 OK):**
```json
{
  "batches": [
    {
      "batchId": "batch_2024_01_01_00_00",
      "windowStart": 1704067200,
      "windowEnd": 1704068100,
      "deposits": [
        { "account": "0x...", "amount": "1000000000000000000" }
      ],
      "withdrawals": [
        { "account": "0x...", "amount": "500000000000000000" }
      ],
      "settlements": [
        {
          "account": "0x...",
          "betId": "bet_123",
          "outcome": "WIN",
          "payout": "2000000000000000000",
          "originalStake": "1000000000000000000"
        }
      ]
    }
  ]
}
```

---

### API 3: Settlement - Mark Batch Committed

**Endpoint:** `POST /api/v1/settlement/batches/{batchId}/committed`

**Request Body:**
```json
{
  "txHash": "0x...",
  "merkleRoot": "0x...",
  "committedAt": 1704068200
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "batchId": "batch_2024_01_01_00_00"
}
```

---

### API 4: Pool Solvency - Liability Data

**Endpoint:** `GET /api/v1/risk/liability`

**Response (200 OK):**
```json
{
  "timestamp": 1704067200,
  "totalLiability": "50000000000000000000000",
  "utilizationBps": 500,
  "maxSingleBetExposure": "1000000000000000000000",
  "outstandingBets": 150,
  "breakdown": {
    "byBand": [...],
    "byTimeWindow": [...]
  }
}
```

---

### API 5: LP Distribution - Pending Batches

**Endpoint:** `GET /api/v1/distribution/batches/pending`

**Response (200 OK):**
```json
{
  "batches": [
    {
      "epochId": 1,
      "totalRewards": "10000000000000000000000",
      "snapshotBlock": 12345678,
      "lpShares": [
        { "lp": "0x...", "shares": "1000000000000000000000" }
      ],
      "destinations": [
        {
          "chainSelector": 16015286601757825753,
          "receiver": "0x...",
          "amount": "5000000000000000000000"
        }
      ]
    }
  ]
}
```

---

### API 6: Strategy - Current Regime

**Endpoint:** `GET /api/v1/strategy/current`

**Response (200 OK):**
```json
{
  "regimeId": 1,
  "fortressSpreadBps": 150,
  "maxMultiplier": 100,
  "effectiveTs": 1704067200,
  "volatilityIndex": "0.45",
  "regimeName": "NORMAL"
}
```

---

## Mock API Specification (for Testing)

Since real APIs aren't available, workflows will use mock implementations that return deterministic data based on input parameters.

### Mock Pattern
```typescript
// Mock API returns deterministic data based on window/epoch
const getMockOhlcData = (windowStart: number, source: string): OhlcResponse => {
  // Deterministic pseudo-random based on windowStart
  const seed = windowStart;
  return {
    windowStart,
    windowEnd: windowStart + 900,
    candles: generateCandles(seed, 900),
    count: 900,
    hash: keccak256(toHex(seed))
  };
};
```

### Mock Data Generators

#### 1. Mock OHLC Candles
- Generate 900 1-second candles
- Base price: ~$96,000 BTC
- Volatility: ±0.1% per candle
- Deterministic based on `windowStart` seed

#### 2. Mock Settlement Batches
- 1-3 deposits per batch
- 0-2 withdrawals per batch
- 5-10 settlements per batch
- 70% WIN rate, 30% LOSS rate

#### 3. Mock Liability Data
- Total liability: 10,000 - 50,000 tokens
- Utilization: 5% - 15%
- Max exposure: 1,000 - 5,000 tokens

#### 4. Mock LP Distribution
- 3-5 LPs per batch
- Rewards: 1,000 - 10,000 tokens
- 1-2 destination chains

#### 5. Mock Strategy Regime
- 3 regimes: LOW_VOL (1), NORMAL (2), HIGH_VOL (3)
- Rotates based on epoch

---

## Workflow 1: Price Integrity - Acceptance Criteria

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| PI-1 | Workflow triggers every 15 minutes via cron | MUST |
| PI-2 | Fetches both internal and Chainlink OHLC candles | MUST |
| PI-3 | Computes per-candle error: `err_i = avg(abs((Oi-Or)/Or, ...)) * 10000` | MUST |
| PI-4 | Computes aggregates: MAE, P95, Max, direction match, outliers | MUST |
| PI-5 | Computes score using formula: `scoreBps = weighted(sum(metrics))` | MUST |
| PI-6 | Derives `isPassed = scoreBps >= 9000 && p95 <= 50` | MUST |
| PI-7 | Derives `failureFlags` bitmask | MUST |
| PI-8 | Computes deterministic hashes for both candle sets | MUST |
| PI-9 | Submits report to `PriceIntegrity.submitBatchComparison()` | MUST |
| PI-10 | Checks on-chain for existing epoch before write (idempotency) | MUST |

### Quality Criteria

| ID | Criteria | How to Validate |
|----|----------|-----------------|
| PI-Q1 | Deterministic output | Same input → Same output (hashes, score) |
| PI-Q2 | Pass/fail both stored | Failed batches still written with flags |
| PI-Q3 | No duplicate writes | Idempotency prevents double submission |
| PI-Q4 | Handles API failures | Retries with exponential backoff |

### Mock Testing

```typescript
// Test: Perfect match → PASS
const window = 1704067200;
mockApi.setMatchRate(1.0); // 100% match
const result = await workflow.run(window);
expect(result.isPassed).toBe(true);
expect(result.scoreBps).toBeGreaterThan(9000);

// Test: Noisy data → FAIL with flags
mockApi.setMatchRate(0.7); // 70% match
const result = await workflow.run(window);
expect(result.isPassed).toBe(false);
expect(result.failureFlags).toBeGreaterThan(0);
```

---

## Workflow 2: Settlement - Acceptance Criteria

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| ST-1 | Workflow triggers every 15 minutes via cron | MUST |
| ST-2 | Fetches pending settlement batches from app API | MUST |
| ST-3 | Canonicalizes records (sorts by account, dedupes) | MUST |
| ST-4 | Computes per-account net settlement | MUST |
| ST-5 | Builds Merkle tree from account outcomes | MUST |
| ST-6 | Computes `merkleRoot`, `totalPayout`, `withdrawableCap` | MUST |
| ST-7 | Submits to `Settlement.commitSettlementBatch()` | MUST |
| ST-8 | Marks batch committed in app API with tx hash | MUST |
| ST-9 | Skips already-committed batches (idempotency) | MUST |
| ST-10 | Handles multiple batches per cron tick | SHOULD |

### Quality Criteria

| ID | Criteria | How to Validate |
|----|----------|-----------------|
| ST-Q1 | Deterministic Merkle root | Same accounts → Same root |
| ST-Q2 | Idempotent commits | Re-running doesn't duplicate |
| ST-Q3 | Correct payout sum | Sum of WIN payouts = totalPayout |
| ST-Q4 | API sync | Batch marked committed after on-chain success |

### Mock Testing

```typescript
// Test: Single batch settlement
mockApi.addBatch({
  batchId: "batch_1",
  deposits: [{ account: "0xA", amount: "1000" }],
  settlements: [{ account: "0xA", outcome: "WIN", payout: "2000" }]
});
const result = await workflow.run();
expect(result.committedBatches).toHaveLength(1);
expect(result.merkleRoot).toMatch(/^0x[a-f0-9]{64}$/);

// Test: Idempotency
await workflow.run(); // First run
const result2 = await workflow.run(); // Second run
expect(result2.committedBatches).toHaveLength(0); // Skipped
```

---

## Workflow 3: Pool Solvency PoR - Acceptance Criteria

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| PS-1 | Workflow triggers daily via cron | MUST |
| PS-2 | Reads `poolBalance` from on-chain `PoolReserve` | MUST |
| PS-3 | Fetches `totalLiability` from app API | MUST |
| PS-4 | Computes `solvencyRatio = poolBalance / totalLiability` | MUST |
| PS-5 | Fetches `utilizationBps` and `maxSingleBetExposure` | MUST |
| PS-6 | If ratio >= 1.5x, submits to `PoolReserve.reportSolvency()` | MUST |
| PS-7 | If ratio < 1.5x, emits alert and skips write (no revert) | MUST |
| PS-8 | If liability = 0, treats as healthy (infinite ratio) | MUST |
| PS-9 | Checks for existing epoch before write | MUST |

### Quality Criteria

| ID | Criteria | How to Validate |
|----|----------|-----------------|
| PS-Q1 | Accurate ratio | On-chain read + API data = correct math |
| PS-Q2 | No under-threshold writes | Ratio < 1.5x → No on-chain tx |
| PS-Q3 | Zero liability handled | Division by zero avoided |
| PS-Q4 | Daily cadence | Runs exactly once per day |

### Mock Testing

```typescript
// Test: Healthy ratio
mockEvm.setPoolBalance("30000000000000000000000"); // 30k
mockApi.setLiability("10000000000000000000000"); // 10k
const result = await workflow.run();
expect(result.ratio).toBe(3.0); // 3x
expect(result.submitted).toBe(true);

// Test: Unhealthy ratio
mockEvm.setPoolBalance("10000000000000000000000"); // 10k
mockApi.setLiability("10000000000000000000000"); // 10k
const result = await workflow.run();
expect(result.ratio).toBe(1.0); // 1x
expect(result.submitted).toBe(false);
expect(result.alert).toBeDefined();

// Test: Zero liability
mockApi.setLiability("0");
const result = await workflow.run();
expect(result.submitted).toBe(true);
```

---

## Workflow 4: LP Distribution - Acceptance Criteria

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| LP-1 | Workflow triggers daily via cron | MUST |
| LP-2 | Fetches pending distribution batches from app API | MUST |
| LP-3 | For each batch, computes total distributable amount | MUST |
| LP-4 | For each destination, computes `amountForDst` | MUST |
| LP-5 | Calls `PoolReserve.allocateReserveToLPDistributor(totalAmount, ...)` | MUST |
| LP-6 | For each destination, calls `LPDistributor.queueDistribution(...)` | MUST |
| LP-7 | Records tx hashes for all operations | MUST |
| LP-8 | Handles partial failures (idempotent reruns) | MUST |
| LP-9 | Skips already-processed epochs | MUST |

### Quality Criteria

| ID | Criteria | How to Validate |
|----|----------|-----------------|
| LP-Q1 | Reserve allocated once | Same epoch → Single allocation |
| LP-Q2 | Deterministic amounts | Same shares → Same distribution |
| LP-Q3 | Multi-destination support | Handles 1-5 destinations |
| LP-Q4 | Partial failure recovery | Failed destinations retried |

### Mock Testing

```typescript
// Test: Single distribution
mockApi.addDistributionBatch({
  epochId: 1,
  totalRewards: "10000",
  destinations: [
    { chainSelector: 16015286601757825753, receiver: "0xA", amount: "5000" },
    { chainSelector: 14767482510784806043, receiver: "0xB", amount: "5000" }
  ]
});
const result = await workflow.run();
expect(result.allocations).toHaveLength(1);
expect(result.queues).toHaveLength(2);

// Test: Idempotency
await workflow.run();
const result2 = await workflow.run();
expect(result2.allocations).toHaveLength(0); // Skipped
```

---

## Workflow 5: Strategy Rebalance - Acceptance Criteria

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| SR-1 | Workflow triggered via HTTP request (PoC) | MUST |
| SR-2 | Authenticates request (signature/API key) | MUST |
| SR-3 | Validates payload: `regimeId`, `spreadBps`, `maxMultiplier` | MUST |
| SR-4 | Checks value ranges (spread > 0, multiplier > 0) | MUST |
| SR-5 | Fetches current strategy state from app API | MUST |
| SR-6 | If payload equals current state, skips write (no-op) | MUST |
| SR-7 | Otherwise, calls `StrategyManager.setVolatilityRegime(...)` | MUST |
| SR-8 | Emits success telemetry with tx hash | MUST |

### Quality Criteria

| ID | Criteria | How to Validate |
|----|----------|-----------------|
| SR-Q1 | Auth enforcement | Bad signature → No write |
| SR-Q2 | No-op detection | Same params → No on-chain tx |
| SR-Q3 | Range validation | Out-of-range → Rejected before write |
| SR-Q4 | Deterministic idempotency | Same regimeId → Single write |

### Mock Testing

```typescript
// Test: Valid regime change
const payload = {
  regimeId: 2,
  fortressSpreadBps: 200,
  maxMultiplier: 50
};
mockApi.setCurrentRegime({ regimeId: 1, ... }); // Different
const result = await workflow.run(payload);
expect(result.submitted).toBe(true);
expect(result.txHash).toBeDefined();

// Test: No-op (same as current)
mockApi.setCurrentRegime(payload); // Same
const result = await workflow.run(payload);
expect(result.submitted).toBe(false);
expect(result.reason).toBe("no_op");

// Test: Invalid auth
const result = await workflow.run(payload, { badSignature: true });
expect(result.submitted).toBe(false);
expect(result.error).toContain("unauthorized");
```

---

## Testing Strategy

### 1. Unit Tests (per workflow)
```
test/
├── price-integrity.test.ts
├── settlement.test.ts
├── pool-solvency.test.ts
├── lp-distribution.test.ts
└── strategy-rebalance.test.ts
```

### 2. Integration Tests
- Mock API server
- Local EVM simulation (anvil)
- Full workflow runs with mock data

### 3. Simulation Tests
```bash
# Local simulation
cre workflow simulate price-integrity --target local-simulation
cre workflow simulate settlement --target local-simulation
...
```

### 4. Acceptance Test Matrix

| Workflow | Unit | Integration | Simulation |
|----------|------|-------------|------------|
| Price Integrity | ✅ | ✅ | ✅ |
| Settlement | ✅ | ✅ | ✅ |
| Pool Solvency | ✅ | ✅ | ✅ |
| LP Distribution | ✅ | ✅ | ✅ |
| Strategy Rebalance | ✅ | ✅ | ✅ |

---

## Definition of Done (for CRE Phase)

A workflow is considered **done** when:

1. ✅ Code implements all MUST requirements
2. ✅ Unit tests cover 80%+ of code paths
3. ✅ Integration tests pass with mock APIs
4. ✅ Simulation runs successfully with `cre workflow simulate`
5. ✅ Determinism verified (same input → same output)
6. ✅ Idempotency verified (re-runs don't duplicate)
7. ✅ Error handling tested (API failures, reverts)
8. ✅ Documentation complete (README + inline comments)
9. ✅ Config schema validated with Zod
10. ✅ Secrets template provided (no hardcoded values)

---

## Next Steps

1. **Review** this acceptance criteria document
2. **Confirm** API contracts with app team
3. **Approve** mock data approach
4. **Begin** workflow implementation (Slide order: 1→5)
5. **Validate** each workflow against acceptance criteria

**Ready to proceed?** Confirm acceptance criteria and I'll begin building the workflows.

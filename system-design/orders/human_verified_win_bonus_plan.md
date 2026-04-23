# Human-Verified Win Bonus Plan

## Goal

Add a configurable extra win bonus for users with `humanVerified = true`.

Rule:

- Applies only on winning orders.
- Applied during settlement.
- Bonus rate is configurable as `x%`.
- `userId` remains the canonical wallet address.

Example:

- stake = `100`
- base `rewardRate = 2.0`
- human-verified win bonus = `5%`
- effective payout multiplier = `2.0 * 1.05 = 2.1`
- credited amount on win = `210`

## Current State

Current win settlement behavior:

- [order.service.ts](/Users/sniperman/code/tapfun-be/src/modules/order/order.service.ts) calls:
  - `accountService.settleBet(userId, amount, win, rewardRate, marketId, cellId)`
- [account.service.ts](/Users/sniperman/code/tapfun-be/src/modules/account/account.service.ts) computes win payout as:
  - `amount * rewardRate`
- [settlement.service.ts](/Users/sniperman/code/tapfun-be/src/modules/settlement/settlement.service.ts) independently recomputes API payout projection from `Order`
- `Order` currently persists:
  - `amount`
  - `rewardRate`
  - `settledWin`
  - `settledAt`
- `LedgerEntry` currently persists only:
  - event type
  - economic key
  - balance delta

Implication:

- If we add the bonus only in `AccountService`, account balance will be correct, but settlement batch API can drift because it recomputes payout from base `rewardRate`.
- If we do not persist bonus-related settlement data, audit/debug later will be weak.

## Design Direction

Treat the human-verified win bonus as a settlement-time multiplier adjustment, not as a grid pricing change.

That means:

- grid quote generation stays unchanged
- order placement stays unchanged
- only the realized payout on a winning settlement changes

This is the lowest-blast-radius approach and matches the product requirement.

## Proposed Formula

Definitions:

- `baseRewardRate`: existing order `rewardRate`
- `bonusRateBps`: configurable bonus percent in basis points
- `isEligible`: user auth profile has `humanVerified = true` at settlement time

Formula:

- if loss: payout = `0`
- if win and not eligible: payout = `amount * baseRewardRate`
- if win and eligible:
  - `effectiveRewardRate = baseRewardRate * (1 + bonusRateBps / 10000)`
  - `payout = amount * effectiveRewardRate`

Precision:

- keep decimal-string arithmetic via `BigNumber`
- round down to current account precision boundary
- avoid `Number(...)` for final monetary calculation

## Source Of Truth

The credited balance mutation in `AccountService.settleBet(...)` must be the source of truth.

Everything else should derive from persisted settlement data produced from that path:

- websocket fanout
- settlement batch API
- analytics/debug

Do not let `SettlementService` maintain a separate payout formula long term.

## Required Data Changes

We need to persist the realized settlement economics on the order row.

Add to `orders`:

- `settledPayout numeric nullable`
- `settledRewardRate numeric nullable`
- `settlementBonusBps integer nullable`
- `settlementHumanVerified boolean nullable`

Why:

- `rewardRate` remains the original grid reward rate at placement time
- `settledRewardRate` captures the actual effective multiplier used at settlement
- `settledPayout` captures the actual credited payout
- `settlementBonusBps` captures which config was applied
- `settlementHumanVerified` captures the eligibility state used for the decision

This keeps settlement replay, audit, and API projection deterministic even if config changes later.

Optional later improvement:

- add `metadata jsonb` to `ledger_entries` for richer audit fields
- not required for first rollout if order row stores final settlement economics

## Config

Add new config:

- `HUMAN_VERIFIED_WIN_BONUS_BPS`
  - integer
  - default `0`

Notes:

- `0` means disabled
- use basis points, not float percent, to avoid config ambiguity
- keep it in app config so rollout can happen without schema redesign later

## Integration Points

### 1. Settlement Eligibility Lookup

At settlement time, resolve `humanVerified` by `userId` from `UserAuthProfileService`.

Decision point:

- use the user profile state at settlement time, not at order placement time

Reason:

- simpler rollout
- no order schema change needed at placement time
- matches the requirement wording: reward bonus is applied when the order wins at settlement

If product later wants "must be verified before placing the order", that is a separate rule.

### 2. Account Settlement

Extend `AccountService.settleBet(...)` to accept either:

- a richer settlement input object, or
- extra optional args:
  - `effectiveRewardRate`
  - `settledPayout`

Recommended:

- introduce a settlement input object to stop growing positional args

Example shape:

```ts
settleBet({
  userId,
  amount,
  win,
  marketId,
  cellId,
  baseRewardRate,
  effectiveRewardRate,
  settlementBonusBps,
  settlementHumanVerified,
})
```

`AccountService` should only apply the provided realized payout math.

### 3. Order Settlement Orchestration

In `OrderService.settleOrder(...)`:

1. load user auth profile
2. compute settlement bonus eligibility
3. compute:
   - `effectiveRewardRate`
   - `settledPayout`
4. call `AccountService.settleBet(...)`
5. persist settlement fields on `Order`
6. fanout order update

This keeps business policy in `OrderService`, and accounting mutation in `AccountService`.

### 4. Settlement Batch API

Update `SettlementService.calculatePayout(...)` to stop recomputing from `amount * rewardRate` when realized settlement fields exist.

Priority:

1. use `order.settledPayout` if present
2. otherwise fall back to legacy formula for old rows

This gives backward compatibility for historical orders without forced backfill.

## Phase Plan

### Phase 1 - Config And Calculation Boundary

Tasks:

- Add `HUMAN_VERIFIED_WIN_BONUS_BPS` to config.
- Add a dedicated calculator/helper for:
  - effective reward rate
  - settled payout
- Keep it pure and unit-tested.

Exit criteria:

- The project has one canonical settlement bonus formula with deterministic rounding.

Implementation note:

- Added config `HUMAN_VERIFIED_WIN_BONUS_BPS` with default `0`.
- Exposed config at `env.order.humanVerifiedWinBonusBps`.
- Added pure helper [human-verified-win-bonus.ts](/Users/sniperman/code/tapfun-be/src/modules/order/human-verified-win-bonus.ts) to compute:
  - `settledRewardRate`
  - `settledPayout`
  - `settlementBonusBps`
  - `settlementHumanVerified`
- Helper uses `BigNumber` end to end and rounds down at `9` decimal places to match the current account settlement precision boundary.
- Added unit tests covering:
  - disabled bonus
  - unverified user
  - verified user with bonus
  - rounding behavior
  - invalid bonus input normalization

### Phase 2 - Persist Realized Settlement Fields

Tasks:

- Add migration for:
  - `orders.settledPayout`
  - `orders.settledRewardRate`
  - `orders.settlementBonusBps`
  - `orders.settlementHumanVerified`
- Update `Order` entity.

Exit criteria:

- Orders can store realized settlement economics without changing placement flow.

Implementation note:

- Added additive-only order fields:
  - `settledPayout numeric null`
  - `settledRewardRate numeric null`
  - `settlementBonusBps integer null`
  - `settlementHumanVerified boolean null`
- Updated [order.entity.ts](/Users/sniperman/code/tapfun-be/src/modules/order/entities/order.entity.ts) with matching nullable columns.
- Added manual migration [1777100000000-OrderSettlementBonusFieldsPhase2.ts](/Users/sniperman/code/tapfun-be/src/migrations/1777100000000-OrderSettlementBonusFieldsPhase2.ts).
- Migration only adds nullable columns and does not modify or backfill existing data.

### Phase 3 - Wire Bonus Into Order Settlement

Tasks:

- Inject `UserAuthProfileService` into `OrderModule` path used for settlement.
- In `OrderService.settleOrder(...)`, compute eligibility and effective payout.
- Pass realized settlement values into `AccountService.settleBet(...)`.
- Persist realized fields on the order row.

Exit criteria:

- Winning settlements for human-verified users credit the extra bonus into account balance.
- Non-verified users keep existing payout.

Implementation note:

- `OrderModule` now imports `AuthModule` so settlement can read `UserAuthProfileService`.
- `OrderService.settleOrder(...)` now:
  - loads `humanVerified` by `order.userId`
  - computes realized settlement values with the Phase 1 helper
  - passes `effectiveRewardRate` into `AccountService.settleBet(...)`
  - persists:
    - `settledPayout`
    - `settledRewardRate`
    - `settlementBonusBps`
    - `settlementHumanVerified`
- `AccountService.settleBet(...)` remains backward-compatible and now accepts an optional `effectiveRewardRate`.
- Added order integration coverage for a human-verified winner receiving the configured `2%` bonus.

### Phase 4 - Make Settlement API Read Realized Payout

Tasks:

- Update `SettlementService` to use `settledPayout` first.
- Optionally expose:
  - `settledRewardRate`
  - `settlementBonusBps`
  - `settlementHumanVerified`
  in API types if downstream consumers need visibility.

Exit criteria:

- Settlement batch API matches the actual account credit path.

Implementation note:

- Updated [settlement.service.ts](/Users/sniperman/code/tapfun-be/src/modules/settlement/settlement.service.ts) so payout selection is:
  1. `order.settledPayout` when present
  2. legacy fallback formula from `amount * rewardRate` for historical rows
- Kept settlement API response contract unchanged; only the payout source changed.
- Added tests in [settlement.service.spec.ts](/Users/sniperman/code/tapfun-be/src/modules/settlement/settlement.service.spec.ts) for:
  - realized payout path
  - historical fallback path
  - loss path

### Phase 5 - Tests And Rollout

Tasks:

- Add unit tests for calculation helper:
  - no bonus
  - eligible bonus
  - disabled config
  - rounding edge cases
- Add integration tests covering:
  - verified winner gets boosted payout
  - verified loser gets no bonus
  - unverified winner gets base payout
  - historical orders without `settledPayout` still serialize in settlement API
- Roll out with default bonus `0`.

Exit criteria:

- Feature can ship dark, then be enabled by config.

## Key Decisions

### Why not modify `rewardRate` on the order itself?

Because `rewardRate` currently represents the grid quote at placement time.

Changing that field during settlement would blur:

- quoted odds at order creation
- actual payout multiplier after human-verified bonus

Keep both:

- `rewardRate` = original quote
- `settledRewardRate` = realized multiplier

### Why apply eligibility at settlement time instead of order placement time?

Because the requirement explicitly says the bonus is handled in settlement, and this avoids pushing auth/profile state into the order placement path.

This is also easier to roll out safely.

### Why persist `settledPayout` instead of recomputing forever?

Because config is mutable.

If `HUMAN_VERIFIED_WIN_BONUS_BPS` changes later, recomputation from base fields will no longer reproduce the exact credited amount for past settlements.

Persisting realized payout avoids audit drift.

## Risks

- If `SettlementService` is not updated, external settlement batches will disagree with actual balances.
- If bonus math uses `Number`, decimal precision drift will appear.
- If eligibility is checked from JWT/session instead of DB profile, payout can depend on stale auth state.
- If websocket payload needs to display realized payout later, current event shape will need extension.

## Recommended First Implementation Scope

Minimum safe slice:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4

That is enough to make:

- balances correct
- order records auditable
- settlement batch API consistent

without changing grid pricing or order placement behavior.

# Grid Module Fortress Migration Plan

## Goal

Migrate the current NestJS Grid Module from the existing polynomial reward surface to the mathematical QTAP/Fortress pipeline described in `pipeline_full_e2e.md` and implemented in Python in:

- `/Users/sniperman/code/tapfun-model/fortress/engine.py`
- `/Users/sniperman/code/tapfun-model/fortress/service.py`

This plan focuses on replacing the Grid Module quote generation path only. Order/account integration should continue to use the existing `Cell` contract shape initially:

```ts
{
  gridTs: number;
  startTs: number;
  endTs: number;
  lowerPrice: string;
  upperPrice: string;
  rewardRate: string;
  gridSignature: string;
}
```

The target `rewardRate` should map from Fortress `M_final`.

## Current State

Current implementation:

- File: `src/modules/grid/grid.service.ts`
- Updates every `250ms`.
- Reads latest trade from `PriceService.getLatestTrade()`.
- Builds a fixed rectangular grid:
  - `TIME_CELL = 5s`
  - `PRICE_CELL = 25`
  - `NX = 10`
  - `NY = 9`
  - anchor offset `x = 2`
- Computes `rewardRate` with a static polynomial model:
  - input: `(dx, dy)`
  - output: `rewardRate.toFixed(6)`
- Signs each cell and emits `grid_update`.

Target model:

- State cadence: `1s`.
- Contract/grid cadence: `5s` windows.
- Principal mode:
  - `mode_id = "5"`
  - `band_width = 5`
  - `row_count = 20`
  - `center_row = 9`
  - windows `[a+5,a+10) ... [a+60,a+65)`
  - betable from `T_start >= a + 10`
- Quote pipeline:
  - 1s close return -> EWMA volatility
  - jump detection -> Hawkes intensity
  - deterministic MC + antithetic paths + jumps
  - Brownian Bridge one-touch probability
  - `P_raw` -> margin/skew/safety -> `M_final`

## Migration Principles

1. Preserve external client/order compatibility during the first migration.
2. Port the math in small deterministic units with golden tests against Python outputs.
3. Keep `Cell` signature stable until Order Module explicitly migrates to richer quote metadata.
4. Avoid putting stochastic logic directly inside `GridService`; use a dedicated engine class.
5. Keep the runtime path measurable. MC can be CPU-heavy, so the initial rollout should include throttling and feature flags.

## Phase 0 - Contract And Baseline Freeze

Objective: lock the current behavioral boundary before replacing the internals.

Tasks:

- Add integration/golden tests around current `GridService` output shape.
- Snapshot expected `Cell` fields consumed by:
  - Socket grid update payload
  - Order placement signature validation
  - Order settlement cell reconstruction
- Document current assumptions:
  - `rewardRate` string format
  - `lowerPrice`/`upperPrice` precision
  - `startTs`/`endTs` absolute milliseconds
  - `gridTs` semantics
- Decide the unit convention for the new engine:
  - Python Fortress uses oracle seconds for `T_start/T_end`.
  - NestJS currently uses milliseconds.
  - Migration should keep external `Cell` in milliseconds and keep Fortress internals in seconds.

Exit criteria:

- Tests prove existing clients can still parse grid payloads.
- A compatibility mapping from Fortress quote to `Cell` is written and reviewed.

## Phase 1 - TypeScript Fortress Domain Types

Objective: introduce the target model vocabulary without changing runtime behavior.

New suggested files:

- `src/modules/grid/fortress-engine/fortress.types.ts`
- `src/modules/grid/fortress-engine/fortress.config.ts`
- `src/modules/grid/fortress-engine/fortress-cell.mapper.ts`

Port from Python:

- `ModeConfig`
- `GlobalConfig`
- `ModeState`
- `OracleState`
- `FortressCell`
- `Quote`
- `BandWidthDecision`

Principal defaults:

- `modeId = "5"`
- `bandWidth = 5`
- `windows = [[5,10], [10,15], ..., [60,65]]`
- `rowCount = 20`
- `centerRow = 9`
- `mBase = 0.022`
- `mRiskMax = 0.025`
- `mMin = 1.05`
- `mMax = 25`
- `hlSeconds = 20`
- `kappa0 = 3.1`
- `kappaQ = 0.5`
- `kappaMin = 2.7`
- `kappaMax = 6.0`
- `mcNMin = 500`
- `mcNMax = 1000`
- `adaptiveMc = true`

Mapping to existing `Cell`:

- `gridTs = timeAnchor * 1000`
- `startTs = quote.T_start * 1000`
- `endTs = quote.T_end * 1000`
- `lowerPrice = normalizePrice(quote.L)`
- `upperPrice = normalizePrice(quote.R)`
- `rewardRate = quote.M_final.toFixed(6)` initially
- `gridSignature = signCell(cell, CELL_SIGNER_KEY)`

Exit criteria:

- Types compile.
- Unit test verifies one sample Fortress quote maps to stable existing `Cell` signature fields.

## Phase 2 - Oracle And 1s State Adapter

Objective: feed the engine with 1s OHLCV-style state instead of raw latest trade snapshots.

Current `PriceService` exposes latest trade. Fortress requires:

- `S_t` close
- previous close
- optional high/low for settlement/diagnostics
- oracle second

Tasks:

- Add `GridOracleStateService` adapter under `src/modules/grid/fortress-engine`.
- Aggregate latest price ticks into closed 1s bars.
- On each closed second:
  - compute close-to-close log return
  - pass `(oracleSecond, close, high, low)` into engine
- Keep grid broadcast decoupled from oracle update:
  - state update cadence: 1s
  - socket render/broadcast cadence can remain 250ms only if reusing latest quote surface.

Important rule:

- Volatility core uses close-to-close return:
  - `vObs = r * r`
  - `parkinsonWeight = 0` for main path.

Exit criteria:

- Deterministic test feeds a fixed price series and verifies:
  - oracle second alignment
  - time anchor `a = 5 * floor(t / 5)`
  - EWMA input return values.

Phase 2 implementation note:

- `GridOracleStateService` now produces closed 1-second bars with `logReturn`, `volatilityObservation = logReturn^2`, and `timeAnchorSecond`.
- `GridService` feeds latest trades into the adapter while keeping the existing legacy grid broadcast path unchanged.

## Phase 3 - Port Volatility, Jump Detection, Hawkes

Objective: implement the non-MC state transitions first.

New suggested file:

- `src/modules/grid/fortress-engine/fortress-state-engine.ts`

Port:

- EWMA variance:
  - `alphaVol = exp(-ln(2) / hlSeconds)`
  - `vNow = (1 - alphaVol) * r^2 + alphaVol * vPrev`
  - `sigmaRaw = sqrt(max(vNow, varianceFloor))`
- Sigma final:
  - default path: no sigma scaling, no price scaling
- Jump detection:
  - `z = abs(r) / (sigmaRaw + epsilon)`
  - `sigmaRatio = max(sigmaRaw / sigmaRef, epsilon)`
  - `kappa = clamp(kappa0 * sigmaRatio^kappaQ, kappaMin, kappaMax)`
  - `jumpFlag = z > kappa`
- Hawkes:
  - `lambdaNext = mu0 + exp(-beta) * (lambdaPrev - mu0) + alpha * jumpFlag`
- Jump sampler:
  - record historical non-zero returns with magnitude and sign.

Exit criteria:

- Golden tests compare TS state output against Python for a fixed close series.
- State transitions are deterministic and independent from socket broadcast timing.

Phase 3 implementation note:

- `FortressStateEngine` now applies EWMA variance, raw/final sigma, adaptive kappa jump detection, Hawkes intensity, ATR, and jump sample recording from closed 1-second oracle updates.
- `GridService` feeds closed oracle bars through the state engine while keeping legacy grid generation unchanged.

## Phase 4 - Port Grid Geometry

Objective: replace fixed `NX/NY/PRICE_CELL=25` geometry with Fortress principal mode geometry.

Port `_build_cells(price)`:

- `timeAnchor = floor(oracleSecond / 5) * 5`
- `anchorPrice = floor(price / bandWidth) * bandWidth`
- For `row in 0..19`:
  - `center = anchorPrice + (row - centerRow) * bandWidth`
  - `L = center - bandWidth / 2`
  - `R = center + bandWidth / 2`
- For each configured window:
  - `T_start = timeAnchor + windowStart`
  - `T_end = timeAnchor + windowEnd`
  - `cellId = row * windows.length + windowIndex`
- `betable = T_start >= timeAnchor + 10`

Compatibility behavior:

- For initial NestJS grid payload, filter to `betable` cells or include all cells based on current FE expectation.
- Recommended: include only betable cells for client/order safety, or include `betable` in a new quote metadata payload before filtering.

Exit criteria:

- Given `oracleSecond` and `price`, TS generates exactly same `(row, window, L, R, T_start, T_end, cellId)` as Python.
- Existing `OrderService.placeOrder` deadline check still accepts generated cells.

Phase 4 implementation note:

- `buildFortressGridGeometry` now ports Python `_build_cells(price)` for principal mode, including time anchor, price anchor, row/window geometry, cell id encoding, and betable flag.
- `FortressStateEngine` rebuilds and stores current geometry after each closed oracle update.
- Legacy `GridService` socket broadcast still uses the old grid model until quote probabilities/multipliers are ready.

## Phase 5 - Deterministic RNG And Monte Carlo Paths

Objective: port the stochastic path generation with reproducible output.

Port:

- Deterministic RNG seed key:
  - `seed + modeId + oracleSecond + price`
- Antithetic variates:
  - generate half normal eps
  - mirror `-eps`
- Diffusion:
  - `returns = -0.5 * sigma^2 + sigma * eps`
- Hawkes jump bridge:
  - `pJump = 1 - exp(-lambdaIntensity)`
  - Bernoulli mask per path/step
  - sample jump magnitudes/signs from `JumpSampler`
- Cumulative paths:
  - `logPaths = cumsum(returns) + log(price)`
  - `pricePaths = exp(logPaths)`

Implementation options:

- Short-term: pure TypeScript arrays for correctness, lower `mcN` behind feature flag.
- Medium-term: optimized numeric arrays (`Float32Array`) and batch processing.
- Later: worker thread pool if event loop latency becomes unacceptable.

Exit criteria:

- Golden tests compare statistical/golden deterministic samples against Python with same seed.
- Runtime does not block socket loop beyond accepted budget in local benchmark.

Phase 5 implementation note:

- `simulateFortressPaths` now generates deterministic GBM paths with optional antithetic variates, Itô correction, Hawkes jump masks, jump sampling, cumulative log paths, and a start-price column.
- `stableSeed` mirrors the Python seed payload formatting and uses the first 8 little-endian bytes of BLAKE2b-512 in Node; NumPy `default_rng` stream parity is intentionally not claimed because runtime does not embed NumPy.
- Path generation remains an isolated pure function until Brownian Bridge `P_raw` is wired in Phase 6.

## Phase 6 - Brownian Bridge P_raw

Objective: compute one-touch probability per cell and window.

Port `_brownian_bridge_hit`:

- Inputs: segment start/end vectors, `L`, `R`, `sigma`, `dt=1`
- Rules:
  - endpoint in `[L,R]` => `1`
  - both below `L` => `zeta(L)`
  - both above `R` => `zeta(R)`
- `zeta(x) = exp(clip((-2 * log(x/s0) * log(x/s1)) / (sigma^2 * dt + varianceFloor), -inf, 0))`

Port `_compute_pwin_matrix`:

- For each cell, slice segment range:
  - `tStart = (T_start - oracleSecond) + lockOffset`
  - `tEnd = (T_end - oracleSecond) + lockOffset`
- Path-level touch:
  - `pWin = 1 - product(1 - pHitSegment)`
- Cell `P_raw`:
  - mean of `pWin` across paths.

Exit criteria:

- Exact `P_raw` matrix for a fixed synthetic path set matches Python.
- Edge cases covered:
  - price already in band
  - both endpoints below
  - both endpoints above
  - expired/empty horizon.

Phase 6 implementation note:

- `computeBrownianBridgeHitProbability` ports the per-segment one-touch Brownian Bridge rules.
- `computeFortressPWinMatrix` computes per-path/per-cell `P_win`, `P_raw`, and `pRawByCellId` from Fortress geometry and path matrices.
- `computeFortressAdaptivePWinMatrix` now ports the Python adaptive MC loop: start with `mcNMin=500`, estimate per-cell absolute SE and relative error, and append another deterministic batch until thresholds pass or `mcNMax=1000` is reached.
- Phase 6 remains isolated from socket broadcast; Phase 7 will consume `P_raw` to produce `M_final` quotes.

## Phase 7 - Quote Layer: P_raw To M_final

Objective: compute `rewardRate` from `M_final` instead of polynomial model.

Port:

- `mEff = mBase + clamp(aSigma * sigmaTerm + aLambda * lambdaTerm, 0, mRiskMax)`
- `pRawModel`
- Optional calibration/boosts default off initially:
  - `pRawGamma = 0`
  - `pNearBoost = 0`
  - `pTimeBoost = 0`
  - `pCalibration = null`
- `mBase = (1 - mEff) / pRaw`
- Liability skew:
  - initially pass empty liability map so `K_skew = 1`
  - later wire from risk/account/order exposure
- Safety:
  - initially `K_safety = 1` unless `winMatrix` and liability vector are wired
- `M_final = clamp(mBase * K_skew * K_safety, mMin, mMax)`

Initial product mapping:

- `rewardRate = M_final.toFixed(6)`

Exit criteria:

- Quote list exposes `P_raw`, `P_raw_model`, `M_final`, `betable` internally.
- Socket payload preserves legacy `Cell[]`.
- Debug endpoint or log can inspect full quote metadata during rollout.

Phase 7 implementation note:

- `buildFortressQuotes` converts geometry + `P_raw` into internal `FortressQuote[]` with `P_raw`, `P_raw_model`, `M_base`, `M_final`, `K_skew`, `K_safety`, `band_width`, `atr_mean`, liability, and `betable`.
- `computeFortressEffectiveMargin` ports `mEff = mBase + clamp(aSigma*sigmaTerm + aLambda*lambdaTerm, 0, mRiskMax)`.
- The existing mapper converts betable quotes into the legacy signed `Cell[]` socket shape.
- Liability skew is supported as an optional map, but defaults to neutral empty-liability behavior for rollout.
- `M_final` now includes the Python idle center penalty: when `atr_mean <= band_width`, center-row multipliers are compressed by window-interpolated divisors `1.5 -> 1.2`, adjacent rows by `1.3 -> 1.1`.

Adaptive dS implementation note:

- `selectAdaptiveFortressBandWidth` ports the Python seed policy `snap(D, bandwidthAlpha * price * sigma_final)`.
- `FortressStateEngine` updates `bandWidthCurrent` from that decision before rebuilding geometry, so generated geometry/quotes no longer use fixed `dS=5`.
- `selectFinalFortressBandWidth` now wires exact-surface refinement from Python `select_final_band_width`: candidate exact surface, `C_near`, `E_far`, conflict fallback, off-center floor-risk fallback, and one-step widen/narrow decisions.
- `FortressStateEngine.updateOracle(update, { runPricing: false })` now matches Python `run_pricing=False`: it absorbs oracle close/high/low, EWMA volatility, jump detection, and Hawkes intensity without MC/exact-surface refinement, geometry rebuild, or quote work.

## Phase 8 - GridService Integration

Objective: replace the current model in `GridService` with the new engine.

Suggested structure:

- `GridService`
  - owns loop and publishing
  - no pricing math
- `FortressGridEngine`
  - state update
  - grid geometry
  - MC/BB quote generation
- `FortressQuoteMapper`
  - quote -> legacy `Cell`

Runtime flow:

1. `GRID_ENGINE=fortress` is the default runtime path. Price Module emits/records 1s OHLCV close.
2. `GRID_ENGINE=legacy` remains as a deprecated fallback that bypasses the Fortress pipeline and keeps the old polynomial grid generation path.
3. Grid service updates Fortress state once per closed oracle second.
4. Pricing cadence:
   - First `FORTRESS_BANDWIDTH_WARMUP_TICKS=100` closed ticks run `runPricing=true` so the engine can publish a warmup quote surface.
   - During warmup, only the final warmup tick sets `refreshBandWidth=true`; earlier warmup ticks keep the current dS and do not run `selectFinalFortressBandWidth`.
   - After warmup, only every `FORTRESS_BANDWIDTH_REFRESH_TICKS=3600` closed ticks runs `runPricing=true` with `refreshBandWidth=true` to refresh adaptive dS and quote surface.
   - All other closed ticks run `runPricing=false`, absorbing oracle price, volatility, jump detection, Hawkes intensity, and ATR without MC/quote work.
5. When pricing runs, engine rebuilds cells, computes adaptive MC paths/BB `P_raw`, builds quotes, and maps betable quotes to signed legacy `Cell[]`.
6. Between pricing ticks, socket publishing reuses the last Fortress `Cell[]` surface.
7. `eventPublisher.emitGridUpdate(cells)` publishes.

Feature flags:

- `GRID_ENGINE=fortress|legacy` (`fortress` default, `legacy` deprecated fallback)
- `FORTRESS_BANDWIDTH_WARMUP_TICKS=100`
- `FORTRESS_BANDWIDTH_REFRESH_TICKS=3600`
- `FORTRESS_MC_N_MIN`
- `FORTRESS_MC_N_MAX`
- `FORTRESS_EMIT_FULL_DEBUG=false`

Exit criteria:

- Fortress is the default engine.
- Deprecated legacy engine can still be toggled on with `GRID_ENGINE=legacy`.
- Fortress engine produces valid signed cells accepted by Order Module.
- `benchmark:e2e:slo` can run with Fortress grid.

## Phase 9 - Tests And Golden Artifacts

Required tests:

- Unit:
  - EWMA/Hawkes state transition
  - cell geometry
  - Brownian Bridge
  - quote mapping/signature
- Golden:
  - fixed Python input fixture -> TS output for:
    - `sigma`
    - `lambda`
    - cells
    - selected `P_raw`
    - selected `M_final`
- Integration:
  - Grid emits betable cells.
  - Order can place a bet with a Fortress cell.
  - Settlement still reconstructs matching cell boundaries.
- Performance:
  - quote generation latency per oracle second
  - event loop delay
  - memory allocation profile

Golden artifact source:

- Use Python `tapfun-model/fortress/engine.py` to generate JSON fixtures.
- Store fixtures under `src/modules/grid/fortress-engine/__fixtures__` or `test/fixtures/fortress`.

Exit criteria:

- `yarn test:e2e --run` covers grid -> order acceptance.
- Unit/golden tests protect math parity before rollout.

## Phase 10 - Rollout And Observability

Rollout steps:

1. Deploy with `GRID_ENGINE=legacy`, Fortress running shadow-only.
2. Compare legacy vs Fortress surfaces in logs/metrics.
3. Enable Fortress for internal users/testnet only.
4. Run `yarn benchmark:e2e:slo` against Fortress grid.
5. Enable production after:
   - quote latency within budget
   - no order signature mismatch
   - no settlement boundary mismatch
   - no account overspend or decimal payout reject.

Metrics:

- `grid.engine.quote_duration_ms`
- `grid.engine.mc_paths`
- `grid.engine.cells_emitted`
- `grid.engine.oracle_lag_ms`
- `grid.engine.sigma`
- `grid.engine.lambda`
- `grid.engine.band_width`
- `grid.engine.p_raw_min/max`
- `grid.engine.m_final_min/max`
- `grid.engine.event_loop_delay_ms`

Operational safeguards:

- Circuit breaker to legacy grid if quote generation fails.
- Reuse last good Fortress grid for a short TTL if MC fails.
- Never emit unsigned cells.
- Never emit non-integer-unfriendly reward values until Account/Order payout conversion is explicit.

## Open Questions Before Implementation

1. Should socket `grid_update` continue sending only legacy `Cell[]`, or should it include quote metadata (`P_raw`, `M_final`, `betable`, `row`, `windowIndex`)?
2. Should non-betable `[a+5,a+10)` cells be hidden from FE or emitted with a `betable=false` flag?
3. Should `rewardRate` remain decimal multiplier string, or should OrderService convert payout into integer base-unit before AccountService?
4. Is liability skew required in first rollout, or should `K_skew=1` until order exposure tracking is ready?
5. What is the acceptable per-second quote generation CPU budget in Node?
6. Should MC run in the main Nest process, a worker thread, or a separate pricing service?

## Recommended First Implementation Slice

Start with a correctness slice, not full performance:

1. Add Fortress types/config.
2. Port EWMA/Hawkes state.
3. Port cell geometry.
4. Map generated Fortress cells to existing signed `Cell[]`.
5. Add golden tests for geometry and state.
6. Gate with `GRID_ENGINE=fortress`.

Only after that, add MC/Brownian Bridge and replace `rewardRate` with `M_final`.

This avoids mixing three risks at once: new geometry, new stochastic pricing, and runtime performance.

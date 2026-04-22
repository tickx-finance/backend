# Payment Production Chain Sync Migration Plan

## Goal

Migrate Payment Module from client-callable debug/mock APIs to a production flow where:

- Deposits and withdrawals are synced from `WorldchainPoolReserve` contract events into Account ledger events.
- Withdrawal request creates an off-chain session and returns a claim/withdraw signature signed by `CLAIM_SIGNER_PRIVATE_KEY`.
- Debug endpoints are removed or hard-disabled outside local/test.
- Account Service remains the only balance mutation boundary.

New env:

```env
QUOTE_ASSET_ADDRESS=0x8603a12c549007a3AFE026EFAD797640Bda30760
RESERVE_POOL_ADDRESS=0x6351b3006aAE72a36006614310928930Ac229d0e
RPCS=rpc1,rpc2,rpc3
CLAIM_SIGNER_PRIVATE_KEY=
```

Contract ABI:

- `src/abi/WorldchainPoolReserve.json`

Relevant contract surface:

- Events:
  - `TraderDeposited(trader indexed, amount)`
  - `TraderWithdrawn(trader indexed, amount)`
  - `TraderClaimed(trader indexed, amount)`
  - `ClaimSignerUpdated(previousSigner indexed, newSigner indexed)`
- Read functions:
  - `asset()`
  - `claimSigner()`
  - `nonces(address)`
  - `getClaimDigest(trader, amount, nonce, deadline)`
- User functions:
  - `depositTrader(amount)`
  - `withdrawTrader(amount, deadline, adminSignature)`
  - `claimTrader(amount, deadline, adminSignature)`

## Phase 1 - Config, Contract Client, And Signature Primitive

Objective: make chain integration explicit and verifiable before changing balances.

Tasks:

- Extend config validation:
  - `QUOTE_ASSET_ADDRESS`
  - `RESERVE_POOL_ADDRESS`
  - `RPCS`
  - `CLAIM_SIGNER_PRIVATE_KEY`
- Add a `PaymentChainClient` provider:
  - Builds viem/ethers public clients from `RPCS`.
  - Uses fallback RPC rotation/retry.
  - Loads `WorldchainPoolReserve` ABI.
  - Verifies at startup:
    - `pool.asset() == QUOTE_ASSET_ADDRESS`
    - `pool.claimSigner() == address(CLAIM_SIGNER_PRIVATE_KEY)`
- Add `WithdrawalClaimSigner`:
  - Reads current nonce from `nonces(user)`.
  - Calls `getClaimDigest(user, amount, nonce, deadline)`.
  - Signs digest with `CLAIM_SIGNER_PRIVATE_KEY`.
  - Returns `{ amount, deadline, nonce, signature, reservePoolAddress, quoteAssetAddress }`.

Exit criteria:

- Service refuses to boot if env is missing or signer/asset mismatch.
- Unit test signs a digest and recovers the expected claim signer.
- No balance mutations are changed in this phase.

Implementation note:

- `PaymentChainClient` is wired into `PaymentModule`, loads `WorldchainPoolReserve` ABI, reads `asset`, `claimSigner`, `nonces`, and `getClaimDigest`, and verifies non-local/non-test boot config.
- `WithdrawalClaimSigner` signs raw contract digests with `CLAIM_SIGNER_PRIVATE_KEY` and returns transaction-ready signature metadata.
- Config now exposes `env.web3.rpcs` and `env.payment.{quoteAssetAddress,reservePoolAddress,claimSignerPrivateKey}`.

## Phase 2 - Chain Cursor And Event Sync Worker

Objective: replace debug event ingestion with deterministic on-chain event sync.

Tasks:

- Add `payment_chain_cursors` table:
  - `contractAddress`
  - `chainId`
  - `lastProcessedBlock`
  - `updatedAt`
- Add `PaymentChainSyncWorker`:
  - Polls `RESERVE_POOL_ADDRESS` logs from `lastProcessedBlock + 1`.
  - Uses a confirmation depth before processing.
  - Splits large ranges into bounded chunks.
  - Retries across `RPCS`.
- Decode and route:
  - `TraderDeposited` -> deposit pipeline.
  - `TraderWithdrawn` -> withdrawal success pipeline.
  - `TraderClaimed` -> claim/deposit-like pipeline if product uses claim as balance credit; otherwise store audit-only.
- Persist raw event metadata:
  - `txHash`
  - `logIndex`
  - `blockNumber`
  - `blockHash`
  - `trader`
  - `amount`
  - `eventName`

Exit criteria:

- Worker can replay from an old block without double-applying ledger events.
- Cursor advances only after all events in a range are persisted and applied.
- Re-running the worker is idempotent.

Implementation note:

- Added `payment_chain_cursors` and `payment_chain_events` entities plus migration.
- `PaymentChainClient` can now read latest block, fetch logs for `TraderDeposited`, `TraderWithdrawn`, and `TraderClaimed`, and decode them into normalized event records.
- `PaymentChainSyncWorker.syncOnce()` reads from cursor, applies confirmation depth and chunk size, persists raw events idempotently by `(txHash, logIndex)`, and advances cursor only after each chunk is saved.
- Polling is gated by `PAYMENT_CHAIN_SYNC_ENABLED`; default is disabled until rollout.

## Phase 3 - Ledger Mapping And Production History Models

Objective: make Account ledger the source of truth for every chain event.

Tasks:

- Update `deposit_history`:
  - Keep unique `(txHash, logIndex)`.
  - Add `blockNumber`, `blockHash`, `contractAddress`, `chainId`.
  - Amount precision should match account decimal precision, not integer-only.
- Update `withdrawal_history`:
  - Keep unique `(txHash, logIndex)`.
  - Add `blockNumber`, `blockHash`, `contractAddress`, `chainId`.
  - Link to `sessionId` when possible.
- Deposit mapping:
  - `TraderDeposited(trader, amount)` calls `AccountService.deposit(trader, amount, txHash, logIndex)`.
- Withdrawal mapping:
  - `TraderWithdrawn(trader, amount)` finds matching OPEN session by `userId + amount`.
  - Calls `AccountService.withdrawSucceeded(userId, amount, txHash, logIndex)`.
  - Marks session `SUCCESS`.
- If no matching session exists:
  - Store event in history/audit.
  - Do not mutate account unless product explicitly permits direct withdrawal reconciliation.
  - Emit alert for manual review.

Exit criteria:

- Duplicate logs do not create duplicate ledger entries.
- Existing `AccountService` economic keys remain stable.
- Integration tests cover replay, duplicate event, and missing session cases.

Implementation note:

- `PaymentChainEventProcessor` maps `TraderDeposited` to `AccountService.deposit` and writes `deposit_history` with chain metadata.
- `TraderWithdrawn` matches the oldest OPEN withdrawal session for the trader by BigNumber amount, calls `AccountService.withdrawSucceeded`, closes the session, writes `withdrawal_history`, and emits withdraw success.
- Unmatched `TraderWithdrawn` events are marked `AUDIT_ONLY` with an error reason and do not mutate account balances.
- `TraderClaimed` is currently `AUDIT_ONLY` until product claim accounting is explicitly enabled.
- `PaymentChainSyncWorker` now processes pending raw events after each persisted log chunk and also when no new blocks are available.

## Phase 4 - Production Withdrawal Session API

Objective: turn `/payment/withdraw` into a production claim-signing session API.

Tasks:

- Replace `MockOnChainService.signWithdrawalApproval` with `WithdrawalClaimSigner`.
- On `POST /payment/withdraw`:
  - Validate decimal amount.
  - Ensure no existing OPEN session unless returning it.
  - Lock funds via `AccountService.withdrawRequested`.
  - Build deadline from session expiry.
  - Read current chain nonce for user.
  - Sign claim digest with `CLAIM_SIGNER_PRIVATE_KEY`.
  - Save session with:
    - `approvalSignature`
    - `deadline`
    - `nonce`
    - `reservePoolAddress`
    - `quoteAssetAddress`
- Response includes transaction-ready fields:
  - `reservePoolAddress`
  - `method: withdrawTrader`
  - `amount`
  - `deadline`
  - `signature`
  - `nonce`
- Session closes only when the worker observes `TraderWithdrawn`.
- Expiry unlocks funds if no chain withdrawal event was observed.

Exit criteria:

- Client no longer calls debug finalize.
- A user can request withdraw, submit contract tx, and worker settles it from event.
- Signature fails if nonce/deadline/amount/user are altered.

Implementation note:

- `PaymentService.requestWithdrawal` now uses `WithdrawalClaimSigner` instead of `MockOnChainService`.
- New sessions lock funds, compute a 15-minute deadline, sign `getClaimDigest`, persist `approvalSignature`, `deadline`, `nonce`, `reservePoolAddress`, and `quoteAssetAddress`, and return tx-ready `{ method: 'withdrawTrader', amount, deadline, signature }` metadata.
- Existing OPEN sessions return their stored signature metadata instead of creating a new signature or relocking funds.
- Session success still comes from the chain event processor observing `TraderWithdrawn`; debug finalize remains only until Phase 5 removes debug APIs.

## Phase 5 - Debug Removal, Backfill, And Rollout

Objective: safely cut over production without leaving mock mutation paths open.

Tasks:

- Remove or hard-disable:
  - `POST /payment/debug/deposit`
  - `POST /payment/debug/finalize-withdrawal`
  - `POST /payment/debug/expire-timeout`
- Keep expiry internal/admin-only if needed.
- Backfill:
  - Choose start block for `RESERVE_POOL_ADDRESS`.
  - Run worker in dry-run mode to compare event counts and totals.
  - Run worker live after audit.
- Add observability:
  - Last processed block.
  - RPC failure count.
  - Deposit/withdraw events processed.
  - Ledger apply failures.
  - Unmatched withdrawal events.
- Add runbooks:
  - Rewind cursor safely.
  - Replay a block range.
  - Rotate `CLAIM_SIGNER_PRIVATE_KEY`.
  - Pause worker without disabling withdrawal request API.

Exit criteria:

- Production deploy has no client-callable mock balance mutation APIs.
- Worker catches up from configured start block and stays within acceptable lag.
- Manual replay does not double-credit or double-withdraw.
- All new env vars are required in staging/prod.

Implementation note:

- Debug mutation endpoints remain callable only in `local/test`; staging/production return `403`.
- `PaymentWithdrawalExpiryWorker` periodically finds OPEN sessions with `expiresAt < now`, calls `PaymentService.expireWithdrawal`, and unlocks funds through Account ledger cancellation.
- Added API-key protected observability endpoints:
  - `GET /payment/chain-sync/status`
  - `POST /payment/chain-sync/run-once`
- Chain sync status returns worker enabled/running state, configured confirmations/chunk/poll settings, cursor positions, event counts by event/status, and latest RPC block or RPC error.

## Production Runbook

### Enable Chain Sync

1. Set `PAYMENT_CHAIN_SYNC_START_BLOCK` to the first trusted reserve-pool deployment block.
2. Keep `PAYMENT_CHAIN_SYNC_ENABLED=false`.
3. Deploy migrations and app.
4. Call `POST /payment/chain-sync/run-once` with `APP_API_KEY` on staging/prod and inspect `GET /payment/chain-sync/status`.
5. Set `PAYMENT_CHAIN_SYNC_ENABLED=true` when event counts and ledger effects are correct.

### Withdrawal Timeout Worker

- Enabled by `PAYMENT_WITHDRAWAL_EXPIRY_ENABLED=true`.
- Poll interval: `PAYMENT_WITHDRAWAL_EXPIRY_POLL_MS`.
- Batch size: `PAYMENT_WITHDRAWAL_EXPIRY_BATCH_SIZE`.
- The worker calls the same `expireWithdrawal(sessionId)` path used by manual local/test expiry, so cancellation is idempotent through Account economic keys.

### Worker Process Separation

- `PaymentModule` providers are still available in the main API process for withdrawal session creation and admin status endpoints.
- Chain sync and withdrawal expiry polling are not started by `PaymentModule` lifecycle hooks.
- Start background polling in a dedicated process:
  - dev: `yarn dev:payment-worker`
  - production: `yarn start:payment-worker`
- The dedicated worker process boots `PaymentWorkerModule`, starts `PaymentChainSyncWorker` and `PaymentWithdrawalExpiryWorker`, and stops both on Nest shutdown.

### Rewind Cursor Safely

1. Pause polling with `PAYMENT_CHAIN_SYNC_ENABLED=false`.
2. Update the row in `payment_chain_cursors.lastProcessedBlock` to one block before the replay range.
3. Call `POST /payment/chain-sync/run-once`.
4. Confirm duplicate raw logs are ignored by `(txHash, logIndex)` and already-applied ledger events are not duplicated.

### Handle Unmatched Withdrawals

1. Query `payment_chain_events` where `eventName='TraderWithdrawn'` and `ledgerStatus='AUDIT_ONLY'`.
2. Inspect `ledgerError`.
3. Reconcile manually before changing the event back to `PENDING`.

### Rotate Claim Signer

1. Update contract `claimSigner`.
2. Update `CLAIM_SIGNER_PRIVATE_KEY`.
3. Restart app and confirm boot-time signer verification passes.

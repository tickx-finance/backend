# Worldchain Mini-App Auth Migration Plan

## Goal

Add a second authentication option for users coming from Worldchain Mini App while keeping the existing EVM wallet address as the single `userId` across the system.

Constraint:

- `userId` remains the canonical wallet address.
- Mini-app users are still expected to resolve to an EVM address.
- We avoid migrating account/order/payment/socket/follow storage away from `address`.

## Current State

Current auth assumptions:

- `/auth/challenge` and `/auth/login` support wallet-signature login only.
- `JWT.sub = address`.
- `JwtAuthGuard` maps request user to `{ address: payload.sub }`.
- WSS key generation and validation are keyed by address.
- Business modules use `userId` as the address string.

This is good for backward compatibility and should be preserved.

## Proposed Model

Keep identity stable:

- `userId = walletAddress`

Add auth/profile metadata:

- `authType`
  - `wallet`
  - `miniapp`
- `humanVerified: boolean`
- `miniAppUserId?: string`

This means:

- account, order, payment, socket rooms, and follow subscriptions stay keyed by address
- only auth, profile, and policy surfaces need to be extended

## Data Model

Add a small profile table for auth metadata.

Suggested entity: `user_auth_profiles`

- `address` unique
- `lastAuthType enum('wallet', 'miniapp')`
- `miniAppUserId text nullable`
- `humanVerified boolean default false`
- `humanVerifiedAt timestamp nullable`
- `humanVerificationSource text nullable`
- `createdAt`
- `updatedAt`

Notes:

- If `mini-app-user/entities/user.entity.ts` already contains enough fields and is intended to be the source of truth, it can be reused.
- Even if reused, the lookup key for app auth integration should still be the canonical wallet address.

## JWT Contract

Keep:

- `sub = address`

Add:

- `authType`
- `humanVerified`
- `miniAppUserId?`

Example:

```json
{
  "sub": "0xabc...",
  "authType": "miniapp",
  "humanVerified": true,
  "miniAppUserId": "world_123"
}
```

## Runtime User Shape

Update `JwtAuthGuard` to expose:

```ts
{
  address: string;
  authType: 'wallet' | 'miniapp';
  humanVerified: boolean;
  miniAppUserId?: string | null;
}
```

Important:

- Existing controllers/services can continue using `user.address`.
- New business rules can read `user.authType` and `user.humanVerified`.

## Auth Flows

### Existing Wallet Login

Keep unchanged:

- `GET /auth/challenge`
- `POST /auth/login`

On successful login:

- ensure a `user_auth_profile` row exists for the address
- set `lastAuthType = 'wallet'`
- keep or preserve `humanVerified` from prior state unless product explicitly wants wallet login to downgrade/clear it
- issue JWT + WSS key

### New Mini-App Login

Add:

- `POST /auth/miniapp/login`

Input and verification logic should follow the example flow in `mini-app-user`.

Expected server steps:

1. Verify mini-app auth payload according to Worldchain Mini App example.
2. Extract canonical wallet address.
3. Extract mini-app user id.
4. Verify human status from the mini-app proof/path.
5. Upsert `user_auth_profile`.
6. Issue JWT + WSS key with `sub = address`.

Result:

- The same address can log in through either wallet or mini-app.
- The backend keeps one user identity and richer auth metadata.

## WSS Behavior

No identity migration needed.

Keep:

- `generateWssKey(address)`
- `validateWssSignature(address, ...)`
- socket private room `user:<address>`

This is a major benefit of keeping address as `userId`.

Mini-app login just needs to request WSS key the same way wallet users do after JWT issuance.

## Business Policy Surface

Do not scatter mini-app checks throughout modules.

Add a small policy/helper layer:

- optional future `UserEligibilityService`
  - answers business questions like:
    - can faucet?
    - can withdraw?
    - can place high-size order?
    - can follow others?

This keeps policy logic centralized.

## Phase Plan

### Phase 1 - Auth Metadata Model

Tasks:

- Add `user_auth_profiles` entity and migration.
- Add enums or constants for:
  - `authType`
- Add a service for profile upsert/read by address.

Exit criteria:

- The backend can persist auth metadata for an address.
- No login flow is changed yet.

Implementation note:

- Added `user_auth_profiles` entity with:
  - `address`
  - `lastAuthType`
  - `miniAppUserId`
  - `humanVerified`
  - `humanVerifiedAt`
  - `humanVerificationSource`
- Added migration `1777000000000-UserAuthProfilesPhase1`.
- Added `UserAuthProfileService` with `getByAddress(address)` and `upsert(...)`.
- Wired `UserAuthProfileService` into `AuthModule`.
- Added unit tests for create, update, and read flows.

### Phase 2 - JWT And Guard Extension

Tasks:

- Extend JWT payload contract:
  - `sub`
  - `authType`
  - `humanVerified`
  - `miniAppUserId?`
- Update `JwtAuthGuard` to attach enriched user object.
- Keep backward compatibility by preserving `user.address`.
- Update `CurrentUser` consumers only where new fields are needed.

Exit criteria:

- Existing wallet flows still work.
- Controllers can read `user.address` as before.
- New fields are available in guarded handlers.

Implementation note:

- Added JWT payload/runtime user types:
  - `AuthJwtPayload`
  - `AuthenticatedUser`
- `JwtAuthGuard` now attaches:
  - `address`
  - `authType`
  - `humanVerified`
  - `miniAppUserId`
- Guard preserves backward compatibility by keeping `user.address` as the canonical field used by existing modules.
- `AuthService.generateJwt(...)` now supports enriched claims; existing wallet login currently issues defaults:
  - `authType = wallet`
  - `humanVerified = false`
  - `miniAppUserId = null`

### Phase 3 - Wallet Login Backfill Into Profile

Tasks:

- On successful wallet login:
  - create profile row if missing
  - set `lastAuthType = wallet`
- Decide whether wallet login should preserve previous `humanVerified` or leave it unchanged.
- Add tests for:
  - first wallet login creates profile
  - repeated wallet login does not break existing profile

Exit criteria:

- Wallet users receive enriched JWT claims without any DB identity migration.

Implementation note:

- `AuthService.login(...)` now upserts `user_auth_profiles` on successful wallet login with:
  - `address`
  - `lastAuthType = wallet`
- Existing `humanVerified` and `miniAppUserId` profile state are preserved because wallet login only updates `lastAuthType`.
- Wallet JWT issuance now carries profile snapshot fields:
  - `authType = wallet`
  - `humanVerified`
  - `miniAppUserId`
- Added auth tests covering wallet-login profile backfill and JWT claim preservation.

### Phase 4 - Mini-App Login Integration

Tasks:

- Add `POST /auth/miniapp/login`.
- Implement verification using the example flow under `mini-app-user`.
- Extract:
  - address
  - mini app user id
  - human verification status
- Upsert profile:
  - `lastAuthType = miniapp`
  - `miniAppUserId`
  - `humanVerified`
  - `humanVerifiedAt`
  - `humanVerificationSource`
- Issue JWT + WSS key with `sub = address`.

Exit criteria:

- A mini-app user can authenticate and gets the same identity (`address`) used by all business modules.
- Claims distinguish verified vs unverified mini-app users.

Implementation note:

- Added `POST /auth/miniapp/login`.
- Added auth DTOs for:
  - mini-app wallet payload
  - optional human proof payload
- Added `MiniAppAuthVerifier` inside `AuthModule` to keep Worldchain mini-app verification behind a single boundary.
- Current verifier behavior follows the local example flow shape:
  - verifies signed mini-app login payload against `address`
  - requires the signed message to include the provided `nonce`
  - optionally marks the user as human-verified when a matching `humanProof.signal` is provided for the same address
- `AuthService.loginMiniApp(...)` now upserts `user_auth_profiles` with:
  - `lastAuthType = miniapp`
  - `miniAppUserId`
  - `humanVerified`
  - `humanVerifiedAt`
  - `humanVerificationSource`
- Mini-app login issues the same JWT/WSS credential pair used by the wallet flow, with:
  - `sub = address`
  - `authType = miniapp`
  - `humanVerified`
  - `miniAppUserId`

### Phase 5 - Policy Adaptation

Tasks:

- Add centralized policy checks based on:
  - `authType`
  - `humanVerified`
- Apply policy only where needed, for example:
  - faucet
  - follow subscriptions
  - promotional features
  - order/risk limits
- Avoid changing storage keys or room names.

Exit criteria:

- Product features can branch on mini-app verified/unverified status without changing `userId`.

### Phase 6 - Observability And Recovery

Tasks:

- Add metrics:
  - wallet logins
  - mini-app logins
  - verified vs unverified mini-app logins
- Add admin/debug visibility for a user's auth profile.
- Add runbook for:
  - human verification refresh
  - profile correction if mini-app verification source changes

Exit criteria:

- Auth source and human verification state are debuggable in production.

## Changes We Intentionally Avoid

We do **not** migrate these to a new principal id:

- `ledger_entries.userId`
- `ledger_snapshots.userId`
- `orders.userId`
- `withdrawal_session.userId`
- socket user room naming
- follow subscription identity fields

All of those remain wallet-address keyed.

## Gap To Current World App Flow

The current `AuthModule` mini-app implementation is only a lightweight placeholder and does **not** yet match the newer flow under:

- [worldapp.ts](/Users/sniperman/code/tapfun-be/src/libs/worldapp/worldapp.ts)
- [siwe.ts](/Users/sniperman/code/tapfun-be/src/libs/worldapp/siwe.ts)
- [mini-app-user/user.service.ts](/Users/sniperman/code/tapfun-be/mini-app-user/user.service.ts)

Current gaps:

- login verifier currently checks a plain signed message, not full World App SIWE verification
- nonce is not issued/consumed as a one-time mini-app nonce
- human verification is currently trusted from payload shape, not verified through World App proof verification
- duplicate `nullifier_hash` protection is missing
- auth profile does not store `nullifierHash`
- `env.worldApp.*` config is not wired into app config yet
- login and verify-human are currently merged, while the reference flow separates them

## Alignment Plan

### Alignment Phase A - Add World App Config

Tasks:

- Extend `src/config/index.ts` with `worldApp` config needed by:
  - `src/libs/worldapp/worldapp.ts`
- Add env parsing for:
  - `WORLD_APP_APP_IDS`
  - `WORLD_APP_DOMAINS`
  - `WORLD_APP_URIS`
  - `WORLD_APP_API_KEY`
- Normalize comma-separated values into arrays.

Exit criteria:

- `env.worldApp.appIds`
- `env.worldApp.domains`
- `env.worldApp.uris`
- `env.worldApp.apiKey`

are available to auth code.

### Alignment Phase B - Add Mini-App Nonce Flow

Tasks:

- Add a dedicated mini-app nonce endpoint, for example:
  - `GET /auth/miniapp/nonce`
- Reuse the reference pattern from `mini-app-user`:
  - nonce generated server-side
  - stored in Redis
  - consumed once
- Add a small `Nonce` persistence boundary if we want hard replay prevention across Redis restarts, matching the reference flow.

Decision:

- keep wallet challenge flow and mini-app nonce flow separate
- do not reuse `/auth/challenge` for mini-app SIWE login

Exit criteria:

- mini-app login has a server-issued nonce
- nonce replay is rejected

Implementation note:

- Added `GET /auth/miniapp/nonce`.
- Added `MiniAppNonceService` with:
  - `createNonce()`
  - `consumeNonce()`
- Nonces are:
  - generated server-side
  - stored in Redis with a `300s` TTL
  - persisted in Postgres on first successful consumption
  - rejected on replay
- Added `miniapp_nonces` entity and migration `1777200000000-MiniAppNoncesPhaseB`.
- `AuthService.loginMiniApp(...)` now requires successful one-time nonce consumption before issuing JWT/WSS credentials.

### Alignment Phase C - Replace Placeholder Login Verifier With World App SIWE Verification

Tasks:

- Replace the current `MiniAppAuthVerifier.verifyLogin()` logic with a wrapper around:
  - `WorldApp.verifyWorldAppPayload(...)`
- The new verifier must honor the behavior in `src/libs/worldapp/siwe.ts`, including:
  - nonce validation
  - SIWE parsing
  - expiration / not-before checks
  - request id validation when used
  - SIWE v1 Safe owner verification
  - SIWE v2 EIP-1271 verification
- Remove the current simplistic:
  - `message.includes(nonce)`
  - `ethers.verifyMessage(...)`
  flow

Exit criteria:

- mini-app login is verified by the same World App SIWE logic as the reference implementation

Implementation note:

- `MiniAppAuthVerifier.verifyLogin(...)` now uses the SIWE verifier from:
  - [siwe.ts](/Users/sniperman/code/tapfun-be/src/libs/worldapp/siwe.ts)
- This replaces the earlier placeholder logic based on:
  - `message.includes(nonce)`
  - `ethers.verifyMessage(...)`
- Current login verification now follows the World App SIWE path for:
  - nonce validation
  - SIWE message parsing
  - expiration / not-before checks
  - SIWE v1 Safe owner verification
  - SIWE v2 EIP-1271 verification
- `AuthService.loginMiniApp(...)` was updated to await the async verifier result.
- This phase only aligns the mini-app **login** verifier. `verify-human` is still not yet aligned to the separate World App proof flow from the reference implementation.

### Alignment Phase D - Separate Verify-Human Endpoint

Tasks:

- Split human verification out of login.
- Keep mini-app login responsible only for:
  - resolving canonical wallet address
  - issuing JWT/WSS
  - setting `lastAuthType = miniapp`
- Add a separate guarded endpoint:
  - `POST /auth/miniapp/verify-human`
- Use the reference flow from `mini-app-user/user.service.ts`:
  - `signal` must match JWT wallet address
  - verify proof via `WorldApp.verifyHuman(dto)`
  - require `verification_level = orb`

Exit criteria:

- login no longer sets `humanVerified` directly from client payload
- human verification is explicit and independently auditable

Implementation note:

- Added guarded endpoint:
  - `POST /auth/miniapp/verify-human`
- `POST /auth/miniapp/login` now only:
  - verifies SIWE login payload
  - consumes the one-time nonce
  - upserts `lastAuthType = miniapp` and `miniAppUserId`
  - issues JWT/WSS without trusting any human-proof payload from login
- Human verification now runs separately through `MiniAppAuthVerifier.verifyHuman(...)`, which:
  - requires `signal` to match the JWT wallet address
  - delegates proof validation to `WorldApp.verifyHuman(...)`
- Successful verify-human updates profile state and returns refreshed JWT/WSS credentials so the client gets `humanVerified = true` immediately.

### Alignment Phase E - Persist And Enforce Nullifier Hash Uniqueness

Tasks:

- Add `nullifierHash` to `user_auth_profiles` or a closely related auth metadata table.
- Add uniqueness constraint on `nullifierHash`.
- On verify-human:
  - reject if current address already has a nullifier hash
  - reject if another profile already owns the submitted nullifier hash
- Add Redis lock keyed by `nullifierHash` to prevent concurrent duplicate verification attempts, matching the reference pattern.

Exit criteria:

- duplicate human verification claims are blocked
- human verification state is backed by persisted proof identity, not just a boolean

Implementation note:

- Added nullable `nullifierHash` to `user_auth_profiles`.
- Added migration:
  - `1777300000000-UserAuthProfilesNullifierPhaseE`
- `AuthService.verifyMiniAppHuman(...)` now:
  - acquires a Redis lock keyed by `nullifier_hash`
  - rejects if the current address already has a `nullifierHash`
  - rejects if another profile already owns the submitted `nullifierHash`
  - persists `nullifierHash` together with the verified human state
- `UserAuthProfileService` now supports lookup by `nullifierHash`, and the auth-profile Redis cache now includes that field.

### Alignment Phase F - Update JWT/Profile Semantics

Tasks:

- Keep:
  - `sub = address`
  - `authType = miniapp`
- Update `humanVerified` in JWT only after successful verify-human flow.
- Keep `miniAppUserId` as metadata if still needed for client/product flows.
- Ensure wallet login does not erase an existing verified state.

Exit criteria:

- JWT claims are snapshots of verified backend state
- no trust is placed in unverified login payload for `humanVerified`

Implementation note:

- Auth responses from wallet login, mini-app login, and verify-human now all return the same snapshot fields:
  - `authType`
  - `humanVerified`
  - `miniAppUserId`
- JWT claims are issued from persisted `user_auth_profiles` state, not directly from client payloads.
- Wallet login continues to issue `authType = wallet` while preserving any previously verified `humanVerified` state on the profile.
- Mini-app login continues to issue `authType = miniapp` while preserving a previously verified `humanVerified` state after verify-human has already succeeded.
- `user_auth_profiles` also stores optional `miniAppUsername` as front-end supplied metadata from mini-app login.
- The server does not verify `miniAppUsername`; it only verifies the mini-app login payload and then persists the username if present.

### Alignment Phase G - Tests And Hardening

Tasks:

- Replace current mini-app auth tests that assume plain `ethers.verifyMessage(...)`.
- Add tests for:
  - successful mini-app SIWE login
  - invalid nonce
  - replayed nonce
  - expired SIWE message
  - invalid EIP-1271 / Safe validation
  - verify-human success
  - duplicate `nullifierHash`
  - verify-human with mismatched signal/address
- Add integration coverage for:
  - login first, verify-human later
  - JWT before verify-human has `humanVerified = false`
  - JWT after verify-human has `humanVerified = true`

Exit criteria:

- mini-app auth behavior is defensible against replay and fake human-proof payloads

Implementation note:

- Added verifier unit coverage in:
  - `src/modules/auth/miniapp-auth.verifier.spec.ts`
- Covered hardening branches for:
  - invalid mini-app status
  - failed SIWE verification
  - successful SIWE address normalization
  - verify-human signal mismatch
  - failed World App human proof verification
- Added auth integration flow coverage in:
  - `src/modules/auth/auth.e2e-spec.ts`
- The integration suite covers:
  - `nonce -> miniapp login -> verify-human`
  - JWT before verify-human has `humanVerified = false`
  - JWT after verify-human has `humanVerified = true`
  - replayed nonce rejection
- The auth integration suite is opt-in and only runs when:
  - `RUN_AUTH_E2E=true`
  - `POSTGRES_TEST_URL` is set
  - `REDIS_TEST_URL` is set

## Key Risks

- The mini-app flow must always resolve to a canonical address. If it can produce multiple addresses for the same person, the backend will still treat them as different users.
- Human verification should be treated as profile state, not just a transient login flag.
- JWT carries a snapshot; high-value policy checks may still need DB/profile re-check rather than trusting only claims.

## Recommended First Implementation Scope

If you want the minimum-risk path:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4

That is enough to support:

- wallet login
- mini-app login
- `authType = wallet`
- `authType = miniapp, humanVerified = false`
- `authType = miniapp, humanVerified = true`

without touching the business identity model.

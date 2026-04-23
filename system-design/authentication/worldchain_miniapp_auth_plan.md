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

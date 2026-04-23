# Order Follow Subscription Migration Plan

## Goal

Allow user A to subscribe to order updates from user B.

Initial rollout is free registration. The design must keep an explicit eligibility boundary so later we can require payment, staking, whitelist, creator approval, or another entitlement before A can follow B.

Current behavior:

- WebSocket `subscribe_user` joins only `user:<userId>` after validating a signature from that same user.
- `SocketService.emitOrderUpdate()` emits only to `user:<orderOwnerUserId>`.
- Order update payload includes user id, amount, cell, and settlement result.

Target behavior:

- User A keeps receiving their own private order updates.
- User A may register a follow relationship for user B.
- When B has an order update, both B and eligible followers of B receive a follower-safe order event.
- The registration and eligibility logic is server-side, not only socket-room based.

## Proposed Model

Use a separate subscription domain instead of overloading direct user rooms.

### Entities

`order_follow_subscriptions`

- `id uuid`
- `subscriberUserId text`
- `targetUserId text`
- `status enum`
  - `ACTIVE`
  - `PAUSED`
  - `REVOKED`
  - `EXPIRED`
- `eligibilityStatus enum`
  - `FREE`
  - `ELIGIBLE`
  - `INELIGIBLE`
- `eligibilityReason text nullable`
- `source enum`
  - `FREE_REGISTRATION`
  - `PAID_ACCESS`
  - `ADMIN_GRANT`
- `expiresAt timestamp nullable`
- `createdAt timestamp`
- `updatedAt timestamp`

Constraints:

- Unique `(subscriberUserId, targetUserId)`.
- Reject `subscriberUserId == targetUserId`; self updates already use the private user room.
- Index `(targetUserId, status, eligibilityStatus)` for fanout.
- Index `(subscriberUserId, status)`.

## Server Boundaries

Add `OrderFollowModule`.

Main services:

- `OrderFollowService`
  - `register(subscriberUserId, targetUserId)`
  - `unsubscribe(subscriberUserId, targetUserId)`
  - `listFollowing(subscriberUserId)`
  - `listFollowers(targetUserId)` for admin/internal usage
  - `getActiveSubscriberIds(targetUserId)`
- `OrderFollowEligibilityService`
  - `assertCanSubscribe(subscriberUserId, targetUserId)`
  - `refreshEligibility(subscription)`

For Phase 1, eligibility always returns allowed:

```ts
{
  eligible: true,
  status: 'FREE',
  reason: 'free_registration'
}
```

Later, only `OrderFollowEligibilityService` changes to support payment/entitlement checks.

## API Design

REST endpoints with JWT auth:

- `POST /order-follows`
  - body: `{ "targetUserId": "0x..." }`
  - creates or reactivates subscription for current user
- `DELETE /order-follows/:targetUserId`
  - revokes current user's subscription
- `GET /order-follows/following`
  - returns current user's active targets
- `GET /order-follows/followers`
  - optional, returns followers of current user if product wants creator visibility

WebSocket messages:

- Keep existing `subscribe_user` unchanged for private self room.
- Add `subscribe_order_follows`.
  - Authenticates current socket as user A.
  - Receives one `targetUserId`.
  - Checks that A has an active eligible subscription to that target.
  - Joins `order_follow_target:<targetUserId>`.
- Add `unsubscribe_order_follows`.
  - Receives one `targetUserId`.
  - Checks that A has an active eligible subscription to that target.
  - Leaves `order_follow_target:<targetUserId>`.

Do not let the client join `user:<targetUserId>` for a followed user. That room remains private and owner-only.

## Fanout Design

Add follower-safe event shape:

```ts
interface FollowedOrderUpdateMessage {
  targetUserId: string;
  orderId: string;
  marketId: string;
  amount: string;
  cell: Cell;
  status: OrderStatus;
  settledTimestamp?: number;
  settledWin?: boolean;
}
```

Initial implementation can reuse the current order payload fields, but it should be emitted under a different event:

- Private owner event: `order_update`
- Follower event: `followed_order_update`

This keeps room semantics clean and gives us a place to redact fields later if needed.

Update `EventPublisher`:

- Keep `emitOrderUpdate(msg)` for owner.
- Add `emitFollowedOrderUpdate(msg)` or make `SocketService.emitOrderUpdate()` internally fan out to both:
  - `user:<ownerUserId>` for private owner update.
  - `order_follow_target:<ownerUserId>` for all sockets currently following the owner.

Preferred first implementation:

- Let `OrderService` call only one publisher method.
- Move follower fanout into `SocketService` or a small `OrderFollowFanoutService`.
- `SocketService` emits `followed_order_update` once to `order_follow_target:<ownerUserId>`.

This avoids touching order settlement semantics.

## Phases

### Phase 1 - Schema And Free Registration

Tasks:

- Add `OrderFollowSubscription` entity.
- Add migration for `order_follow_subscriptions`.
- Add `OrderFollowModule`, `OrderFollowService`, and free `OrderFollowEligibilityService`.
- Add JWT REST endpoints for register/unsubscribe/list.
- Add unit tests:
  - create subscription
  - duplicate registration is idempotent
  - unsubscribe marks `REVOKED`
  - self-follow is rejected

Exit criteria:

- User A can register to follow user B.
- No socket fanout changes yet.

Implementation note:

- Added `OrderFollowModule`.
- Added `OrderFollowSubscription` entity and migration `1776900000000-OrderFollowSubscriptionsPhase1`.
- Added free `OrderFollowEligibilityService` boundary; it currently returns `FREE/free_registration`.
- Added JWT REST endpoints:
  - `POST /order-follows`
  - `DELETE /order-follows/:targetUserId`
  - `GET /order-follows/following`
  - `GET /order-follows/followers`
- Added service tests for create, idempotent reactivation, unsubscribe, self-follow rejection, and active subscriber lookup.

### Phase 2 - WebSocket Subscription Room

Tasks:

- Add socket room helper:
  - `getOrderFollowTargetRoom(targetUserId) => order_follow_target:<targetUserId>`
- Add events:
  - `subscribe_order_follows`
  - `unsubscribe_order_follows`
  - `followed_order_update`
- Authenticate socket as subscriber user A.
- On subscribe:
  - Validate the requested `targetUserId`.
  - Join that target broadcast room only if the subscription is active and eligible.
- On unsubscribe:
  - Validate the requested `targetUserId`.
  - Leave that target broadcast room only if the subscription is active and eligible.

Exit criteria:

- A connected user can opt in to receiving followed order updates without gaining access to `user:<targetUserId>`.

Implementation note:

- Added socket room helper `getOrderFollowTargetRoom(targetUserId) => order_follow_target:<targetUserId>`.
- Added socket events:
  - `subscribe_order_follows`
  - `unsubscribe_order_follows`
  - reserved `followed_order_update`
- `SocketGateway` authenticates the subscriber with the same WSS signature flow used by private user subscriptions.
- The gateway asks `OrderFollowService.canListenToTarget(subscriberUserId, targetUserId)` and only joins/leaves the requested target room if the subscription is active and eligible.
- The gateway never joins `user:<targetUserId>`.
- Fixed existing gateway auth calls to `await validateWssSignature(...)`; the method is async.
- Added socket unit tests for room naming, successful subscribe, rejected subscribe, and unsubscribe.

### Phase 3 - Fanout Order Updates

Tasks:

- Add follower fanout path on order updates.
- For every order update owned by B:
  - emit private `order_update` to `user:<B>`
  - emit one `followed_order_update` to `order_follow_target:<B>`
- Keep fanout best-effort:
  - order placement/settlement must not fail because follower fanout fails
  - log errors and continue

Exit criteria:

- User A receives B's placed/settled order events after subscribing.
- User B's private updates still work unchanged.

Implementation note:

- `SocketService.emitOrderUpdate()` now emits private owner `order_update` to `user:<ownerUserId>` and follower-safe `followed_order_update` once to `order_follow_target:<ownerUserId>`.
- Added `FollowedOrderUpdateMessage` with `targetUserId` instead of reusing the private `userId` field.
- `OrderService` call sites are unchanged; fanout remains inside the socket publisher boundary.
- Added socket service tests for private + followed fanout and payload mapping.

### Phase 4 - Eligibility Gate

Tasks:

- Replace free eligibility implementation with policy-based checks.
- Add an interface:

```ts
interface OrderFollowEligibilityProvider {
  check(input: {
    subscriberUserId: string;
    targetUserId: string;
  }): Promise<OrderFollowEligibilityDecision>;
}
```

- Initial providers:
  - `FreeOrderFollowEligibilityProvider`
  - future `PaidOrderFollowEligibilityProvider`
- Add periodic or request-time refresh for expired/ineligible subscriptions.

Potential paid access models:

- Fixed subscription fee paid into Account ledger.
- Target-specific creator pass.
- NFT/token ownership check.
- Admin allowlist.

Exit criteria:

- Registration code does not need to change when eligibility moves from free to paid.

### Phase 5 - Scale And Privacy Hardening

Tasks:

- Add Redis cache for `targetUserId -> subscriberUserIds`.
- Invalidate cache on register/unsubscribe/eligibility refresh.
- Add fanout metrics:
  - active subscriptions
  - subscribers per target
  - fanout emit latency
  - failed fanout count
- Add payload redaction if needed:
  - hide exact amount
  - hide user address aliases
  - delay settlement updates
- Add rate limits:
  - max follow registrations per user
  - max followers per target for free tier

Exit criteria:

- Fanout path remains bounded under high follower counts.
- Privacy decisions are explicit in `followed_order_update`, not coupled to private `order_update`.

## Important Design Notes

- Do not use `subscribe_user` for following. It currently means "subscribe to my own private user room".
- Do not let a follower join the target user's private room.
- Store subscriptions in Postgres as source of truth; Redis cache is optional acceleration.
- Keep eligibility a service boundary from day one, even while it always returns free/allowed.
- Use a separate follower event name so private payload changes do not automatically leak to followers.

## Open Questions

- Should target user B be able to block followers?
- Should follower updates include exact amount, or only cell/market/status?
- Should subscriptions be global, market-specific, or strategy-specific?
- Should paid eligibility charge once, periodically, or per copied/listened order?

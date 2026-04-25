# Auth And Funding

## Wallet Login

1. `GET /api/auth/challenge?address=<wallet>`
2. Sign the returned challenge with the wallet.
3. `POST /api/auth/login`

Request body:

```json
{
  "address": "0x...",
  "signature": "0x..."
}
```

Response includes:
- `accessToken`
- `wssKey`
- `wssKeyExpiresAt`
- auth metadata

Use `accessToken` for REST calls.

## Hackathon Funding

Top up demo balance:

```http
POST /api/payment/debug/deposit
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "amount": "100"
}
```

This is the preferred funding path when payment workers are disabled.

## User Socket Subscription

To receive private user events, connect websocket and emit:

Event: `subscribe_user`

```json
{
  "userId": "0x...",
  "signature": "<hmac signature using wssKey>"
}
```

Private room events:
- `balance_update`
- `order_update`
- payment events

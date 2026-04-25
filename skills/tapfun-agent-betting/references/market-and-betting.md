# Market And Betting

## Market Streams

Public websocket events:
- `price_now`
- `grid_update`
- `suggested_strategy_update`

Suggested strategy is heuristic only. It does not guarantee profitable bets.

## Place Order Over REST

```http
POST /api/orders
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "marketId": "BTCUSDT",
  "amount": "10",
  "cell": {
    "gridTs": 1770000000000,
    "startTs": 1770000005000,
    "endTs": 1770000010000,
    "lowerPrice": "70000",
    "upperPrice": "70005",
    "rewardRate": "2.5",
    "gridSignature": "..."
  }
}
```

Rules:
- use a fresh cell from `grid_update`
- keep `gridSignature` unchanged
- place before cell deadline

## Order Updates

When an order settles, payload may include:
- `settledWin`
- `settledTimestamp`
- `settledPayout`
- `settledBasePayout`
- `settledBonusPayout`

`settledBonusPayout` is non-zero only when a human-verified win bonus applied.

## Follow Trade

If account B follows account A:
1. B registers follow via `POST /api/order-follows`
2. B subscribes socket event `subscribe_order_follows`
3. B receives `followed_order_update` for A

---
name: tapfun-agent-betting
description: "Use the TapFun backend like a human trader. Covers wallet login, hackathon faucet deposit, reading grid and suggested strategy streams, placing orders, tracking balance/order updates, and using the MCP endpoint. Trigger when an agent needs to interact with the TapFun app itself rather than inspect source code."
---

# TapFun Agent Betting

Use this skill when you need to operate the TapFun app as a user:
- authenticate with a wallet
- fund a demo balance
- read market data and suggested strategy
- place bets
- track order and balance updates
- use the MCP service exposed by the backend

## Entry Points

- App skill document: `/skill.md`
- Auth and funding: `/skills/references/auth-and-funding.md`
- Market data and betting: `/skills/references/market-and-betting.md`
- MCP usage: `/skills/references/mcp.md`

## Default Flow

1. Login with wallet via `/api/auth/challenge` then `/api/auth/login`.
2. For hackathon/demo mode, top up with `/api/payment/debug/deposit`.
3. Read `grid_update` and `suggested_strategy_update` over websocket.
4. Place orders through `/api/orders` or the MCP tools.
5. Listen for `order_update` and `balance_update`.

## Important Constraints

- `cell.gridSignature` must be the exact value emitted by backend grid streams.
- Do not place a bet on a cell whose `startTs` is too close; backend rejects expired cells.
- In current hackathon mode, payment workers may be disabled. Prefer debug deposit/withdraw flows if documented by the environment.
- MCP service is hosted on a separate host from the main app API. Use the MCP host's `/mcp` endpoint for agent tools, not the main app host's `/api/...` routes.

## When To Read References

- Read `auth-and-funding.md` before implementing login, JWT, or faucet flows.
- Read `market-and-betting.md` before consuming websocket streams or placing bets.
- Read `mcp.md` before driving the app through MCP instead of raw HTTP/websocket calls.

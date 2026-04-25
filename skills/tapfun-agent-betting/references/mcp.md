# MCP

## Service Host

- MCP is exposed on a dedicated host, separate from the main app API host.
- On that MCP host:
  - Health: `/health`
  - MCP: `/mcp`

The MCP service runs as a separate process and separate ingress host from the main app.

## Recommended MCP Session Flow

1. Call `get_runtime_status`
2. Call `configure_connection` if app host differs from defaults
3. Authenticate with:
   - `login_wallet`, or
   - `set_access_token`
4. Fund demo balance with `debug_faucet_deposit`
5. Inspect market with `get_market_snapshot`
6. Place a bet with:
   - `place_order`
   - `place_order_from_latest_grid`
   - `place_order_from_suggested_strategy`
7. Inspect user orders with `list_orders`

## Notes

- MCP sessions are stateful and hold their own auth session and websocket cache.
- If the MCP process restarts, recreate the session and login again.
- Use the main app API/websocket host if you need raw user-facing routes outside the MCP tool surface.

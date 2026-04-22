# System Stack Technology

## 1. Storage Choices

### 1.1 Price History

* **Technology**: ClickHouse
* **Reasoning**:

  * High write throughput for tick-level price (ms-level)
  * Append-only, compression efficient
  * Fast time-series queries for analytics / replay
* **Alternative Considered**: TimescaleDB (less optimal for high-frequency tick writes)

### 1.2 WAL

* **Technology**: Local disk file per shard
* **Reasoning**:

  * Append-only, fsync per action
  * Fastest durability for hot-path balance updates
  * Allows replay after crash
* **Alternative Considered**: DB WAL (too slow for per-action fsync)

### 1.3 Ledger (Source of Truth for balances)

* **Technology**: PostgreSQL
* **Reasoning**:

  * ACID guarantees
  * Unique constraints enforce idempotency
  * Easy audit & reconciliation
* **Alternative Considered**: TimescaleDB (OK but not required), ClickHouse (no ACID)

### 1.4 In-Memory Account Balance

* **Technology**: Language-native structures (e.g., HashMap/ConcurrentMap)
* **Reasoning**:

  * <1–2ms update per user
  * Full control over single-writer per user
  * No network hop, minimal latency
* **Alternative Considered**: Redis (network hop too costly, atomicity complex)

### 1.5 Active Orders (≤100k orders in memory)

* **Technology**: Language-native structures, partitioned by cell_x buckets
* **Reasoning**:

  * Extremely low latency reads/writes
  * Controlled eviction when cell closes
  * Easy integration with per-user single-writer balance logic
* **Alternative Considered**: Redis (only if multi-node state needed, otherwise unnecessary)

---

## 2. Backend Language

| Module                                                                              | Recommended Language | Reasoning                                                                                   |
| ----------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| Core Hot Path (Account Balance, Active Orders, Settlement, Grid, Price Tick Fanout) | Rust                 | Low-latency, deterministic, safe concurrency, strong memory safety, multi-threading support |
| Peripheral Services (Payment, API Gateway)                                          | Go                   | Good for IO-bound tasks, async streaming, easy dev productivity                             |

---

## 3. Messaging & Async Queue

* **Event queue**: in-process (language-native channels or async queue)
* **Reasoning**:

  * Hot path (orders, price tick) does not require external message broker
  * Avoid network latency and additional complexity

---

## 4. Summary

* **Price history** → ClickHouse
* **WAL** → Local disk per shard
* **Ledger** → PostgreSQL
* **In-memory balance & active orders** → Language-native structures
* **Core backend modules** → Rust
* **Peripheral services** → Go
* **Async queues** → in-process channels

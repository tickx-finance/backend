# Account Balance Module – WAL + Ledger Model

## Primary Goal

This document introduces a **WAL + Ledger based accounting model** for the **Account Balance Module**.

The core objective is to build a balance system that is:

* **Correct by construction** for money movements
* **Crash-safe and replay-safe**
* **Auditable and extensible**

> **Idempotency is a requirement of the model, not the main goal.**
> It naturally emerges from how Ledger uniqueness is designed.

---

## 1. Problem Space

The Account Balance Module must safely handle all balance-changing operations such as:

* Deposits and withdrawals
* Bet settlement (win / lose)
* Refunds, corrections, and future economic actions

Key challenges:

* Crashes during balance updates
* Retries, replays, and duplicated events
* Concurrent actions affecting the same account
* Long-term auditability and reconciliation

---

## 2. Core Design Principles

1. **Money movements are events, not state mutations**
2. **Every economic event is recorded exactly once in the Ledger**
3. **Balance state is a derived, cached view**
4. **WAL guarantees intent durability, Ledger guarantees correctness**

---

## 3. WAL + Ledger Responsibilities

### 3.1 WAL (Write-Ahead Log / Intent Journal)

Purpose:

* Persist the *intent* to apply a balance change
* Guarantee recovery after crashes
* Allow safe retries and reprocessing

Characteristics:

* Append-only
* May contain duplicates
* No economic uniqueness enforcement

```ts
struct WALRecord {
  wal_id: UUID
  user_id: string

  intent_type: EconomicEventType
  economic_key: EconomicKey

  deltas: BalanceDelta
  status: PREPARED | COMMITTED | ABORTED

  created_at: Timestamp
}
```

---

### 3.2 Ledger (Economic Source of Truth)

Purpose:

* Record **economic facts** (money actually moved)
* Enforce correctness and idempotency
* Provide a complete audit trail

Characteristics:

* Append-only
* Strong uniqueness guarantees
* Single source of truth for balances

```ts
struct LedgerEntry {
  ledger_seq: u64
  user_id: string

  event_type: EconomicEventType
  economic_key: EconomicKey

  deltas: BalanceDelta

  created_at: Timestamp
}
```

Hard guarantee:

```
UNIQUE (user_id, economic_key)
```

---

## 4. Economic Events

### 4.1 Economic Event Type

```ts
enum EconomicEventType {
  FAUCET_FREE_TAP,
  DEPOSIT,
  WITHDRAW,
  BET_WIN,
  BET_LOSE,
  REFUND,
  CORRECTION,
}
```

---

### 4.2 Economic Key

The **Economic Key** uniquely identifies an immutable money flow in the domain.

```ts
struct EconomicKey {
  type: EconomicEventType
  ref: string // deterministic, domain-derived
}
```

Examples:

* Deposit: `chain_id + tx_hash + log_index`
* Withdraw: `chain_id + tx_hash`
* Bet settlement: `market_id + cell_id + user_id`

---

## 5. Balance State Model

* `BalanceState` is an **in-memory or cached projection**
* It is derived from Ledger entries
* Can always be rebuilt by replaying the Ledger

```
BalanceState(user) = Σ LedgerEntry.deltas
```

---

## 6. Balance Update Flow

1. Receive economic event (possibly duplicated or replayed)
2. Append WAL record with status `PREPARED`
3. Insert LedgerEntry

   * Duplicate `(user_id, economic_key)` → no-op
4. Update cached / in-memory BalanceState
5. Mark WAL record as `COMMITTED`

---

## 7. Idempotency

Idempotency naturally follows from the model:

| Layer  | Role                        |
| ------ | --------------------------- |
| API    | Deduplicate requests        |
| Domain | Enforce business rules      |
| Ledger | Enforce economic uniqueness |

> The Ledger is the **only component** that prevents double credit / debit.

---

## 8. Failure & Recovery Guarantees

* Crash before Ledger insert → WAL allows retry
* Crash after Ledger insert → uniqueness prevents double-apply
* Cached balance lost → rebuild from Ledger

---

## 9. Design Guarantees

* No double credit or debit
* Strong crash recovery semantics
* Clear and auditable balance history
* New economic actions can be added without redesigning the system

---

## 10. Key Takeaways

> **Ledger records economic facts.**
> **WAL records intent.**
> **Balance is a derived view, not the source of truth.**

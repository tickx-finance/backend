import { BigNumber } from "bignumber.js";

export enum EconomicEventType {
    FAUCET_FREE_TAP = 'FAUCET_FREE_TAP',
    DEPOSIT = 'DEPOSIT',
    WITHDRAW_REQUESTED = 'WITHDRAW_REQUESTED',
    WITHDRAW_CANCELLED = 'WITHDRAW_CANCELLED',
    WITHDRAW_SUCCEEDED = 'WITHDRAW_SUCCEEDED',
    BET_PLACE = 'BET_PLACE',
    BET_SETTLE = 'BET_SETTLE',
    REFUND = 'REFUND',
    CORRECTION = 'CORRECTION',
}

export interface EconomicKey {
    type: EconomicEventType;
    ref: string;
}

export interface BalanceDelta {
    free: string;     // Decimal represented as string
    freeTap: string;  // Decimal represented as string
    locked: string;   // Decimal represented as string
}

export function validateBalanceDelta(delta: BalanceDelta): boolean {
    // check is not NaN
    if (isNaN(Number(delta.free)) || isNaN(Number(delta.freeTap)) || isNaN(Number(delta.locked))) {
        return false;
    }
    return true;
}

export interface BalanceSnapshot {
    free: string;
    freeTap: string;
    locked: string;
}

export function snapshotApplyDelta(snapshot: BalanceSnapshot, delta: BalanceDelta): BalanceSnapshot {
    return {
        free: new BigNumber(snapshot.free).plus(delta.free).toString(),
        freeTap: new BigNumber(snapshot.freeTap).plus(delta.freeTap).toString(),
        locked: new BigNumber(snapshot.locked).plus(delta.locked).toString(),
    };
}

export enum WalStatus {
    PREPARED = 'PREPARED',
    COMMITTED = 'COMMITTED',
    ABORTED = 'ABORTED',
}

export interface WalRecord {
    walId: string;
    userId: string;
    entry: {
        eventType: EconomicEventType;
        economicKey: string;
        deltas: BalanceDelta;
    };
    status: WalStatus;
    createdAt: number;
}

export interface BalanceState {
    userId: string;
    free: string;
    freeTap: string;
    locked: string;
    lastLedgerSeq: string; // Last ledger sequence processed
}


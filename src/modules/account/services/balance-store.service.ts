import { Injectable } from '@nestjs/common';
import BigNumber from 'bignumber.js';
import { BalanceState, BalanceDelta, BalanceSnapshot } from '../types';

@Injectable()
export class BalanceStoreService {
    // Map<UserId, BalanceState>
    private readonly balances = new Map<string, BalanceState>();

    initUser(userId: string) {
        if (!this.balances.has(userId)) {
            this.balances.set(userId, {
                userId,
                free: '0',
                freeTap: '0',
                locked: '0',
                lastLedgerSeq: 0,
            });
        }
    }

    get(userId: string): BalanceState | undefined {
        const balance = this.balances.get(userId);
        if (!balance) {
            return undefined;
        }
        return { ...balance }; // Return copy
    }

    /**
     * Directly set balance (e.g. after loading from snapshot/ledger)
     */
    set(userId: string, state: BalanceState) {
        this.balances.set(userId, state);
    }

    /**
     * Apply delta to balance.
     * NOTE: Validation (sufficiency check) should be done BEFORE this by the caller.
     * A ledger entry must be inserted before applying delta. and that ledger entry id will be used as lastLedgerSeq.
     * This method trusts the delta is valid to apply.
     */
    applyDelta(userId: string, lastLedgerSeq: number, delta: BalanceDelta) {
        this.initUser(userId);
        const balance = this.balances.get(userId)!;

        balance.free = new BigNumber(balance.free).plus(delta.free).toString();
        balance.freeTap = new BigNumber(balance.freeTap).plus(delta.freeTap).toString();
        balance.locked = new BigNumber(balance.locked).plus(delta.locked).toString();
        balance.lastLedgerSeq = lastLedgerSeq;
    }

    getSnapshot(userId: string): BalanceSnapshot {
        const balance = this.get(userId);
        return {
            free: balance.free,
            freeTap: balance.freeTap,
            locked: balance.locked,
        };
    }
}

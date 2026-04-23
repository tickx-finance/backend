import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import BigNumber from 'bignumber.js';

import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';
import { RedisBalanceStoreService } from './services/redis-balance-store.service';
import { LedgerService } from './services/ledger.service';
import { BalanceDelta, BalanceState, EconomicEventType, validateBalanceDelta } from './types';

export interface SettleBetOptions {
    effectiveRewardRate?: string;
}

@Injectable()
export class AccountService {
    private readonly logger = new Logger(AccountService.name);

    constructor(
        private readonly ledger: LedgerService,
        private readonly balanceStore: RedisBalanceStoreService,
        @Inject(EVENT_PUBLISHER)
        private readonly accountEventPublisher: EventPublisher,
    ) { }

    async getBalance(userId: string): Promise<BalanceState> {
        return await this.ensureBalanceLoaded(userId);
    }

    /**
     * Redis is the hot-path balance state. Postgres ledger/snapshots remain the
     * recovery source when Redis has no account state.
     */
    private async ensureBalanceLoaded(userId: string): Promise<BalanceState> {
        let balance = await this.balanceStore.get(userId);
        if (!balance) {
            const ledgerSnapshot = await this.ledger.buildNextSnapshot(userId);
            balance = {
                userId,
                ...ledgerSnapshot.balanceAfter,
                lastLedgerSeq: ledgerSnapshot.ledgerSeq,
            };
            await this.balanceStore.set(userId, balance);
        }
        return balance;
    }

    async deposit(userId: string, amount: string, txHash: string, logIndex: number) {
        await this.ensureBalanceLoaded(userId);

        const delta: BalanceDelta = {
            free: amount,
            freeTap: '0',
            locked: '0',
        };
        const ref = `${txHash}:${logIndex}`;
        return await this.processEvent(userId, EconomicEventType.DEPOSIT, ref, delta);
    }

    async withdrawSucceeded(userId: string, amount: string, txHash: string, logIndex: number) {
        const balance = await this.ensureBalanceLoaded(userId);

        if (new BigNumber(balance.locked).lt(amount)) {
            throw new BadRequestException('Insufficient locked balance');
        }

        const delta: BalanceDelta = {
            free: '0',
            freeTap: '0',
            locked: new BigNumber(amount).negated().toString(),
        };
        const ref = `${txHash}:${logIndex}`;
        return await this.processEvent(userId, EconomicEventType.WITHDRAW_SUCCEEDED, ref, delta);
    }

    async withdrawRequested(userId: string, amount: string, sessionId: string) {
        const balance = await this.ensureBalanceLoaded(userId);

        if (new BigNumber(balance.free).lt(amount)) {
            throw new BadRequestException('Insufficient free balance');
        }

        const delta: BalanceDelta = {
            free: new BigNumber(amount).negated().toString(),
            freeTap: '0',
            locked: amount,
        };
        return await this.processEvent(userId, EconomicEventType.WITHDRAW_REQUESTED, sessionId, delta);
    }

    async withdrawCancelled(userId: string, amount: string, sessionId: string) {
        const balance = await this.ensureBalanceLoaded(userId);

        if (new BigNumber(balance.locked).lt(amount)) {
            throw new BadRequestException('Insufficient locked balance');
        }

        const delta: BalanceDelta = {
            free: amount,
            freeTap: '0',
            locked: new BigNumber(amount).negated().toString(),
        };
        return await this.processEvent(userId, EconomicEventType.WITHDRAW_CANCELLED, sessionId, delta);
    }

    async placeBet(userId: string, amount: string, marketId: string, cellId: string) {
        const ref = `${marketId}:${cellId}`;
        const balance = await this.ensureBalanceLoaded(userId);
        const betAmount = new BigNumber(amount);
        const freeTap = new BigNumber(balance.freeTap);
        const free = new BigNumber(balance.free);

        const useTap = BigNumber.minimum(betAmount, freeTap);
        const useFree = betAmount.minus(useTap);

        if (free.lt(useFree)) {
            throw new BadRequestException('Insufficient balance');
        }

        const delta: BalanceDelta = {
            freeTap: useTap.negated().toString(),
            free: useFree.negated().toString(),
            locked: betAmount.toString(),
        };

        return await this.processEvent(userId, EconomicEventType.BET_PLACE, ref, delta);
    }

    async settleBet(
        userId: string,
        amount: string,
        win: boolean,
        rewardRate: string = '0',
        marketId: string,
        cellId: string,
        options?: SettleBetOptions,
    ) {
        const ref = `${marketId}:${cellId}`;
        const balance = await this.ensureBalanceLoaded(userId);
        const betAmount = new BigNumber(amount);

        if (betAmount.gt(balance.locked)) {
            throw new BadRequestException('Insufficient locked balance');
        }

        let delta: BalanceDelta;
        if (win) {
            const payoutRewardRate = options?.effectiveRewardRate ?? rewardRate;
            const payout = betAmount.times(payoutRewardRate).decimalPlaces(9, BigNumber.ROUND_DOWN);
            delta = {
                locked: betAmount.negated().toString(),
                free: payout.toFixed(),
                freeTap: '0',
            };
        } else {
            delta = {
                locked: betAmount.negated().toString(),
                free: '0',
                freeTap: '0',
            };
        }

        return await this.processEvent(userId, EconomicEventType.BET_SETTLE, ref, delta);
    }

    private async processEvent(
        userId: string,
        type: EconomicEventType,
        ref: string,
        delta: BalanceDelta,
    ) {
        if (!validateBalanceDelta(delta)) {
            throw new BadRequestException('Invalid balance delta');
        }

        const economicKey = `${userId}:${type.valueOf()}:${ref}`;
        const initialBalance = await this.ensureBalanceLoaded(userId);
        const mutation = await this.balanceStore.applyDelta(userId, economicKey, delta, initialBalance);

        if (mutation.status === 'DUPLICATE') {
            this.logger.warn(`Duplicate account event for user ${userId}, key ${economicKey}`);
            return await this.ledger.getEntry(userId, economicKey);
        }

        try {
            const entry = await this.ledger.append(
                userId,
                type,
                economicKey,
                delta,
                mutation.balance.lastLedgerSeq,
            );

            this.accountEventPublisher.emitBalanceUpdate({
                userId,
                free: mutation.balance.free,
                locked: mutation.balance.locked,
                freeTap: mutation.balance.freeTap,
                timestamp: Date.now(),
            });

            return entry;
        } catch (err) {
            if (err.code === '23505') {
                this.logger.warn(`Duplicate ledger entry for user ${userId}, key ${economicKey}`);
                return await this.ledger.getEntry(userId, economicKey);
            }

            throw err;
        }
    }
}

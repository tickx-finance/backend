import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import BigNumber from 'bignumber.js';

import { ShardQueueService } from './services/shard-queue.service';
import { WalService } from './services/wal.service';
import { LedgerService } from './services/ledger.service';
import { BalanceStoreService } from './services/balance-store.service';
import { EconomicEventType, BalanceDelta, BalanceState, validateBalanceDelta } from './types';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';

@Injectable()
export class AccountService {
    private readonly logger = new Logger(AccountService.name);

    constructor(
        private readonly shardQueue: ShardQueueService,
        private readonly wal: WalService,
        private readonly ledger: LedgerService,
        private readonly balanceStore: BalanceStoreService,
        @Inject(EVENT_PUBLISHER)
        private readonly accountEventPublisher: EventPublisher,
    ) { }

    async getBalance(userId: string): Promise<BalanceState> {
        return this.ensureBalanceLoaded(userId)
    }
    /**
     * Ensures balance is loaded into memory for the user.
     * MUST be called inside the shard queue to ensure no race condition on loading.
     */
    private async ensureBalanceLoaded(userId: string): Promise<BalanceState> {
        let balance = this.balanceStore.get(userId);
        if (!balance) {
            // Rebuild balance from Ledger
            const ledgerSnapshot = await this.ledger.buildNextSnapshot(userId);
            balance = {
                userId,
                ...ledgerSnapshot.balanceAfter,
                lastLedgerSeq: ledgerSnapshot.ledgerSeq,
            } as BalanceState;
            this.balanceStore.set(userId, balance);
        }
        return balance;
    }

    async deposit(userId: string, amount: string, txHash: string, logIndex: number) {
        return this.shardQueue.enqueue(userId, async () => {
            await this.ensureBalanceLoaded(userId);

            const delta: BalanceDelta = {
                free: amount,
                freeTap: '0',
                locked: '0',
            };
            const ref = `${txHash}:${logIndex}`;
            await this.processEvent(userId, EconomicEventType.DEPOSIT, ref, delta);
        });
    }

    async withdrawSucceeded(userId: string, amount: string, txHash: string, logIndex: number) {
        return this.shardQueue.enqueue(userId, async () => {
            const balance = await this.ensureBalanceLoaded(userId);

            if (new BigNumber(balance.locked).lt(amount)) {
                throw new BadRequestException('Insufficient locked balance');
            }

            // Withdraw succeeded: locked -= amount
            const delta: BalanceDelta = {
                free: '0',
                freeTap: '0',
                locked: new BigNumber(amount).negated().toString(),
            };
            const ref = `${txHash}:${logIndex}`;
            await this.processEvent(userId, EconomicEventType.WITHDRAW_SUCCEEDED, ref, delta);
        });
    }

    async withdrawRequested(userId: string, amount: string, sessionId: string) {
        return this.shardQueue.enqueue(userId, async () => {
            const balance = await this.ensureBalanceLoaded(userId);

            if (new BigNumber(balance.free).lt(amount)) {
                throw new BadRequestException('Insufficient free balance');
            }

            // Withdraw requested: free -= amount, locked += amount
            const delta: BalanceDelta = {
                free: new BigNumber(amount).negated().toString(),
                freeTap: '0',
                locked: amount,
            };
            const ref = sessionId;
            await this.processEvent(userId, EconomicEventType.WITHDRAW_REQUESTED, ref, delta);
        });
    }

    async withdrawCancelled(userId: string, amount: string, sessionId: string) {
        return this.shardQueue.enqueue(userId, async () => {
            const balance = await this.ensureBalanceLoaded(userId);

            if (new BigNumber(balance.locked).lt(amount)) {
                throw new BadRequestException('Insufficient locked balance');
            }

            // Withdraw requested: free += amount, locked -= amount
            const delta: BalanceDelta = {
                free: amount,
                freeTap: '0',
                locked: new BigNumber(amount).negated().toString(),
            };
            const ref = sessionId;
            await this.processEvent(userId, EconomicEventType.WITHDRAW_CANCELLED, ref, delta);
        });
    }

    async placeBet(userId: string, amount: string, marketId: string, cellId: string) {
        const ref = `${marketId}:${cellId}`;
        return this.shardQueue.enqueue(userId, async () => {
            const balance = await this.ensureBalanceLoaded(userId);
            const betAmount = new BigNumber(amount);
            const freeTap = new BigNumber(balance.freeTap);
            const free = new BigNumber(balance.free);

            // Logic: 
            // 1. Deduct from free_tap_balance first
            // 2. Deduct remaining from free_balance
            // 3. Add to locked_balance

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

            await this.processEvent(userId, EconomicEventType.BET_PLACE, ref, delta);
        });
    }

    async settleBet(userId: string, amount: string, win: boolean, rewardRate: string = '0', marketId: string, cellId: string) {
        return this.shardQueue.enqueue(userId, async () => {
            const ref = `${marketId}:${cellId}`;
            const balance = await this.ensureBalanceLoaded(userId);

            const betAmount = new BigNumber(amount);

            if (betAmount.gt(balance.locked)) {
                throw new BadRequestException('Insufficient locked balance');
            }

            let delta: BalanceDelta;

            if (win) {
                // WIN: locked -= betAmount, free += betAmount * (1 + rewardRate)? 
                // Design: free_balance += bet_amount * reward_rate?
                // Design says: 
                // locked_balance -= bet_amount
                // free_balance += bet_amount * reward_rate

                // Wait, usually you get back your principal + profit.
                // If "reward_rate" is e.g. 2.0 (2x payout), then return is amount * 2.
                // Let's assume design means "Total Payout".
                // "free_balance += bet_amount * reward_rate"
                // If reward_rate is total multiplier (e.g. 1.9):
                // locked -= 100
                // free += 190
                // Net change: +90.

                // If reward_rate is "profit rate" (e.g. 0.9):
                // locked -= 100
                // free += 100 (principal) + 90 (profit) = 190.

                // Design says: "free_balance += bet_amount * reward_rate".
                // Let's assume reward_rate is the TOTAL MULTIPLIER (e.g. 2.0).

                const payout = betAmount.times(rewardRate);

                delta = {
                    locked: betAmount.negated().toString(),
                    free: payout.toString(),
                    freeTap: '0'
                };
            } else {
                // LOSE: locked -= betAmount
                delta = {
                    locked: betAmount.negated().toString(),
                    free: '0',
                    freeTap: '0'
                };
            }

            await this.processEvent(userId, EconomicEventType.BET_SETTLE, ref, delta);
        });
    }


    private async processEvent(userId: string, type: EconomicEventType, ref: string, delta: BalanceDelta) {
        if (!validateBalanceDelta(delta)) {
            throw new BadRequestException('Invalid balance delta');
        }
        // 1. Persist Intent (WAL)
        const walRef = await this.wal.appendPrepare(
            this.shardQueue.getShardId(userId),
            userId,
            type,
            ref,
            delta
        );

        // 2. Persist Fact (Ledger)

        const economicKey = `${userId}:${type.valueOf()}:${ref}`;

        try {
            const entry = await this.ledger.append(userId, type, economicKey, delta);

            // 3. Update Memory
            this.balanceStore.applyDelta(userId, entry.id, delta);

            // 4. Commit WAL
            await this.wal.appendCommit(this.shardQueue.getShardId(userId), walRef);

            // 5. Emit event
            this.accountEventPublisher.emitBalanceUpdate({
                userId,
                free: this.balanceStore.get(userId).free,
                locked: this.balanceStore.get(userId).locked,
                freeTap: this.balanceStore.get(userId).freeTap,
                timestamp: Date.now(),
            });
            return entry;
        } catch (err) {
            await this.wal.appendAbort(this.shardQueue.getShardId(userId), walRef);

            if (err.code === '23505') {
                console.log('Duplicate ledger entry for user', userId, 'key', economicKey);
                this.logger.warn(`Duplicate ledger entry for user ${userId}, key ${economicKey}`);

                // Idempotency: try to fetch existing
                return await this.ledger.getEntry(userId, economicKey);
            }

            throw err;
        }
    }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import BigNumber from 'bignumber.js';
import { Repository } from 'typeorm';
import { AccountService } from '../account/account.service';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';
import { DepositHistory } from './entities/deposit-history.entity';
import {
    PaymentChainEvent,
    PaymentChainEventName,
    PaymentChainLedgerStatus,
} from './entities/payment-chain-event.entity';
import { WithdrawalHistory } from './entities/withdrawal-history.entity';
import { WithdrawalSession, WithdrawalStatus } from './entities/withdrawal-session.entity';
import { Inject } from '@nestjs/common';

export interface PaymentChainEventProcessResult {
    processed: number;
    applied: number;
    auditOnly: number;
    failed: number;
}

@Injectable()
export class PaymentChainEventProcessor {
    private readonly logger = new Logger(PaymentChainEventProcessor.name);

    constructor(
        private readonly accountService: AccountService,
        @InjectRepository(PaymentChainEvent)
        private readonly eventRepo: Repository<PaymentChainEvent>,
        @InjectRepository(DepositHistory)
        private readonly depositRepo: Repository<DepositHistory>,
        @InjectRepository(WithdrawalHistory)
        private readonly withdrawalHistoryRepo: Repository<WithdrawalHistory>,
        @InjectRepository(WithdrawalSession)
        private readonly withdrawalSessionRepo: Repository<WithdrawalSession>,
        @Inject(EVENT_PUBLISHER)
        private readonly paymentEventPublisher: EventPublisher,
    ) { }

    async processPending(limit = 500): Promise<PaymentChainEventProcessResult> {
        const events = await this.eventRepo.find({
            where: { ledgerStatus: PaymentChainLedgerStatus.PENDING },
            order: {
                blockNumber: 'ASC',
                logIndex: 'ASC',
            },
            take: limit,
        });

        const result: PaymentChainEventProcessResult = {
            processed: 0,
            applied: 0,
            auditOnly: 0,
            failed: 0,
        };

        for (const event of events) {
            result.processed += 1;
            try {
                const status = await this.processOne(event);
                if (status === PaymentChainLedgerStatus.APPLIED) result.applied += 1;
                if (status === PaymentChainLedgerStatus.AUDIT_ONLY) result.auditOnly += 1;
            } catch (error) {
                result.failed += 1;
                event.ledgerStatus = PaymentChainLedgerStatus.FAILED;
                event.ledgerError = error instanceof Error ? error.message : String(error);
                event.processedAt = new Date();
                await this.eventRepo.save(event);
                this.logger.error(`Failed to process payment chain event ${event.txHash}:${event.logIndex}: ${event.ledgerError}`);
            }
        }

        return result;
    }

    async processOne(event: PaymentChainEvent): Promise<PaymentChainLedgerStatus> {
        if (event.ledgerStatus !== PaymentChainLedgerStatus.PENDING) {
            return event.ledgerStatus;
        }

        switch (event.eventName) {
            case PaymentChainEventName.TRADER_DEPOSITED:
                await this.applyDeposit(event);
                return this.markApplied(event);
            case PaymentChainEventName.TRADER_WITHDRAWN:
                return this.applyWithdrawal(event);
            case PaymentChainEventName.TRADER_CLAIMED:
                return this.markAuditOnly(event, 'TraderClaimed is audit-only until product claim accounting is enabled');
            default:
                return this.markAuditOnly(event, `Unsupported event ${event.eventName}`);
        }
    }

    private async applyDeposit(event: PaymentChainEvent): Promise<void> {
        const existing = await this.depositRepo.findOne({
            where: { txHash: event.txHash, logIndex: event.logIndex },
        });
        if (existing) {
            return;
        }

        await this.accountService.deposit(event.trader, event.amount, event.txHash, event.logIndex);

        const record = this.depositRepo.create({
            userId: event.trader,
            amount: event.amount,
            txHash: event.txHash,
            logIndex: event.logIndex,
            blockNumber: event.blockNumber,
            blockHash: event.blockHash,
            contractAddress: event.contractAddress,
            chainId: event.chainId,
        });

        try {
            await this.depositRepo.save(record);
        } catch (error: any) {
            if (error.code !== '23505') {
                throw error;
            }
        }
    }

    private async applyWithdrawal(event: PaymentChainEvent): Promise<PaymentChainLedgerStatus> {
        const existing = await this.withdrawalHistoryRepo.findOne({
            where: { txHash: event.txHash, logIndex: event.logIndex },
        });
        if (existing) {
            return this.markApplied(event);
        }

        const session = await this.findMatchingOpenWithdrawalSession(event.trader, event.amount);
        if (!session) {
            return this.markAuditOnly(event, 'No matching OPEN withdrawal session');
        }

        await this.accountService.withdrawSucceeded(
            session.userId,
            session.amount,
            event.txHash,
            event.logIndex,
        );

        session.status = WithdrawalStatus.SUCCESS;
        session.txHash = event.txHash;
        await this.withdrawalSessionRepo.save(session);

        const record = this.withdrawalHistoryRepo.create({
            sessionId: session.sessionId,
            userId: session.userId,
            amount: session.amount,
            txHash: event.txHash,
            logIndex: event.logIndex,
            blockNumber: event.blockNumber,
            blockHash: event.blockHash,
            contractAddress: event.contractAddress,
            chainId: event.chainId,
        });

        try {
            await this.withdrawalHistoryRepo.save(record);
        } catch (error: any) {
            if (error.code !== '23505') {
                throw error;
            }
        }

        this.paymentEventPublisher.emitWithdrawSuccess({
            userId: session.userId,
            amount: session.amount,
            timestamp: Date.now(),
            txHash: event.txHash,
            logIndex: event.logIndex,
        });

        return this.markApplied(event);
    }

    private async findMatchingOpenWithdrawalSession(
        userId: string,
        amount: string,
    ): Promise<WithdrawalSession | null> {
        const sessions = await this.withdrawalSessionRepo.find({
            where: {
                userId,
                status: WithdrawalStatus.OPEN,
            },
            order: { createdAt: 'ASC' },
        });

        return sessions.find((session) => new BigNumber(session.amount).eq(amount)) ?? null;
    }

    private async markApplied(event: PaymentChainEvent): Promise<PaymentChainLedgerStatus.APPLIED> {
        event.appliedToLedger = true;
        event.ledgerStatus = PaymentChainLedgerStatus.APPLIED;
        event.ledgerError = null;
        event.processedAt = new Date();
        await this.eventRepo.save(event);
        return PaymentChainLedgerStatus.APPLIED;
    }

    private async markAuditOnly(
        event: PaymentChainEvent,
        reason: string,
    ): Promise<PaymentChainLedgerStatus.AUDIT_ONLY> {
        event.appliedToLedger = false;
        event.ledgerStatus = PaymentChainLedgerStatus.AUDIT_ONLY;
        event.ledgerError = reason;
        event.processedAt = new Date();
        await this.eventRepo.save(event);
        return PaymentChainLedgerStatus.AUDIT_ONLY;
    }
}

import { Injectable, Logger, ConflictException, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountService } from '../account/account.service';
import { DepositHistory } from './entities/deposit-history.entity';
import { WithdrawalSession, WithdrawalStatus } from './entities/withdrawal-session.entity';
import { MockOnChainService } from './mock-on-chain.service';
import { PaymentErrorCode } from './types';
import { WithdrawalHistory } from './entities/withdrawal-history.entity';
import { PAYMENT_EVENT_PUBLISHER, PaymentEventPublisher } from './payment.events';
import { uuidv7 } from 'uuidv7';

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);

    constructor(
        private readonly accountService: AccountService,
        private readonly mockOnChain: MockOnChainService,
        @InjectRepository(DepositHistory)
        private readonly depositRepo: Repository<DepositHistory>,
        @InjectRepository(WithdrawalHistory)
        private readonly withdrawalHistoryRepo: Repository<WithdrawalHistory>,
        @InjectRepository(WithdrawalSession)
        private readonly withdrawalSessionRepo: Repository<WithdrawalSession>,
        @Inject(PAYMENT_EVENT_PUBLISHER)
        private readonly paymentEventPublisher: PaymentEventPublisher,
    ) { }

    /**
     * Handles an on-chain deposit event.
     * Idempotent based on txHash + logIndex.
     */
    async handleDeposit(userId: string, amount: string, txHash: string, logIndex: number) {
        // 1. Check idempotency
        const existing = await this.depositRepo.findOne({
            where: { txHash, logIndex }
        });

        if (existing) {
            this.logger.log(`Deposit already processed: ${txHash}:${logIndex}`);
            return existing;
        }

        // 2. Apply to Account Service (Idempotency handled there too, but we double check here for DB record)
        await this.accountService.deposit(userId, amount, txHash, logIndex);

        // 3. Record history
        const record = this.depositRepo.create({
            userId,
            amount,
            txHash,
            logIndex,
        });

        try {
            return await this.depositRepo.save(record);
        } catch (err: any) {
            if (err.code === '23505') { // Unique violation
                return await this.depositRepo.findOne({ where: { txHash, logIndex } });
            }
            throw err;
        }
    }

    /**
     * Initiates a withdrawal session.
     */
    async requestWithdrawal(userId: string, amount: string) {
        // 1. Check for existing OPEN session
        const existingSession = await this.withdrawalSessionRepo.findOne({
            where: { userId, status: WithdrawalStatus.OPEN }
        });

        if (existingSession) {
            // Check if expired
            if (existingSession.expiresAt < new Date()) {
                await this.expireWithdrawal(existingSession.sessionId);
            } else {
                // Return existing session
                return {
                    sessionId: existingSession.sessionId,
                    amount: existingSession.amount,
                    approvalSignature: existingSession.approvalSignature,
                    expiresAt: existingSession.expiresAt,
                    isExisting: true
                };
            }
        }

        const sessionId = uuidv7();

        // 2. Lock funds via Account Service
        // If this fails (insufficient funds), it throws
        await this.accountService.withdrawRequested(userId, amount, sessionId);

        // 3. Generate Approval
        const approvalSignature = await this.mockOnChain.signWithdrawalApproval(sessionId, userId, amount);

        // 4. Save Session
        const session = this.withdrawalSessionRepo.create({
            sessionId,
            userId,
            amount,
            status: WithdrawalStatus.OPEN,
            approvalSignature,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min expiry
        });

        await this.withdrawalSessionRepo.save(session);

        this.paymentEventPublisher.emitWithdrawQueued({
            sessionId,
            userId,
            amount,
            timestamp: Date.now(),
        });

        return {
            sessionId,
            amount,
            approvalSignature,
            expiresAt: session.expiresAt,
            isExisting: false
        };
    }

    /**
     * Finalizes a withdrawal session using the on-chain tx hash.
     */
    async finalizeWithdrawal(sessionId: string, txHash: string, logIndex: number) {
        const session = await this.withdrawalSessionRepo.findOne({ where: { sessionId } });
        if (!session) {
            throw new NotFoundException(PaymentErrorCode.SESSION_NOT_FOUND);
        }

        if (session.status !== WithdrawalStatus.OPEN) {
            // If already success, return
            if (session.status === WithdrawalStatus.SUCCESS && session.txHash === txHash) {
                return session;
            }
            throw new ConflictException(`Session status is ${session.status}`);
        }

        // Apply to Account Service
        await this.accountService.withdrawSucceeded(session.userId, session.amount, txHash, logIndex);

        // Update Session
        session.status = WithdrawalStatus.SUCCESS;
        session.txHash = txHash;
        await this.withdrawalSessionRepo.save(session);

        // Record history
        const record = this.withdrawalHistoryRepo.create({
            sessionId,
            userId: session.userId,
            amount: session.amount,
            txHash,
            logIndex,
        });

        try {
            const saved = await this.withdrawalHistoryRepo.save(record);
            this.paymentEventPublisher.emitWithdrawSuccess({
                userId: session.userId,
                amount: session.amount,
                timestamp: Date.now(),
                txHash,
                logIndex,
            });
            return saved;
        } catch (err: any) {
            if (err.code === '23505') { // Unique violation
                return await this.withdrawalHistoryRepo.findOne({ where: { txHash, logIndex } });
            }
            throw err;
        }
    }

    /**
     * Expires a withdrawal session manually or via cron (not implemented).
     */
    async expireWithdrawal(sessionId: string) {
        const session = await this.withdrawalSessionRepo.findOne({ where: { sessionId } });
        if (!session) {
            throw new NotFoundException(PaymentErrorCode.SESSION_NOT_FOUND);
        }

        if (session.status !== WithdrawalStatus.OPEN) {
            return;
        }

        // Unlock funds
        await this.accountService.withdrawCancelled(session.userId, session.amount, sessionId);

        // Update status
        session.status = WithdrawalStatus.EXPIRED;
        await this.withdrawalSessionRepo.save(session);
        this.paymentEventPublisher.emitWithdrawCancelled({
            sessionId,
            userId: session.userId,
            amount: session.amount,
            timestamp: Date.now(),
        });
    }
}

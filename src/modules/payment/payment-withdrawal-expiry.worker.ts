import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { env } from 'src/config';
import { WithdrawalSession, WithdrawalStatus } from './entities/withdrawal-session.entity';
import { PaymentService } from './payment.service';

export interface PaymentWithdrawalExpiryResult {
    scanned: number;
    expired: number;
    failed: number;
}

@Injectable()
export class PaymentWithdrawalExpiryWorker {
    private readonly logger = new Logger(PaymentWithdrawalExpiryWorker.name);
    private timer?: NodeJS.Timeout;
    private running = false;

    constructor(
        private readonly paymentService: PaymentService,
        @InjectRepository(WithdrawalSession)
        private readonly withdrawalSessionRepo: Repository<WithdrawalSession>,
    ) { }

    startPolling() {
        if (!env.payment.withdrawalExpiryEnabled || env.env === 'test') {
            return;
        }
        if (this.timer) {
            return;
        }

        this.timer = setInterval(() => {
            this.expireDueSessions().catch((error) => {
                this.logger.error(`Withdrawal expiry worker failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }, env.payment.withdrawalExpiryPollMs);

        this.expireDueSessions().catch((error) => {
            this.logger.error(`Initial withdrawal expiry sweep failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    stopPolling() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    async expireDueSessions(now = new Date()): Promise<PaymentWithdrawalExpiryResult | null> {
        if (this.running) {
            return null;
        }

        this.running = true;
        try {
            const sessions = await this.withdrawalSessionRepo.find({
                where: {
                    status: WithdrawalStatus.OPEN,
                    expiresAt: LessThan(now),
                },
                order: { expiresAt: 'ASC' },
                take: env.payment.withdrawalExpiryBatchSize,
            });

            const result: PaymentWithdrawalExpiryResult = {
                scanned: sessions.length,
                expired: 0,
                failed: 0,
            };

            for (const session of sessions) {
                try {
                    await this.paymentService.expireWithdrawal(session.sessionId);
                    result.expired += 1;
                } catch (error) {
                    result.failed += 1;
                    this.logger.error(
                        `Failed to expire withdrawal session ${session.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }

            return result;
        } finally {
            this.running = false;
        }
    }
}

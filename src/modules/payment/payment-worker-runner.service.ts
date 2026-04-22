import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PaymentChainSyncWorker } from './payment-chain-sync.worker';
import { PaymentWithdrawalExpiryWorker } from './payment-withdrawal-expiry.worker';

@Injectable()
export class PaymentWorkerRunner implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PaymentWorkerRunner.name);

    constructor(
        private readonly chainSyncWorker: PaymentChainSyncWorker,
        private readonly withdrawalExpiryWorker: PaymentWithdrawalExpiryWorker,
    ) { }

    onModuleInit(): void {
        this.logger.log('Starting payment background workers');
        this.chainSyncWorker.startPolling();
        this.withdrawalExpiryWorker.startPolling();
    }

    onModuleDestroy(): void {
        this.logger.log('Stopping payment background workers');
        this.chainSyncWorker.stopPolling();
        this.withdrawalExpiryWorker.stopPolling();
    }
}

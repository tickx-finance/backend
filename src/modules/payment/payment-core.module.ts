import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountModule } from '../account/account.module';
import { SocketModule } from '../socket/socket.module';
import { PaymentService } from './payment.service';
import { WithdrawalSession } from './entities/withdrawal-session.entity';
import { DepositHistory } from './entities/deposit-history.entity';
import { WithdrawalHistory } from './entities/withdrawal-history.entity';
import { PaymentChainClient } from './payment-chain.client';
import { WithdrawalClaimSigner } from './withdrawal-claim-signer.service';
import { PaymentChainCursor } from './entities/payment-chain-cursor.entity';
import { PaymentChainEvent } from './entities/payment-chain-event.entity';
import { PaymentChainSyncWorker } from './payment-chain-sync.worker';
import { PaymentChainEventProcessor } from './payment-chain-event-processor.service';
import { PaymentWithdrawalExpiryWorker } from './payment-withdrawal-expiry.worker';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            WithdrawalSession,
            DepositHistory,
            WithdrawalHistory,
            PaymentChainCursor,
            PaymentChainEvent,
        ]),
        AccountModule,
        SocketModule,
    ],
    providers: [
        PaymentService,
        PaymentChainClient,
        WithdrawalClaimSigner,
        PaymentChainEventProcessor,
        PaymentChainSyncWorker,
        PaymentWithdrawalExpiryWorker,
    ],
    exports: [
        PaymentService,
        PaymentChainClient,
        WithdrawalClaimSigner,
        PaymentChainEventProcessor,
        PaymentChainSyncWorker,
        PaymentWithdrawalExpiryWorker,
    ],
})
export class PaymentCoreModule { }

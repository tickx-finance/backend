import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountModule } from '../account/account.module';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { MockOnChainService } from './mock-on-chain.service';
import { WithdrawalSession } from './entities/withdrawal-session.entity';
import { DepositHistory } from './entities/deposit-history.entity';
import { WithdrawalHistory } from './entities/withdrawal-history.entity';
import { PAYMENT_EVENT_PUBLISHER } from './payment.events';

@Module({
    imports: [
        TypeOrmModule.forFeature([WithdrawalSession, DepositHistory, WithdrawalHistory]),
        AccountModule,
    ],
    controllers: [PaymentController],
    providers: [
        PaymentService,
        MockOnChainService,
        // 👇 declare the port
        {
            provide: PAYMENT_EVENT_PUBLISHER,
            useFactory: () => {
                throw new Error(
                    'PAYMENT_EVENT_PUBLISHER not provided. Did you forget to override it?',
                );
            },
        },
    ],
    exports: [PaymentService],
})
export class PaymentModule { }

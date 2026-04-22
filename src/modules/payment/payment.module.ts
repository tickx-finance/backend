import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountModule } from '../account/account.module';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { MockOnChainService } from './mock-on-chain.service';
import { WithdrawalSession } from './entities/withdrawal-session.entity';
import { DepositHistory } from './entities/deposit-history.entity';
import { WithdrawalHistory } from './entities/withdrawal-history.entity';
import { SocketModule } from '../socket/socket.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([WithdrawalSession, DepositHistory, WithdrawalHistory]),
        AccountModule,
        SocketModule,
    ],
    controllers: [PaymentController],
    providers: [
        PaymentService,
        MockOnChainService,
    ],
    exports: [PaymentService],
})
export class PaymentModule { }

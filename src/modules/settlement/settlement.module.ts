import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementController } from './settlement.controller';
import { Order } from '../order/entities/order.entity';
import { DepositHistory } from '../payment/entities/deposit-history.entity';
import { WithdrawalHistory } from '../payment/entities/withdrawal-history.entity';
import { SettlementService } from './settlement.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, DepositHistory, WithdrawalHistory]),
  ],
  controllers: [SettlementController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}

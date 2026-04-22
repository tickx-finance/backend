import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { Order } from '../order/entities/order.entity';
import { DepositHistory } from '../payment/entities/deposit-history.entity';
import { WithdrawalHistory } from '../payment/entities/withdrawal-history.entity';
import { SettlementBatchCommit } from './entities/settlement-batch-commit.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      DepositHistory,
      WithdrawalHistory,
      SettlementBatchCommit,
    ]),
  ],
  controllers: [SettlementController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}

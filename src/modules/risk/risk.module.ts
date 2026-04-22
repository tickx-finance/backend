import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskController } from './risk.controller';
import { RiskService } from './risk.service';
import { LedgerSnapshot } from '../account/entities/ledger-snapshot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerSnapshot])],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}

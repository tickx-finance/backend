import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerServiceSyncWorkflowId } from './worker-sync-workflow-id.service';
import { WorkerService } from './worker.service';
import { WorkerController } from './worker.controller';
import { WorkflowIdUpdate } from './entities/workflow-id-update.entity';
import { PriceIntegrityBatch } from './entities/price-integrity-batch.entity';
import { BatchSubmitted } from './entities/batch-submitted.entity';
import { SettlementBatch } from './entities/settlement-batch.entity';
import { SolvencyReport } from './entities/solvency-report.entity';
import { LPDistributionRequest } from './entities/lp-distribution-request.entity';
import { ReserveAllocated } from './entities/reserve-allocated.entity';
import { VolatilityRegime } from './entities/volatility-regime.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowIdUpdate,
      PriceIntegrityBatch,
      BatchSubmitted,
      SettlementBatch,
      SolvencyReport,
      LPDistributionRequest,
      ReserveAllocated,
      VolatilityRegime,
    ]),
  ],
  controllers: [WorkerController],
  providers: [WorkerServiceSyncWorkflowId, WorkerService],
  exports: [WorkerServiceSyncWorkflowId, WorkerService],
})
export class WorkerModule {}

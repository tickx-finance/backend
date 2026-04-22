import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerServiceSyncWorkflowId } from './worker-sync-workflow-id.service';
import { WorkflowIdUpdate } from './entities/workflow-id-update.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WorkflowIdUpdate])],
  providers: [WorkerServiceSyncWorkflowId],
  exports: [WorkerServiceSyncWorkflowId],
})
export class WorkerModule {}

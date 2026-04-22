import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { workflowIdAdapter } from 'src/adapters/workflow-id/workflow-id.adapter';
import { provider } from 'src/libs/web3/provider';
import { RedisCheckpoint, RedisLock } from 'src/utils/redis.utils';
import { RedisKey } from 'src/utils/RedisKey';
import { createNewLog } from 'src/utils/helpers';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowIdUpdate } from './entities/workflow-id-update.entity';
import { ParsedExpectedWorkflowIdUpdatedEvent } from 'src/adapters/workflow-id/workflow-id.schema';

// Default starting block number - should be set to deployment block of contracts
const DEFAULT_START_BLOCK = 10346859;

@Injectable()
export class WorkerServiceSyncWorkflowId implements OnModuleInit {
  provider = provider;
  private logger: Logger = new Logger(WorkerServiceSyncWorkflowId.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectRepository(WorkflowIdUpdate)
    private readonly workflowIdUpdateRepo: Repository<WorkflowIdUpdate>,
  ) {}

  /**
   * Release lock when module starts (prevent stuck lock on restart)
   */
  async onModuleInit() {
    await RedisLock.releaseLock(
      this.redis,
      RedisKey.is_syncing_workflow_id_updated,
    );
  }

  /**
   * Cron job running every 5 seconds to sync events
   * Pattern: seconds minutes hours day month day_of_week
   */
  @Cron('*/5 * * * * *')
  async syncAllEvents() {
    // 1. SET LOCK - Only 1 instance runs at a time
    const isSetLockSuccessful = await RedisLock.setLock(
      this.redis,
      RedisKey.is_syncing_workflow_id_updated,
      60, // TTL: 60 seconds (auto expire if process crashes)
    );

    if (!isSetLockSuccessful) {
      // Another instance is running
      return;
    }

    try {
      // 2. GET BLOCK NUMBERS
      const blockNumberNow = await this.provider.getBlockNumber();

      // Get checkpoint from Redis or use default block number
      const fromBlockNumber =
        (await RedisCheckpoint.getCheckPoint(
          this.redis,
          RedisKey.workflow_id_updated_block_number,
        )) ?? DEFAULT_START_BLOCK;

      // Calculate end block (limit range to avoid timeout)
      const toBlockNumber = RedisCheckpoint.calculateToBlock(
        blockNumberNow,
        fromBlockNumber,
        500, // Max 500 blocks per query
      );

      // 3. SYNC IF THERE ARE NEW BLOCKS
      if (fromBlockNumber <= toBlockNumber) {
        await this.syncEventsInRange(fromBlockNumber, toBlockNumber);
      }
    } catch (err) {
      createNewLog(
        this.logger,
        'job',
        'SyncAllEvents',
        'error',
        err.message,
        err,
      );
    } finally {
      // 4. RELEASE LOCK - Always release even on failure
      await RedisLock.releaseLock(
        this.redis,
        RedisKey.is_syncing_workflow_id_updated,
      );
    }
  }

  /**
   * Sync events in a range and update checkpoint
   */
  async syncEventsInRange(fromBlockNumber: number, toBlockNumber: number) {
    this.logger.log(
      `Syncing ExpectedWorkflowIdUpdated events from block ${fromBlockNumber} to ${toBlockNumber}`,
    );

    // Crawl events from adapter
    const eventsResponse = await workflowIdAdapter.crawlEvents(
      fromBlockNumber,
      toBlockNumber,
    );

    // Handle events - save to database
    await this.handleWorkflowIdUpdatedEvents(
      eventsResponse.expectedWorkflowIdUpdatedEvents,
    );

    // 5. UPDATE CHECKPOINT - Next block will start from here
    await RedisCheckpoint.setCheckPoint(
      this.redis,
      RedisKey.workflow_id_updated_block_number,
      toBlockNumber + 1, // +1 to avoid re-syncing the last block
    );

    this.logger.log(
      `Synced ${eventsResponse.expectedWorkflowIdUpdatedEvents.length} ExpectedWorkflowIdUpdated events`,
    );
  }

  /**
   * Handle ExpectedWorkflowIdUpdated events - save to database with idempotency check
   */
  async handleWorkflowIdUpdatedEvents(
    events: ParsedExpectedWorkflowIdUpdatedEvent[],
  ) {
    if (!events.length) {
      return;
    }

    // Check for existing events (by transactionHash + logIndex)
    const existingRecords = await this.workflowIdUpdateRepo.find({
      where: events.map((e) => ({
        transactionHash: e.hash,
        logIndex: e.logIndex,
      })),
    });

    const existingKeys = new Set(
      existingRecords.map((r) => `${r.transactionHash}-${r.logIndex}`),
    );

    // Filter only new events
    const newEvents = events.filter(
      (e) => !existingKeys.has(`${e.hash}-${e.logIndex}`),
    );

    if (!newEvents.length) {
      this.logger.log('All events already exist in database');
      return;
    }

    // Map to entities
    const entities = newEvents.map((event) =>
      this.workflowIdUpdateRepo.create({
        transactionHash: event.hash,
        contractAddress: event.address,
        blockNumber: event.blockNumber,
        blockTimestamp: event.timestamp,
        logIndex: event.logIndex,
        previousId: event.args.previousId,
        newId: event.args.newId,
      }),
    );

    // Save to database
    await this.workflowIdUpdateRepo.save(entities);

    this.logger.log(
      `Saved ${entities.length} new ExpectedWorkflowIdUpdated events`,
    );
  }
}

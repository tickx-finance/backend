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
import { PriceIntegrityBatch } from './entities/price-integrity-batch.entity';
import { BatchSubmitted } from './entities/batch-submitted.entity';
import { SettlementBatch } from './entities/settlement-batch.entity';
import { SolvencyReport } from './entities/solvency-report.entity';
import { LPDistributionRequest } from './entities/lp-distribution-request.entity';
import { ReserveAllocated } from './entities/reserve-allocated.entity';
import { VolatilityRegime } from './entities/volatility-regime.entity';
import {
  ParsedExpectedWorkflowIdUpdatedEvent,
  ParsedPriceIntegrityBatchReportedEvent,
  ParsedBatchSubmittedEvent,
  ParsedSettlementBatchCommittedEvent,
  ParsedSolvencyReportedEvent,
  ParsedCCIPDistributionRequestedEvent,
  ParsedReserveAllocatedToDistributorEvent,
  ParsedVolatilityRegimeChangedEvent,
} from 'src/adapters/workflow-id/workflow-id.schema';

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
    @InjectRepository(PriceIntegrityBatch)
    private readonly priceIntegrityBatchRepo: Repository<PriceIntegrityBatch>,
    @InjectRepository(BatchSubmitted)
    private readonly batchSubmittedRepo: Repository<BatchSubmitted>,
    @InjectRepository(SettlementBatch)
    private readonly settlementBatchRepo: Repository<SettlementBatch>,
    @InjectRepository(SolvencyReport)
    private readonly solvencyReportRepo: Repository<SolvencyReport>,
    @InjectRepository(LPDistributionRequest)
    private readonly lpDistributionRequestRepo: Repository<LPDistributionRequest>,
    @InjectRepository(ReserveAllocated)
    private readonly reserveAllocatedRepo: Repository<ReserveAllocated>,
    @InjectRepository(VolatilityRegime)
    private readonly volatilityRegimeRepo: Repository<VolatilityRegime>,
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
      `Syncing CRE events from block ${fromBlockNumber} to ${toBlockNumber}`,
    );

    // Crawl events from adapter
    const eventsResponse = await workflowIdAdapter.crawlEvents(
      fromBlockNumber,
      toBlockNumber,
    );

    console.log(eventsResponse);

    // Handle all event types
    await Promise.all([
      this.handleWorkflowIdUpdatedEvents(
        eventsResponse.expectedWorkflowIdUpdatedEvents,
      ),
      this.handlePriceIntegrityBatchReportedEvents(
        eventsResponse.priceIntegrityBatchReportedEvents,
      ),
      this.handleBatchSubmittedEvents(eventsResponse.batchSubmittedEvents),
      this.handleSettlementBatchCommittedEvents(
        eventsResponse.settlementBatchCommittedEvents,
      ),
      this.handleSolvencyReportedEvents(eventsResponse.solvencyReportedEvents),
      this.handleCCIPDistributionRequestedEvents(
        eventsResponse.ccipDistributionRequestedEvents,
      ),
      this.handleReserveAllocatedToDistributorEvents(
        eventsResponse.reserveAllocatedToDistributorEvents,
      ),
      this.handleVolatilityRegimeChangedEvents(
        eventsResponse.volatilityRegimeChangedEvents,
      ),
    ]);

    // 5. UPDATE CHECKPOINT - Next block will start from here
    await RedisCheckpoint.setCheckPoint(
      this.redis,
      RedisKey.workflow_id_updated_block_number,
      toBlockNumber + 1, // +1 to avoid re-syncing the last block
    );

    const totalEvents =
      eventsResponse.expectedWorkflowIdUpdatedEvents.length +
      eventsResponse.priceIntegrityBatchReportedEvents.length +
      eventsResponse.batchSubmittedEvents.length +
      eventsResponse.settlementBatchCommittedEvents.length +
      eventsResponse.solvencyReportedEvents.length +
      eventsResponse.ccipDistributionRequestedEvents.length +
      eventsResponse.reserveAllocatedToDistributorEvents.length +
      eventsResponse.volatilityRegimeChangedEvents.length;

    this.logger.log(`Synced ${totalEvents} total CRE events`);
  }

  // ==================== Event Handlers ====================

  /**
   * Handle ExpectedWorkflowIdUpdated events - save to database with idempotency check
   */
  async handleWorkflowIdUpdatedEvents(
    events: ParsedExpectedWorkflowIdUpdatedEvent[],
  ) {
    if (!events.length) return;

    const newEvents = await this.filterExistingEvents(
      events,
      this.workflowIdUpdateRepo,
    );
    if (!newEvents.length) return;

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

    await this.workflowIdUpdateRepo.save(entities);
    this.logger.log(
      `Saved ${entities.length} ExpectedWorkflowIdUpdated events`,
    );
  }

  /**
   * Handle PriceIntegrityBatchReported events
   */
  async handlePriceIntegrityBatchReportedEvents(
    events: ParsedPriceIntegrityBatchReportedEvent[],
  ) {
    if (!events.length) return;

    const newEvents = await this.filterExistingEvents(
      events,
      this.priceIntegrityBatchRepo,
    );
    if (!newEvents.length) return;

    const entities = newEvents.map((event) =>
      this.priceIntegrityBatchRepo.create({
        transactionHash: event.hash,
        contractAddress: event.address,
        blockNumber: event.blockNumber,
        blockTimestamp: event.timestamp,
        logIndex: event.logIndex,
        epochId: event.args.epochId,
        windowStart: event.args.windowStart,
        candleCount: event.args.candleCount,
        internalCandlesHash: event.args.internalCandlesHash,
        chainlinkCandlesHash: event.args.chainlinkCandlesHash,
        ohlcMaeBps: event.args.ohlcMaeBps,
        ohlcP95Bps: event.args.ohlcP95Bps,
        ohlcMaxBps: event.args.ohlcMaxBps,
        directionMatchBps: event.args.directionMatchBps,
        outlierCount: event.args.outlierCount,
        scoreBps: event.args.scoreBps,
        diffMerkleRoot: event.args.diffMerkleRoot,
      }),
    );

    await this.priceIntegrityBatchRepo.save(entities);
    this.logger.log(
      `Saved ${entities.length} PriceIntegrityBatchReported events`,
    );
  }

  /**
   * Handle BatchSubmitted events
   */
  async handleBatchSubmittedEvents(events: ParsedBatchSubmittedEvent[]) {
    if (!events.length) return;

    const newEvents = await this.filterExistingEvents(
      events,
      this.batchSubmittedRepo,
    );
    if (!newEvents.length) return;

    const entities = newEvents.map((event) =>
      this.batchSubmittedRepo.create({
        transactionHash: event.hash,
        contractAddress: event.address,
        blockNumber: event.blockNumber,
        blockTimestamp: event.timestamp,
        logIndex: event.logIndex,
        epochId: event.args.epochId,
        scoreBps: event.args.scoreBps,
        ohlcP95Bps: event.args.ohlcP95Bps,
        isPassed: event.args.isPassed,
        failureFlags: event.args.failureFlags,
      }),
    );

    await this.batchSubmittedRepo.save(entities);
    this.logger.log(`Saved ${entities.length} BatchSubmitted events`);
  }

  /**
   * Handle SettlementBatchCommitted events
   */
  async handleSettlementBatchCommittedEvents(
    events: ParsedSettlementBatchCommittedEvent[],
  ) {
    if (!events.length) return;

    const newEvents = await this.filterExistingEvents(
      events,
      this.settlementBatchRepo,
    );
    if (!newEvents.length) return;

    const entities = newEvents.map((event) =>
      this.settlementBatchRepo.create({
        transactionHash: event.hash,
        contractAddress: event.address,
        blockNumber: event.blockNumber,
        blockTimestamp: event.timestamp,
        logIndex: event.logIndex,
        batchId: event.args.batchId,
        merkleRoot: event.args.merkleRoot,
        totalPayout: event.args.totalPayout,
        withdrawableCap: event.args.withdrawableCap,
        windowStart: event.args.windowStart,
        windowEnd: event.args.windowEnd,
      }),
    );

    await this.settlementBatchRepo.save(entities);
    this.logger.log(`Saved ${entities.length} SettlementBatchCommitted events`);
  }

  /**
   * Handle SolvencyReported events
   */
  async handleSolvencyReportedEvents(events: ParsedSolvencyReportedEvent[]) {
    if (!events.length) return;

    const newEvents = await this.filterExistingEvents(
      events,
      this.solvencyReportRepo,
    );
    if (!newEvents.length) return;

    const entities = newEvents.map((event) =>
      this.solvencyReportRepo.create({
        transactionHash: event.hash,
        contractAddress: event.address,
        blockNumber: event.blockNumber,
        blockTimestamp: event.timestamp,
        logIndex: event.logIndex,
        epochId: event.args.epochId,
        poolBalance: event.args.poolBalance,
        totalLiability: event.args.totalLiability,
        utilizationBps: event.args.utilizationBps,
        maxSingleBetExposure: event.args.maxSingleBetExposure,
      }),
    );

    await this.solvencyReportRepo.save(entities);
    this.logger.log(`Saved ${entities.length} SolvencyReported events`);
  }

  /**
   * Handle CCIPDistributionRequested events
   */
  async handleCCIPDistributionRequestedEvents(
    events: ParsedCCIPDistributionRequestedEvent[],
  ) {
    if (!events.length) return;

    const newEvents = await this.filterExistingEvents(
      events,
      this.lpDistributionRequestRepo,
    );
    if (!newEvents.length) return;

    const entities = newEvents.map((event) =>
      this.lpDistributionRequestRepo.create({
        transactionHash: event.hash,
        contractAddress: event.address,
        blockNumber: event.blockNumber,
        blockTimestamp: event.timestamp,
        logIndex: event.logIndex,
        epochId: event.args.epochId,
        amount: event.args.amount,
        dstChainSelector: event.args.dstChainSelector,
        receiver: event.args.receiver,
      }),
    );

    await this.lpDistributionRequestRepo.save(entities);
    this.logger.log(
      `Saved ${entities.length} CCIPDistributionRequested events`,
    );
  }

  /**
   * Handle ReserveAllocatedToDistributor events
   */
  async handleReserveAllocatedToDistributorEvents(
    events: ParsedReserveAllocatedToDistributorEvent[],
  ) {
    if (!events.length) return;

    const newEvents = await this.filterExistingEvents(
      events,
      this.reserveAllocatedRepo,
    );
    if (!newEvents.length) return;

    const entities = newEvents.map((event) =>
      this.reserveAllocatedRepo.create({
        transactionHash: event.hash,
        contractAddress: event.address,
        blockNumber: event.blockNumber,
        blockTimestamp: event.timestamp,
        logIndex: event.logIndex,
        amount: event.args.amount,
        receiver: event.args.receiver,
      }),
    );

    await this.reserveAllocatedRepo.save(entities);
    this.logger.log(
      `Saved ${entities.length} ReserveAllocatedToDistributor events`,
    );
  }

  /**
   * Handle VolatilityRegimeChanged events
   */
  async handleVolatilityRegimeChangedEvents(
    events: ParsedVolatilityRegimeChangedEvent[],
  ) {
    if (!events.length) return;

    const newEvents = await this.filterExistingEvents(
      events,
      this.volatilityRegimeRepo,
    );
    if (!newEvents.length) return;

    const entities = newEvents.map((event) =>
      this.volatilityRegimeRepo.create({
        transactionHash: event.hash,
        contractAddress: event.address,
        blockNumber: event.blockNumber,
        blockTimestamp: event.timestamp,
        logIndex: event.logIndex,
        regimeId: event.args.regimeId,
        fortressSpreadBps: event.args.fortressSpreadBps,
        maxMultiplier: event.args.maxMultiplier,
      }),
    );

    await this.volatilityRegimeRepo.save(entities);
    this.logger.log(`Saved ${entities.length} VolatilityRegimeChanged events`);
  }

  // ==================== Helper Methods ====================

  /**
   * Filter out existing events based on transactionHash + logIndex
   */
  private async filterExistingEvents<
    T extends { hash: string; logIndex: number },
  >(events: T[], repo: Repository<any>): Promise<T[]> {
    if (!events.length) return [];

    const existingRecords = await repo.find({
      where: events.map((e) => ({
        transactionHash: e.hash,
        logIndex: e.logIndex,
      })),
    });

    const existingKeys = new Set(
      existingRecords.map((r) => `${r.transactionHash}-${r.logIndex}`),
    );

    return events.filter((e) => !existingKeys.has(`${e.hash}-${e.logIndex}`));
  }
}

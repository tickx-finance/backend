import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Order } from '../order/entities/order.entity';
import { DepositHistory } from '../payment/entities/deposit-history.entity';
import { WithdrawalHistory } from '../payment/entities/withdrawal-history.entity';
import { SettlementBatchCommit } from './entities/settlement-batch-commit.entity';
import { OrderStatus } from '../order/types';
import {
  SettlementBatchesResponse,
  SettlementBatch,
  SettlementDeposit,
  SettlementWithdrawal,
  SettlementItem,
} from './types/settlement.types';

/**
 * Batch size in seconds (15 minutes = 900 seconds)
 */
const BATCH_SIZE_SECONDS = 900;

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(DepositHistory)
    private readonly depositRepository: Repository<DepositHistory>,
    @InjectRepository(WithdrawalHistory)
    private readonly withdrawalRepository: Repository<WithdrawalHistory>,
    @InjectRepository(SettlementBatchCommit)
    private readonly commitRepository: Repository<SettlementBatchCommit>,
  ) {}

  /**
   * Get pending settlement batches for a time window
   * Groups data into 15-minute batches
   */
  async getPendingBatches(
    windowStart: number,
    windowEnd: number,
  ): Promise<SettlementBatchesResponse> {
    this.logger.debug(
      `Fetching settlement batches: windowStart=${windowStart}, windowEnd=${windowEnd}`,
    );

    // Convert to milliseconds for DB queries
    const windowStartMs = windowStart * 1000;
    const windowEndMs = windowEnd * 1000;

    // Fetch data from DB
    const [deposits, withdrawals, settledOrders] = await Promise.all([
      this.fetchDeposits(windowStartMs, windowEndMs),
      this.fetchWithdrawals(windowStartMs, windowEndMs),
      this.fetchSettledOrders(windowStartMs, windowEndMs),
    ]);

    this.logger.debug(
      `Fetched: ${deposits.length} deposits, ${withdrawals.length} withdrawals, ${settledOrders.length} settlements`,
    );

    // Group into batches
    const batches = this.groupIntoBatches(
      windowStart,
      windowEnd,
      deposits,
      withdrawals,
      settledOrders,
    );

    return { batches };
  }

  /**
   * Commit a settlement batch (API 3)
   */
  async commitBatch(
    batchId: string,
    txHash: string,
    merkleRoot: string,
    committedAt: number,
  ): Promise<{ success: boolean; batchId: string }> {
    this.logger.debug(
      `Committing batch: ${batchId}, txHash: ${txHash}, merkleRoot: ${merkleRoot}, committedAt: ${committedAt}`,
    );

    // Check if batch already committed
    const existing = await this.commitRepository.findOne({
      where: { batchId },
    });

    if (existing) {
      this.logger.warn(`Batch ${batchId} already committed, updating...`);
      existing.txHash = txHash;
      existing.merkleRoot = merkleRoot;
      existing.committedAt = committedAt;
      await this.commitRepository.save(existing);
    } else {
      // Create new commit record
      const commit = this.commitRepository.create({
        batchId,
        txHash,
        merkleRoot,
        committedAt,
      });
      await this.commitRepository.save(commit);
    }

    this.logger.log(`Batch ${batchId} committed successfully`);

    return {
      success: true,
      batchId,
    };
  }

  /**
   * Get committed batches by committedAt time window (API Query)
   * Query batches where committedAt is between windowStart and windowEnd
   */
  async getCommittedBatches(
    windowStart: number,
    windowEnd: number,
  ): Promise<SettlementBatchCommit[]> {
    this.logger.debug(
      `Fetching committed batches: committedAt between ${windowStart} and ${windowEnd}`,
    );

    const commits = await this.commitRepository.find({
      where: {
        committedAt: Between(windowStart, windowEnd),
      },
      order: {
        committedAt: 'ASC',
      },
    });

    this.logger.debug(`Found ${commits.length} committed batches`);

    return commits;
  }

  /**
   * Get a single committed batch by batchId
   */
  async getCommittedBatch(batchId: string): Promise<SettlementBatchCommit> {
    const commit = await this.commitRepository.findOne({
      where: { batchId },
    });

    if (!commit) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    return commit;
  }

  // ============ Private methods ============

  /**
   * Fetch deposits within time window
   */
  private async fetchDeposits(
    windowStartMs: number,
    windowEndMs: number,
  ): Promise<DepositHistory[]> {
    return this.depositRepository.find({
      where: {
        createdAt: Between(new Date(windowStartMs), new Date(windowEndMs)),
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  /**
   * Fetch withdrawals within time window
   */
  private async fetchWithdrawals(
    windowStartMs: number,
    windowEndMs: number,
  ): Promise<WithdrawalHistory[]> {
    return this.withdrawalRepository.find({
      where: {
        createdAt: Between(new Date(windowStartMs), new Date(windowEndMs)),
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  /**
   * Fetch settled orders within time window
   */
  private async fetchSettledOrders(
    windowStartMs: number,
    windowEndMs: number,
  ): Promise<Order[]> {
    return this.orderRepository.find({
      where: [
        {
          status: OrderStatus.SETTLED,
          settledAt: Between(windowStartMs, windowEndMs),
        },
      ],
      order: {
        settledAt: 'ASC',
      },
    });
  }

  /**
   * Group data into 15-minute batches
   */
  private groupIntoBatches(
    windowStart: number,
    windowEnd: number,
    deposits: DepositHistory[],
    withdrawals: WithdrawalHistory[],
    orders: Order[],
  ): SettlementBatch[] {
    const batches: SettlementBatch[] = [];

    // Generate batch windows
    for (
      let batchStart = windowStart;
      batchStart < windowEnd;
      batchStart += BATCH_SIZE_SECONDS
    ) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE_SECONDS, windowEnd);
      const batchStartMs = batchStart * 1000;
      const batchEndMs = batchEnd * 1000;

      // Filter data for this batch
      const batchDeposits = this.filterDepositsByTimeRange(
        deposits,
        batchStartMs,
        batchEndMs,
      );
      const batchWithdrawals = this.filterWithdrawalsByTimeRange(
        withdrawals,
        batchStartMs,
        batchEndMs,
      );
      const batchSettlements = this.filterOrdersByTimeRange(
        orders,
        batchStartMs,
        batchEndMs,
      );

      // Only create batch if there's data
      if (
        batchDeposits.length > 0 ||
        batchWithdrawals.length > 0 ||
        batchSettlements.length > 0
      ) {
        const batch: SettlementBatch = {
          batchId: this.generateBatchId(batchStart),
          windowStart: batchStart,
          windowEnd: batchEnd,
          deposits: batchDeposits,
          withdrawals: batchWithdrawals,
          settlements: batchSettlements,
        };
        batches.push(batch);
      }
    }

    return batches;
  }

  /**
   * Filter deposits by time range (in ms)
   */
  private filterDepositsByTimeRange(
    deposits: DepositHistory[],
    startMs: number,
    endMs: number,
  ): SettlementDeposit[] {
    return deposits
      .filter((d) => {
        const ts = d.createdAt.getTime();
        return ts >= startMs && ts < endMs;
      })
      .map((d) => ({
        account: d.userId,
        amount: d.amount,
      }));
  }

  /**
   * Filter withdrawals by time range (in ms)
   */
  private filterWithdrawalsByTimeRange(
    withdrawals: WithdrawalHistory[],
    startMs: number,
    endMs: number,
  ): SettlementWithdrawal[] {
    return withdrawals
      .filter((w) => {
        const ts = w.createdAt.getTime();
        return ts >= startMs && ts < endMs;
      })
      .map((w) => ({
        account: w.userId,
        amount: w.amount,
      }));
  }

  /**
   * Filter orders by settled time range (in ms)
   */
  private filterOrdersByTimeRange(
    orders: Order[],
    startMs: number,
    endMs: number,
  ): SettlementItem[] {
    return orders
      .filter((o) => {
        const ts = o.settledAt;
        return ts !== undefined && ts >= startMs && ts < endMs;
      })
      .map((o) => ({
        account: o.userId,
        betId: o.orderId,
        outcome: o.settledWin ? 'WIN' : 'LOSS',
        payout: this.calculatePayout(o),
        originalStake: o.amount,
      }));
  }

  /**
   * Calculate payout for a settled order
   * WIN: stake + reward
   * LOSS: 0
   */
  private calculatePayout(order: Order): string {
    if (!order.settledWin) {
      return '0';
    }
    // Calculate payout: amount + (amount * rewardRate)
    const stake = BigInt(order.amount);
    const rewardRate = BigInt(order.rewardRate);
    // Assuming rewardRate is in basis points or percentage, adjust as needed
    // For now, treat as direct multiplier
    const payout = stake + (stake * rewardRate) / BigInt(10000); // Assuming basis points
    return payout.toString();
  }

  /**
   * Generate batch ID from timestamp
   * Format: batch_YYYY_MM_DD_HH_MM
   */
  private generateBatchId(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    return `batch_${year}_${month}_${day}_${hour}_${minute}`;
  }
}

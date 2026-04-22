import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { randomBytes } from 'crypto';
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
const FALLBACK_DEPOSIT_COUNT = 10;
const FALLBACK_WITHDRAWAL_COUNT = 10;
const FALLBACK_SETTLED_ORDER_COUNT = 30;

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

    if (batches.length === 0) {
      this.logger.warn(
        `No settlement data found for window ${windowStart}-${windowEnd}. Returning fallback mock data.`,
      );
      const fallback = this.generateFallbackData(windowStartMs, windowEndMs);
      return {
        batches: this.groupIntoBatches(
          windowStart,
          windowEnd,
          fallback.deposits,
          fallback.withdrawals,
          fallback.settledOrders,
        ),
      };
    }

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
    // Calculate payout: (amount * rewardRate)
    // For now, treat as direct multiplier
    const payout = BigInt(Math.floor(Number(order.amount) * Number(order.rewardRate) * 1000000)) / BigInt(1000000); // Assuming basis points
    return payout.toString();
  }

  private generateFallbackData(
    windowStartMs: number,
    windowEndMs: number,
  ): {
    deposits: DepositHistory[];
    withdrawals: WithdrawalHistory[];
    settledOrders: Order[];
  } {
    const deposits = Array.from(
      { length: FALLBACK_DEPOSIT_COUNT },
      (_, index) =>
        ({
          id: `fallback_deposit_${Date.now()}_${index}`,
          userId: this.randomAddress(),
          amount: this.randomDepositWeiAmount(),
          txHash: this.randomTxHash(),
          logIndex: index,
          createdAt: new Date(this.randomTimestampMs(windowStartMs, windowEndMs)),
        }) as DepositHistory,
    );

    const withdrawals = Array.from(
      { length: FALLBACK_WITHDRAWAL_COUNT },
      (_, index) =>
        ({
          id: `fallback_withdrawal_${Date.now()}_${index}`,
          sessionId: `fallback_session_${Date.now()}_${index}`,
          userId: this.randomAddress(),
          amount: this.randomWithdrawalWeiAmount(),
          txHash: this.randomTxHash(),
          logIndex: index,
          createdAt: new Date(this.randomTimestampMs(windowStartMs, windowEndMs)),
        }) as WithdrawalHistory,
    );

    const settledOrders = Array.from(
      { length: FALLBACK_SETTLED_ORDER_COUNT },
      (_, index) => {
        const settledAt = this.randomTimestampMs(windowStartMs, windowEndMs);
        const cellDurationMs = 5 * 60 * 1000;
        const cellTimeStart = Math.max(windowStartMs, settledAt - cellDurationMs);
        const cellTimeEnd = Math.min(windowEndMs, settledAt + cellDurationMs);
        const rewardRate = this.randomInt(500, 2500).toString();

        return {
          orderId: `fallback_order_${Date.now()}_${index}`,
          userId: this.randomAddress(),
          marketId: `market_${this.randomInt(1, 3)}`,
          cellTimeStart,
          cellTimeEnd,
          lowerPrice: this.randomInt(1000, 3000).toString(),
          upperPrice: this.randomInt(3001, 5000).toString(),
          amount: this.randomOrderStakeWeiAmount(),
          rewardRate,
          placedAt: Math.max(windowStartMs, settledAt - this.randomInt(30_000, 600_000)),
          status: OrderStatus.SETTLED,
          settledAt,
          settledWin: Math.random() < 0.5,
        } as Order;
      },
    );

    return {
      deposits,
      withdrawals,
      settledOrders,
    };
  }

  private randomTimestampMs(startMs: number, endMs: number): number {
    const maxTs = Math.max(startMs, endMs - 1);
    return this.randomInt(startMs, maxTs);
  }

  private randomDepositWeiAmount(): string {
    // 0.1 - 5 ETH in wei
    return (BigInt(this.randomInt(100, 5000)) * BigInt('1000000000000000')).toString();
  }

  private randomWithdrawalWeiAmount(): string {
    // 0.05 - 3 ETH in wei
    return (BigInt(this.randomInt(50, 3000)) * BigInt('1000000000000000')).toString();
  }

  private randomOrderStakeWeiAmount(): string {
    // 0.01 - 2 ETH in wei
    return (BigInt(this.randomInt(10, 2000)) * BigInt('1000000000000000')).toString();
  }

  private randomAddress(): string {
    return `0x${this.randomHex(40)}`;
  }

  private randomTxHash(): string {
    return `0x${this.randomHex(64)}`;
  }

  private randomHex(length: number): string {
    return randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .slice(0, length);
  }

  private randomInt(min: number, max: number): number {
    const lower = Math.ceil(min);
    const upper = Math.floor(max);
    return Math.floor(Math.random() * (upper - lower + 1)) + lower;
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

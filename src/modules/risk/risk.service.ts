import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LedgerSnapshot } from '../account/entities/ledger-snapshot.entity';
import { LiabilityResponse } from './risk.controller';

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    @InjectRepository(LedgerSnapshot)
    private readonly ledgerSnapshotRepository: Repository<LedgerSnapshot>,
  ) {}

  /**
   * Get liability data for pool solvency
   * - totalLiability: Sum of all user balances (free + locked)
   * - Other fields: Fixed values as per spec
   */
  async getLiabilityData(): Promise<LiabilityResponse> {
    this.logger.debug('Calculating liability data');

    // Calculate total liability from all user balances
    const totalLiability = await this.calculateTotalLiability();

    // Fixed values as per spec
    const utilizationBps = 500; // 5% in basis points
    const maxSingleBetExposure = '1000000000000000000000'; // 1000 tokens in wei
    const outstandingBets = 150;

    const now = Math.floor(Date.now() / 1000);

    return {
      timestamp: now,
      totalLiability: totalLiability.toString(),
      utilizationBps,
      maxSingleBetExposure,
      outstandingBets,
      breakdown: {
        byBand: [],
        byTimeWindow: [],
      },
    };
  }

  /**
   * Calculate total liability = sum of all user balances (free + locked)
   * Get the latest snapshot for each user using DISTINCT ON
   */
  private async calculateTotalLiability(): Promise<bigint> {
    // Use DISTINCT ON to get the latest snapshot for each user
    // Ordered by createdAt DESC to get newest first
    const latestSnapshots = await this.ledgerSnapshotRepository
      .createQueryBuilder('snapshot')
      .distinctOn(['snapshot.userId'])
      .orderBy('snapshot.userId', 'ASC')
      .addOrderBy('snapshot.createdAt', 'DESC')
      .getMany();

    if (latestSnapshots.length === 0) {
      this.logger.debug('No ledger snapshots found, returning 0');
      return BigInt(0);
    }

    // Sum all user balances
    let totalLiability = 0;

    for (const snapshot of latestSnapshots) {
      if (snapshot.balanceAfter) {
        // Sum free + locked (exclude freeTap as it's separate)
        const free = Number(snapshot.balanceAfter.free || '0');
        const locked = Number(snapshot.balanceAfter.locked || '0');
        const userTotal = free + locked;
        totalLiability += userTotal;

        this.logger.debug(
          `User ${snapshot.userId}: free=${free}, locked=${locked}, total=${userTotal}`,
        );
      }
    }

    this.logger.log(`Total liability calculated: ${totalLiability.toString()}`);

    return BigInt(Math.floor(totalLiability));
  }
}

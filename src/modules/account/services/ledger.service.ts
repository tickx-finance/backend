import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { LedgerEntry } from '../entities/ledger-entry.entity';
import { EconomicEventType, BalanceDelta, snapshotApplyDelta, BalanceSnapshot } from '../types';
import { LedgerSnapshot } from '../entities/ledger-snapshot.entity';
import { uuidv7 } from 'uuidv7';

@Injectable()
export class LedgerService {
    private readonly logger = new Logger(LedgerService.name);

    constructor(
        @InjectRepository(LedgerEntry)
        private readonly entryRepo: Repository<LedgerEntry>,
        @InjectRepository(LedgerSnapshot)
        private readonly snapshotRepo: Repository<LedgerSnapshot>,
    ) { }

    async append(
        userId: string,
        eventType: EconomicEventType,
        economicKey: string,
        deltas: BalanceDelta,
    ): Promise<LedgerEntry> {
        const result = await this.entryRepo
            .createQueryBuilder()
            .insert()
            .into(LedgerEntry)
            .values({
                id: uuidv7(),
                userId,
                eventType,
                economicKey,
                deltas,
            })
            .returning('*') // Tells Postgres to return the row it just created
            .execute();

        return result.generatedMaps[0] as LedgerEntry;
    }

    async getEntry(userId: string, economicKey: string): Promise<LedgerEntry> {
        return await this.entryRepo.findOneByOrFail({ userId, economicKey });
    }

    async buildNextSnapshot(userId: string): Promise<LedgerSnapshot> {
        let lastLedgerSnapshot: LedgerSnapshot = await this.snapshotRepo.findOne({
            where: { userId },
            order: { ledgerSeq: 'DESC' },
        });

        let lastBalanceSnapshot: BalanceSnapshot;

        if (lastLedgerSnapshot) {
            lastBalanceSnapshot = lastLedgerSnapshot.balanceAfter;
        } else {
            lastBalanceSnapshot = {
                free: '0',
                freeTap: '0',
                locked: '0',
            };
        }

        const where: any = { userId };

        if (lastLedgerSnapshot) {
            where.id = MoreThan(lastLedgerSnapshot.ledgerSeq);
        }

        const allEntriesAfterLast = await this.entryRepo.find({
            where,
            order: { id: 'ASC' },
        });

        if (!allEntriesAfterLast.length) {
            return {
                id: 0,
                userId,
                ledgerSeq: '0',
                balanceAfter: lastBalanceSnapshot,
                createdAt: new Date(),
            };
        }

        let balanceSnapshot = lastBalanceSnapshot;
        for (const entry of allEntriesAfterLast) {
            balanceSnapshot = snapshotApplyDelta(balanceSnapshot, entry.deltas);
        }

        const snapshot = this.snapshotRepo.create({
            userId,
            ledgerSeq: allEntriesAfterLast[allEntriesAfterLast.length - 1].id,
            balanceAfter: balanceSnapshot,
        });
        return await this.snapshotRepo.save(snapshot);
    }
}

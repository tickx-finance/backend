import { Entity, Column, CreateDateColumn, Index, Unique, PrimaryGeneratedColumn } from 'typeorm';
import { BalanceSnapshot } from '../types';

@Entity('ledger_snapshots')
@Unique(['userId', 'ledgerSeq'])
export class LedgerSnapshot {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    @Index()
    userId: string;

    @Column({ type: 'uuid' }) // should be ledger entry id (bigint)
    ledgerSeq: string;

    @Column({ type: 'jsonb' })
    balanceAfter: BalanceSnapshot;

    @CreateDateColumn()
    createdAt: Date;
}

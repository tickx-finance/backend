import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index, Unique } from 'typeorm';
import { EconomicEventType, BalanceDelta } from '../types';

@Entity('ledger_entries')
@Unique(['userId', 'economicKey'])
export class LedgerEntry {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string;

    @Column()
    @Index()
    userId: string;

    @Column({
        type: 'enum',
        enum: EconomicEventType,
    })
    eventType: EconomicEventType;

    @Column()
    economicKey: string; // Serialized EconomicKey or Composite String

    @Column({ type: 'jsonb' })
    deltas: BalanceDelta;

    @CreateDateColumn()
    createdAt: Date;
}

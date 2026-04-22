import { Entity, Column, CreateDateColumn, Index, PrimaryColumn } from 'typeorm';
import { EconomicEventType, BalanceDelta } from '../types';
import { uuidv7 } from 'uuidv7';

@Entity('ledger_entries')
export class LedgerEntry {
    @PrimaryColumn({ type: 'uuid' })
    id: string;

    @Column()
    @Index()
    userId: string;

    @Column({
        type: 'enum',
        enum: EconomicEventType,
    })
    eventType: EconomicEventType;

    @Column({ unique: true, type: 'varchar', length: 255 })
    economicKey: string; // Serialized EconomicKey or Composite String

    @Column({ type: 'jsonb' })
    deltas: BalanceDelta;

    @CreateDateColumn()
    createdAt: Date;

    constructor() {
        // Automatically assign a UUID v7 on instantiation
        this.id = uuidv7();
    }
}

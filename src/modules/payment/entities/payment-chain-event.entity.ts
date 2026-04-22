import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum PaymentChainEventName {
    TRADER_DEPOSITED = 'TraderDeposited',
    TRADER_WITHDRAWN = 'TraderWithdrawn',
    TRADER_CLAIMED = 'TraderClaimed',
}

export enum PaymentChainLedgerStatus {
    PENDING = 'PENDING',
    APPLIED = 'APPLIED',
    AUDIT_ONLY = 'AUDIT_ONLY',
    FAILED = 'FAILED',
}

@Entity('payment_chain_events')
@Unique(['txHash', 'logIndex'])
export class PaymentChainEvent {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    chainId: string;

    @Column()
    @Index()
    contractAddress: string;

    @Column()
    @Index()
    eventName: PaymentChainEventName;

    @Column()
    @Index()
    trader: string;

    @Column({ type: 'decimal', precision: 78, scale: 0 })
    amount: string;

    @Column()
    txHash: string;

    @Column('int')
    logIndex: number;

    @Column({ type: 'bigint' })
    blockNumber: string;

    @Column()
    blockHash: string;

    @Column({ type: 'jsonb', default: {} })
    rawArgs: Record<string, string>;

    @Column({ default: false })
    appliedToLedger: boolean;

    @Column({
        type: 'enum',
        enum: PaymentChainLedgerStatus,
        default: PaymentChainLedgerStatus.PENDING,
    })
    @Index()
    ledgerStatus: PaymentChainLedgerStatus;

    @Column({ type: 'text', nullable: true })
    ledgerError: string | null;

    @Column({ type: 'timestamp', nullable: true })
    processedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;
}

export enum WithdrawalStatus {
    OPEN = 'OPEN',
    SUCCESS = 'SUCCESS',
    EXPIRED = 'EXPIRED',
}

import { Entity, Column, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('withdrawal_sessions')
export class WithdrawalSession {
    @PrimaryColumn('uuid')
    sessionId: string;

    @Column()
    @Index()
    userId: string;

    @Column('decimal', { precision: 30, scale: 9 })
    amount: string;

    @Column({
        type: 'enum',
        enum: WithdrawalStatus,
        default: WithdrawalStatus.OPEN
    })
    status: WithdrawalStatus;

    @Column({ type: 'text', nullable: true })
    txHash: string | null;

    @Column({ type: 'text', nullable: true })
    approvalSignature: string | null;

    @Column({ type: 'bigint', nullable: true })
    deadline: string | null;

    @Column({ type: 'bigint', nullable: true })
    nonce: string | null;

    @Column({ type: 'text', nullable: true })
    reservePoolAddress: string | null;

    @Column({ type: 'text', nullable: true })
    quoteAssetAddress: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @Column({ type: 'timestamp' })
    expiresAt: Date;
}

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('deposit_history')
@Unique(['txHash', 'logIndex'])
export class DepositHistory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    userId: string;

    @Column('decimal', { precision: 30, scale: 9 })
    amount: string;

    @Column()
    txHash: string;

    @Column('int')
    logIndex: number;

    @Column({ type: 'bigint', nullable: true })
    blockNumber?: string | null;

    @Column({ nullable: true })
    blockHash?: string | null;

    @Column({ nullable: true })
    contractAddress?: string | null;

    @Column({ nullable: true })
    chainId?: string | null;

    @CreateDateColumn()
    createdAt: Date;
}

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('deposit_history')
@Unique(['txHash', 'logIndex'])
export class DepositHistory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    userId: string;

    @Column('decimal', { precision: 20, scale: 0 })
    amount: string;

    @Column()
    txHash: string;

    @Column('int')
    logIndex: number;

    @CreateDateColumn()
    createdAt: Date;
}

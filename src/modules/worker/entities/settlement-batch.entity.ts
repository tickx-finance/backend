import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('settlement_batches')
@Unique(['transactionHash', 'logIndex'])
export class SettlementBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  transactionHash: string;

  @Column()
  @Index()
  contractAddress: string;

  @Column()
  @Index()
  blockNumber: number;

  @Column()
  blockTimestamp: number;

  @Column()
  logIndex: number;

  @Column({ type: 'varchar' })
  @Index()
  batchId: string;

  @Column({ type: 'varchar' })
  merkleRoot: string;

  @Column({ type: 'varchar' })
  totalPayout: string;

  @Column({ type: 'varchar' })
  withdrawableCap: string;

  @Column({ type: 'varchar' })
  windowStart: string;

  @Column({ type: 'varchar' })
  windowEnd: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

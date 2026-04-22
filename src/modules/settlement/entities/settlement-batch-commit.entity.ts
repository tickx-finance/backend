import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Entity to store settlement batch commit records
 * Tracks when a batch is committed on-chain
 */
@Entity('settlement_batch_commits')
@Index(['committedAt'])
export class SettlementBatchCommit {
  @PrimaryColumn()
  batchId: string;

  @Column()
  txHash: string;

  @Column()
  merkleRoot: string;

  @Column({
    type: 'bigint',
  })
  committedAt: number;

  @CreateDateColumn()
  createdAt: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('price_integrity_batches')
@Unique(['transactionHash', 'logIndex'])
export class PriceIntegrityBatch {
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
  epochId: string;

  @Column({ type: 'varchar' })
  windowStart: string;

  @Column({ type: 'varchar' })
  candleCount: string;

  @Column({ type: 'varchar' })
  internalCandlesHash: string;

  @Column({ type: 'varchar' })
  chainlinkCandlesHash: string;

  @Column({ type: 'varchar' })
  ohlcMaeBps: string;

  @Column({ type: 'varchar' })
  ohlcP95Bps: string;

  @Column({ type: 'varchar' })
  ohlcMaxBps: string;

  @Column({ type: 'varchar' })
  directionMatchBps: string;

  @Column({ type: 'varchar' })
  outlierCount: string;

  @Column({ type: 'varchar' })
  scoreBps: string;

  @Column({ type: 'varchar' })
  diffMerkleRoot: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

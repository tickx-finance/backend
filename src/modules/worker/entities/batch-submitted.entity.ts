import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('batch_submitted')
@Unique(['transactionHash', 'logIndex'])
export class BatchSubmitted {
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
  scoreBps: string;

  @Column({ type: 'varchar' })
  ohlcP95Bps: string;

  @Column()
  isPassed: boolean;

  @Column({ type: 'smallint' })
  failureFlags: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

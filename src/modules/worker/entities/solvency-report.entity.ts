import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('solvency_reports')
@Unique(['transactionHash', 'logIndex'])
export class SolvencyReport {
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
  poolBalance: string;

  @Column({ type: 'varchar' })
  totalLiability: string;

  @Column({ type: 'varchar' })
  utilizationBps: string;

  @Column({ type: 'varchar' })
  maxSingleBetExposure: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

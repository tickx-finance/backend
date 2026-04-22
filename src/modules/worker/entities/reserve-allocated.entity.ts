import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('reserve_allocated')
@Unique(['transactionHash', 'logIndex'])
export class ReserveAllocated {
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
  amount: string;

  @Column({ type: 'varchar' })
  @Index()
  receiver: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

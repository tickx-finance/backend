import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('workflow_id_updates')
@Unique(['transactionHash', 'logIndex'])
export class WorkflowIdUpdate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'transaction_hash' })
  @Index()
  transactionHash: string;

  @Column({ name: 'contract_address' })
  @Index()
  contractAddress: string;

  @Column({ name: 'block_number' })
  @Index()
  blockNumber: number;

  @Column({ name: 'block_timestamp' })
  blockTimestamp: number;

  @Column({ name: 'log_index' })
  logIndex: number;

  @Column({ name: 'previous_id', type: 'varchar' })
  previousId: string;

  @Column({ name: 'new_id', type: 'varchar' })
  newId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

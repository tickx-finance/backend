import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity('payment_chain_cursors')
@Unique(['chainId', 'contractAddress'])
export class PaymentChainCursor {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    chainId: string;

    @Column()
    contractAddress: string;

    @Column({ type: 'bigint' })
    lastProcessedBlock: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

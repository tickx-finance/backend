import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';

@Entity('miniapp_nonces')
@Unique(['nonce'])
export class MiniAppNonce {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'text' })
    nonce: string;

    @CreateDateColumn()
    createdAt: Date;
}

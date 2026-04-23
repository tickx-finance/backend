import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from 'typeorm';

export enum AuthType {
    WALLET = 'wallet',
    MINIAPP = 'miniapp',
}

@Entity('user_auth_profiles')
@Unique(['address'])
export class UserAuthProfile {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    address: string;

    @Column({
        type: 'enum',
        enum: AuthType,
        default: AuthType.WALLET,
    })
    lastAuthType: AuthType;

    @Column({ nullable: true })
    miniAppUserId: string | null;

    @Column({ default: false })
    humanVerified: boolean;

    @Column({ type: 'timestamp', nullable: true })
    humanVerifiedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    humanVerificationSource: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

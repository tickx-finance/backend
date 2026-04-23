import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from 'typeorm';

export enum OrderFollowSubscriptionStatus {
    ACTIVE = 'ACTIVE',
    PAUSED = 'PAUSED',
    REVOKED = 'REVOKED',
    EXPIRED = 'EXPIRED',
}

export enum OrderFollowEligibilityStatus {
    FREE = 'FREE',
    ELIGIBLE = 'ELIGIBLE',
    INELIGIBLE = 'INELIGIBLE',
}

export enum OrderFollowSubscriptionSource {
    FREE_REGISTRATION = 'FREE_REGISTRATION',
    PAID_ACCESS = 'PAID_ACCESS',
    ADMIN_GRANT = 'ADMIN_GRANT',
}

@Entity('order_follow_subscriptions')
@Unique(['subscriberUserId', 'targetUserId'])
@Index(['targetUserId', 'status', 'eligibilityStatus'])
@Index(['subscriberUserId', 'status'])
export class OrderFollowSubscription {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    subscriberUserId: string;

    @Column()
    targetUserId: string;

    @Column({
        type: 'enum',
        enum: OrderFollowSubscriptionStatus,
        default: OrderFollowSubscriptionStatus.ACTIVE,
    })
    status: OrderFollowSubscriptionStatus;

    @Column({
        type: 'enum',
        enum: OrderFollowEligibilityStatus,
        default: OrderFollowEligibilityStatus.FREE,
    })
    eligibilityStatus: OrderFollowEligibilityStatus;

    @Column({ type: 'text', nullable: true })
    eligibilityReason: string | null;

    @Column({
        type: 'enum',
        enum: OrderFollowSubscriptionSource,
        default: OrderFollowSubscriptionSource.FREE_REGISTRATION,
    })
    source: OrderFollowSubscriptionSource;

    @Column({ type: 'timestamp', nullable: true })
    expiresAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

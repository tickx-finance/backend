import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    OrderFollowEligibilityStatus,
    OrderFollowSubscription,
    OrderFollowSubscriptionStatus,
} from './entities/order-follow-subscription.entity';
import { OrderFollowEligibilityService } from './order-follow-eligibility.service';

@Injectable()
export class OrderFollowService {
    constructor(
        @InjectRepository(OrderFollowSubscription)
        private readonly subscriptionRepo: Repository<OrderFollowSubscription>,
        private readonly eligibilityService: OrderFollowEligibilityService,
    ) { }

    async register(
        subscriberUserId: string,
        targetUserId: string,
    ): Promise<OrderFollowSubscription> {
        if (subscriberUserId === targetUserId) {
            throw new BadRequestException('Cannot follow self');
        }

        const decision = await this.eligibilityService.assertCanSubscribe(
            subscriberUserId,
            targetUserId,
        );
        if (!decision.eligible) {
            throw new BadRequestException(decision.reason);
        }

        const existing = await this.subscriptionRepo.findOne({
            where: { subscriberUserId, targetUserId },
        });

        if (existing) {
            existing.status = OrderFollowSubscriptionStatus.ACTIVE;
            existing.eligibilityStatus = decision.status;
            existing.eligibilityReason = decision.reason;
            existing.source = decision.source;
            existing.expiresAt = decision.expiresAt;
            return this.subscriptionRepo.save(existing);
        }

        try {
            const subscription = this.subscriptionRepo.create({
                subscriberUserId,
                targetUserId,
                status: OrderFollowSubscriptionStatus.ACTIVE,
                eligibilityStatus: decision.status,
                eligibilityReason: decision.reason,
                source: decision.source,
                expiresAt: decision.expiresAt,
            });
            return await this.subscriptionRepo.save(subscription);
        } catch (error: any) {
            if (error.code !== '23505') {
                throw error;
            }

            const raced = await this.subscriptionRepo.findOneOrFail({
                where: { subscriberUserId, targetUserId },
            });
            raced.status = OrderFollowSubscriptionStatus.ACTIVE;
            raced.eligibilityStatus = decision.status;
            raced.eligibilityReason = decision.reason;
            raced.source = decision.source;
            raced.expiresAt = decision.expiresAt;
            return this.subscriptionRepo.save(raced);
        }
    }

    async unsubscribe(
        subscriberUserId: string,
        targetUserId: string,
    ): Promise<OrderFollowSubscription | null> {
        const existing = await this.subscriptionRepo.findOne({
            where: { subscriberUserId, targetUserId },
        });
        if (!existing) {
            return null;
        }

        existing.status = OrderFollowSubscriptionStatus.REVOKED;
        return this.subscriptionRepo.save(existing);
    }

    async listFollowing(subscriberUserId: string): Promise<OrderFollowSubscription[]> {
        return this.subscriptionRepo.find({
            where: [
                {
                    subscriberUserId,
                    status: OrderFollowSubscriptionStatus.ACTIVE,
                    eligibilityStatus: OrderFollowEligibilityStatus.FREE,
                },
                {
                    subscriberUserId,
                    status: OrderFollowSubscriptionStatus.ACTIVE,
                    eligibilityStatus: OrderFollowEligibilityStatus.ELIGIBLE,
                },
            ],
            order: { createdAt: 'DESC' },
        });
    }

    async listFollowers(targetUserId: string): Promise<OrderFollowSubscription[]> {
        return this.subscriptionRepo.find({
            where: {
                targetUserId,
                status: OrderFollowSubscriptionStatus.ACTIVE,
            },
            order: { createdAt: 'DESC' },
        });
    }

    async getActiveSubscriberIds(targetUserId: string): Promise<string[]> {
        const subscriptions = await this.subscriptionRepo.find({
            select: { subscriberUserId: true },
            where: [
                {
                    targetUserId,
                    status: OrderFollowSubscriptionStatus.ACTIVE,
                    eligibilityStatus: OrderFollowEligibilityStatus.FREE,
                },
                {
                    targetUserId,
                    status: OrderFollowSubscriptionStatus.ACTIVE,
                    eligibilityStatus: OrderFollowEligibilityStatus.ELIGIBLE,
                },
            ],
        });
        return subscriptions.map((subscription) => subscription.subscriberUserId);
    }

    async getActiveFollowTargetIds(subscriberUserId: string): Promise<string[]> {
        const subscriptions = await this.listFollowing(subscriberUserId);
        return subscriptions.map((subscription) => subscription.targetUserId);
    }

    async canListenToTarget(
        subscriberUserId: string,
        targetUserId: string,
    ): Promise<boolean> {
        const subscription = await this.subscriptionRepo.findOne({
            where: [
                {
                    subscriberUserId,
                    targetUserId,
                    status: OrderFollowSubscriptionStatus.ACTIVE,
                    eligibilityStatus: OrderFollowEligibilityStatus.FREE,
                },
                {
                    subscriberUserId,
                    targetUserId,
                    status: OrderFollowSubscriptionStatus.ACTIVE,
                    eligibilityStatus: OrderFollowEligibilityStatus.ELIGIBLE,
                },
            ],
        });
        return !!subscription;
    }
}

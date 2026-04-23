import { Injectable } from '@nestjs/common';
import {
    OrderFollowEligibilityStatus,
    OrderFollowSubscriptionSource,
} from './entities/order-follow-subscription.entity';

export interface OrderFollowEligibilityDecision {
    eligible: boolean;
    status: OrderFollowEligibilityStatus;
    source: OrderFollowSubscriptionSource;
    reason: string;
    expiresAt: Date | null;
}

@Injectable()
export class OrderFollowEligibilityService {
    async assertCanSubscribe(
        subscriberUserId: string,
        targetUserId: string,
    ): Promise<OrderFollowEligibilityDecision> {
        return {
            eligible: true,
            status: OrderFollowEligibilityStatus.FREE,
            source: OrderFollowSubscriptionSource.FREE_REGISTRATION,
            reason: 'free_registration',
            expiresAt: null,
        };
    }
}

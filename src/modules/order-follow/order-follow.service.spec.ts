import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
    OrderFollowEligibilityStatus,
    OrderFollowSubscriptionSource,
    OrderFollowSubscriptionStatus,
} from './entities/order-follow-subscription.entity';
import { OrderFollowService } from './order-follow.service';

describe('OrderFollowService', () => {
    it('creates a free active subscription', async () => {
        const harness = makeHarness();

        const subscription = await harness.service.register('user-a', 'user-b');

        expect(subscription).toMatchObject({
            subscriberUserId: 'user-a',
            targetUserId: 'user-b',
            status: OrderFollowSubscriptionStatus.ACTIVE,
            eligibilityStatus: OrderFollowEligibilityStatus.FREE,
            source: OrderFollowSubscriptionSource.FREE_REGISTRATION,
        });
        expect(harness.repo.save).toHaveBeenCalledTimes(1);
    });

    it('reactivates duplicate registration idempotently', async () => {
        const existing = {
            id: 'sub-1',
            subscriberUserId: 'user-a',
            targetUserId: 'user-b',
            status: OrderFollowSubscriptionStatus.REVOKED,
            eligibilityStatus: OrderFollowEligibilityStatus.INELIGIBLE,
            eligibilityReason: 'old',
            source: OrderFollowSubscriptionSource.PAID_ACCESS,
            expiresAt: new Date(),
        };
        const harness = makeHarness({ existing });

        const subscription = await harness.service.register('user-a', 'user-b');

        expect(subscription).toMatchObject({
            id: 'sub-1',
            status: OrderFollowSubscriptionStatus.ACTIVE,
            eligibilityStatus: OrderFollowEligibilityStatus.FREE,
            eligibilityReason: 'free_registration',
            source: OrderFollowSubscriptionSource.FREE_REGISTRATION,
            expiresAt: null,
        });
    });

    it('unsubscribes by marking the subscription revoked', async () => {
        const existing = {
            id: 'sub-1',
            subscriberUserId: 'user-a',
            targetUserId: 'user-b',
            status: OrderFollowSubscriptionStatus.ACTIVE,
        };
        const harness = makeHarness({ existing });

        const subscription = await harness.service.unsubscribe('user-a', 'user-b');

        expect(subscription).toMatchObject({
            id: 'sub-1',
            status: OrderFollowSubscriptionStatus.REVOKED,
        });
    });

    it('rejects self-follow', async () => {
        const harness = makeHarness();

        await expect(harness.service.register('user-a', 'user-a'))
            .rejects
            .toBeInstanceOf(BadRequestException);
    });

    it('returns active eligible subscribers for a target', async () => {
        const harness = makeHarness({
            findResult: [
                { subscriberUserId: 'user-a' },
                { subscriberUserId: 'user-c' },
            ],
        });

        await expect(harness.service.getActiveSubscriberIds('user-b'))
            .resolves
            .toEqual(['user-a', 'user-c']);
    });

    it('returns active eligible target ids for a subscriber', async () => {
        const harness = makeHarness({
            findResult: [
                { targetUserId: 'user-b' },
                { targetUserId: 'user-c' },
            ],
        });

        await expect(harness.service.getActiveFollowTargetIds('user-a'))
            .resolves
            .toEqual(['user-b', 'user-c']);
    });

    it('checks whether a subscriber can listen to a single target', async () => {
        const harness = makeHarness({ existing: { id: 'sub-1' } });

        await expect(harness.service.canListenToTarget('user-a', 'user-b'))
            .resolves
            .toBe(true);
    });

    it('returns false when a subscriber cannot listen to a single target', async () => {
        const harness = makeHarness();

        await expect(harness.service.canListenToTarget('user-a', 'user-b'))
            .resolves
            .toBe(false);
    });
});

function makeHarness(options: {
    existing?: any;
    findResult?: any[];
} = {}) {
    const repo = {
        findOne: vi.fn().mockResolvedValue(options.existing ?? null),
        findOneOrFail: vi.fn().mockResolvedValue(options.existing),
        create: vi.fn().mockImplementation((entity) => entity),
        save: vi.fn().mockImplementation(async (entity) => entity),
        find: vi.fn().mockResolvedValue(options.findResult ?? []),
    };
    const eligibility = {
        assertCanSubscribe: vi.fn().mockResolvedValue({
            eligible: true,
            status: OrderFollowEligibilityStatus.FREE,
            source: OrderFollowSubscriptionSource.FREE_REGISTRATION,
            reason: 'free_registration',
            expiresAt: null,
        }),
    };

    return {
        repo,
        eligibility,
        service: new OrderFollowService(repo as any, eligibility as any),
    };
}

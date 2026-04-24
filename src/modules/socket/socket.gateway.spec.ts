import { describe, expect, it, vi } from 'vitest';
import { getOrderFollowTargetRoom, getSuggestedStrategyRoom } from './types';
import { SocketGateway } from './socket.gateway';

describe('SocketGateway order follow subscriptions', () => {
    it('joins the requested target order-follow room after wss auth and eligibility check', async () => {
        const harness = makeHarness({ authResult: true, canListen: true });

        await harness.gateway.handleSubscribeOrderFollows(harness.client as any, {
            userId: 'user-a',
            targetUserId: 'user-b',
            signature: 'sig',
        });

        expect(harness.auth.validateWssSignature).toHaveBeenCalledWith('user-a', 'user-a', 'sig', true);
        expect(harness.orderFollowService.canListenToTarget).toHaveBeenCalledWith('user-a', 'user-b');
        expect(harness.client.join).toHaveBeenCalledWith(getOrderFollowTargetRoom('user-b'));
        expect(harness.client.emit).toHaveBeenCalledWith('subscribed', {
            room: getOrderFollowTargetRoom('user-b'),
            status: 'success',
        });
    });

    it('rejects order-follow room subscription when wss auth fails', async () => {
        const harness = makeHarness({ authResult: false });

        await harness.gateway.handleSubscribeOrderFollows(harness.client as any, {
            userId: 'user-a',
            targetUserId: 'user-b',
            signature: 'bad',
        });

        expect(harness.client.join).not.toHaveBeenCalled();
        expect(harness.orderFollowService.canListenToTarget).not.toHaveBeenCalled();
        expect(harness.client.send).toHaveBeenCalledWith('Invalid wss signature');
    });

    it('rejects order-follow room subscription when the target is not active or eligible', async () => {
        const harness = makeHarness({ authResult: true, canListen: false });

        await harness.gateway.handleSubscribeOrderFollows(harness.client as any, {
            userId: 'user-a',
            targetUserId: 'user-b',
            signature: 'sig',
        });

        expect(harness.client.join).not.toHaveBeenCalled();
        expect(harness.client.send).toHaveBeenCalledWith('Order follow subscription is not active or eligible');
    });

    it('leaves the requested target order-follow room after wss auth and eligibility check', async () => {
        const harness = makeHarness({ authResult: true, canListen: true });

        await harness.gateway.handleUnsubscribeOrderFollows(harness.client as any, {
            userId: 'user-a',
            targetUserId: 'user-b',
            signature: 'sig',
        });

        expect(harness.client.leave).toHaveBeenCalledWith(getOrderFollowTargetRoom('user-b'));
        expect(harness.client.emit).toHaveBeenCalledWith('unsubscribed', {
            room: getOrderFollowTargetRoom('user-b'),
            status: 'success',
        });
    });
});

describe('SocketGateway place bet auth hardening', () => {
    it('rejects invalid wss signature without placing order', async () => {
        const harness = makeHarness({ authResult: false });

        await harness.gateway.handlePlaceBet(harness.client as any, {
            userId: 'demo-user',
            marketId: 'BTCUSDT',
            amount: '10',
            userSignature: 'bad',
            cell: {
                gridTs: 1,
                startTs: 2,
                endTs: 3,
                lowerPrice: '1.0000',
                upperPrice: '2.0000',
                rewardRate: '2',
                gridSignature: 'cell-sig',
            },
        });

        expect(harness.orderService.placeOrder).not.toHaveBeenCalled();
        expect(harness.client.send).toHaveBeenCalledWith('Invalid wss signature');
    });
});

describe('SocketGateway suggested strategy subscriptions', () => {
    it('joins the shared suggested strategy room', async () => {
        const harness = makeHarness({ authResult: true });

        await harness.gateway.handleSubscribeSuggestedStrategy(harness.client as any);

        expect(harness.client.join).toHaveBeenCalledWith(getSuggestedStrategyRoom());
        expect(harness.client.emit).toHaveBeenCalledWith('subscribed', {
            room: getSuggestedStrategyRoom(),
            status: 'success',
        });
    });

    it('leaves the shared suggested strategy room', async () => {
        const harness = makeHarness({ authResult: true });

        await harness.gateway.handleUnsubscribeSuggestedStrategy(harness.client as any);

        expect(harness.client.leave).toHaveBeenCalledWith(getSuggestedStrategyRoom());
        expect(harness.client.emit).toHaveBeenCalledWith('unsubscribed', {
            room: getSuggestedStrategyRoom(),
            status: 'success',
        });
    });
});

function makeHarness(options: { authResult: boolean; canListen?: boolean }) {
    const auth = {
        validateWssSignature: vi.fn().mockResolvedValue(options.authResult),
    };
    const orderService = {
        placeOrder: vi.fn(),
    };
    const client = {
        id: 'socket-1',
        join: vi.fn(),
        leave: vi.fn(),
        emit: vi.fn(),
        send: vi.fn(),
    };
    const orderFollowService = {
        canListenToTarget: vi.fn().mockResolvedValue(options.canListen ?? true),
    };

    return {
        auth,
        orderService,
        orderFollowService,
        client,
        gateway: new SocketGateway(auth as any, orderService as any, orderFollowService as any),
    };
}

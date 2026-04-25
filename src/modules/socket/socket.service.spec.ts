import { describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '../order/types';
import { SocketService, toFollowedOrderUpdateMessage } from './socket.service';
import { EventName, getOrderFollowTargetRoom, getSuggestedStrategyRoom, getUserRoom, OrderUpdateMessage } from './types';

describe('SocketService order update fanout', () => {
    it('emits private order update and followed order update to target broadcast room', async () => {
        const service = new SocketService();
        const server = makeServer();
        service.server = server as any;
        const msg = makeOrderUpdate();

        await service.emitOrderUpdate(msg);

        expect(server.to).toHaveBeenNthCalledWith(1, getUserRoom('user-b'));
        expect(server.emitters[0].emit).toHaveBeenCalledWith(EventName.OrderUpdate, msg);
        expect(server.to).toHaveBeenNthCalledWith(2, getOrderFollowTargetRoom('user-b'));
        expect(server.emitters[1].emit).toHaveBeenCalledWith(
            EventName.FollowedOrderUpdate,
            toFollowedOrderUpdateMessage(msg),
        );
    });

    it('maps owner order update into follower-safe shape', () => {
        expect(toFollowedOrderUpdateMessage(makeOrderUpdate())).toEqual({
            targetUserId: 'user-b',
            orderId: 'order-1',
            marketId: 'BTCUSDT',
            amount: '10',
            cell: { startTs: 1 },
            status: OrderStatus.OPEN,
            settledTimestamp: undefined,
            settledWin: undefined,
            settledPayout: undefined,
            settledBasePayout: undefined,
            settledBonusPayout: undefined,
        });
    });

    it('emits fortress MC diagnostics on a separate event channel', async () => {
        const service = new SocketService();
        const server = {
            emit: vi.fn(),
        };
        service.server = server as any;

        await service.emitFortressMcDiagnostics({
            paths: [[100, 101]],
            pRaw: [[0.5]],
        });

        expect(server.emit).toHaveBeenCalledWith(EventName.FortressMcDiagnostics, expect.objectContaining({
            paths: [[100, 101]],
            pRaw: [[0.5]],
        }));
    });

    it('emits suggested strategy updates to the dedicated room', async () => {
        const service = new SocketService();
        const server = makeServer();
        service.server = server as any;

        await service.emitSuggestedStrategyUpdate({
            cells: [{ startTs: 1 } as any],
            volatilityRegime: 'low',
            sigma: 0.1,
            atrMean: 1,
            timestamp: 1,
        });

        expect(server.to).toHaveBeenNthCalledWith(1, getSuggestedStrategyRoom());
        expect(server.emitters[0].emit).toHaveBeenCalledWith(
            EventName.SuggestedStrategyUpdate,
            expect.objectContaining({
                volatilityRegime: 'low',
            }),
        );
    });
});

function makeServer() {
    const emitters = [
        { emit: vi.fn() },
        { emit: vi.fn() },
        { emit: vi.fn() },
    ];
    return {
        emitters,
        to: vi.fn()
            .mockReturnValueOnce(emitters[0])
            .mockReturnValueOnce(emitters[1])
            .mockReturnValueOnce(emitters[2]),
    };
}

function makeOrderUpdate(): OrderUpdateMessage {
    return {
        orderId: 'order-1',
        userId: 'user-b',
        marketId: 'BTCUSDT',
        amount: '10',
        cell: { startTs: 1 },
        status: OrderStatus.OPEN,
    };
}

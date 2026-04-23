import { describe, expect, it } from 'vitest';
import { Order } from '../order/entities/order.entity';
import { SettlementService } from './settlement.service';

describe('SettlementService', () => {
  it('uses realized settledPayout when present', () => {
    const service = makeService();
    const order = {
      orderId: 'order-1',
      userId: 'user-1',
      amount: '100',
      rewardRate: '2',
      settledAt: 1_000,
      settledWin: true,
      settledPayout: '204',
    } as Order;

    const settlements = (service as any).filterOrdersByTimeRange([order], 0, 2_000);

    expect(settlements).toEqual([
      {
        account: 'user-1',
        betId: 'order-1',
        outcome: 'WIN',
        payout: '204',
        originalStake: '100',
      },
    ]);
  });

  it('falls back to legacy payout formula for historical rows without settledPayout', () => {
    const service = makeService();
    const order = {
      orderId: 'order-legacy',
      userId: 'user-2',
      amount: '100',
      rewardRate: '1.956000',
      settledAt: 1_000,
      settledWin: true,
      settledPayout: null,
    } as Order;

    const settlements = (service as any).filterOrdersByTimeRange([order], 0, 2_000);

    expect(settlements).toEqual([
      {
        account: 'user-2',
        betId: 'order-legacy',
        outcome: 'WIN',
        payout: '195',
        originalStake: '100',
      },
    ]);
  });

  it('keeps loss payout at zero even if no realized payout is stored', () => {
    const service = makeService();
    const order = {
      orderId: 'order-loss',
      userId: 'user-3',
      amount: '100',
      rewardRate: '2',
      settledAt: 1_000,
      settledWin: false,
      settledPayout: null,
    } as Order;

    const settlements = (service as any).filterOrdersByTimeRange([order], 0, 2_000);

    expect(settlements).toEqual([
      {
        account: 'user-3',
        betId: 'order-loss',
        outcome: 'LOSS',
        payout: '0',
        originalStake: '100',
      },
    ]);
  });
});

function makeService(): SettlementService {
  return new SettlementService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

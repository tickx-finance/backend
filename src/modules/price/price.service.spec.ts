import { describe, expect, it, vi } from 'vitest';
import { PriceService } from './price.service';

describe('PriceService synced server timestamps', () => {
  it('returns latest trade with moving synced server timestamp', () => {
    const service = makeService();
    (service as any).latestTrade = {
      price: 100,
      qty: 1,
      tradeId: 10,
      isSell: false,
      ts: 900,
    };
    (service as any).binanceTimeOffsetMs = 25;

    const before = Date.now();
    const trade = service.getLatestTrade();
    const after = Date.now();

    expect(trade?.ts).toBeGreaterThanOrEqual(before + 25);
    expect(trade?.ts).toBeLessThanOrEqual(after + 25);
    expect(trade?.ts).not.toBe(900);
  });
});

function makeService(): PriceService {
  return new PriceService(
    { emitNewPrice: vi.fn() } as any,
    { send: vi.fn() } as any,
    { processPriceTick: vi.fn() } as any,
  );
}

import { describe, expect, it } from 'vitest';
import {
    computeCloseToCloseLogReturn,
    getFortressTimeAnchorSecond,
    GridOracleStateService,
} from './fortress-oracle-state.service';

describe('GridOracleStateService', () => {
    it('aggregates ticks into closed 1s bars and computes close-to-close returns', () => {
        const service = new GridOracleStateService();

        expect(service.ingestTick({ timestampMs: 1710000000100, price: 100 })).toEqual([]);
        expect(service.ingestTick({ timestampMs: 1710000000500, price: 101, volume: 2 })).toEqual([]);

        const firstUpdates = service.ingestTick({ timestampMs: 1710000001100, price: 102, volume: 3 });
        expect(firstUpdates).toHaveLength(1);
        expect(firstUpdates[0]).toMatchObject({
            bar: {
                oracleSecond: 1710000000,
                open: 100,
                high: 101,
                low: 100,
                close: 101,
                volume: 2,
            },
            previousClose: undefined,
            logReturn: 0,
            volatilityObservation: 0,
            timeAnchorSecond: 1710000000,
        });

        const secondUpdates = service.ingestTick({ timestampMs: 1710000002250, price: 99 });
        expect(secondUpdates).toHaveLength(1);
        expect(secondUpdates[0].bar).toMatchObject({
            oracleSecond: 1710000001,
            open: 102,
            high: 102,
            low: 102,
            close: 102,
            volume: 3,
        });
        expect(secondUpdates[0].previousClose).toBe(101);
        expect(secondUpdates[0].logReturn).toBeCloseTo(Math.log(102 / 101), 12);
        expect(secondUpdates[0].volatilityObservation).toBeCloseTo(Math.log(102 / 101) ** 2, 16);
        expect(service.getLastClosedBar()?.oracleSecond).toBe(1710000001);
    });

    it('fills missing seconds with the last close', () => {
        const service = new GridOracleStateService();

        service.ingestTick({ timestampMs: 1710000000100, price: 100 });
        const updates = service.ingestTick({ timestampMs: 1710000003100, price: 105 });

        expect(updates.map((update) => update.bar)).toEqual([
            {
                oracleSecond: 1710000000,
                open: 100,
                high: 100,
                low: 100,
                close: 100,
                volume: 0,
            },
            {
                oracleSecond: 1710000001,
                open: 100,
                high: 100,
                low: 100,
                close: 100,
                volume: 0,
            },
            {
                oracleSecond: 1710000002,
                open: 100,
                high: 100,
                low: 100,
                close: 100,
                volume: 0,
            },
        ]);
        expect(updates.every((update) => update.logReturn === 0)).toBe(true);
    });

    it('deduplicates latest trades by aggregate trade id', () => {
        const service = new GridOracleStateService();

        expect(service.ingestLatestTrade({
            price: 100,
            qty: 1,
            tradeId: 10,
            isSell: false,
            ts: 1710000000100,
        })).toEqual([]);

        expect(service.ingestLatestTrade({
            price: 101,
            qty: 1,
            tradeId: 10,
            isSell: false,
            ts: 1710000001100,
        })).toEqual([]);

        const updates = service.ingestLatestTrade({
            price: 101,
            qty: 1,
            tradeId: 11,
            isSell: false,
            ts: 1710000001100,
        });
        expect(updates).toHaveLength(1);
        expect(updates[0].bar.close).toBe(100);
    });

    it('derives the Fortress five-second anchor', () => {
        expect(getFortressTimeAnchorSecond(1710000000)).toBe(1710000000);
        expect(getFortressTimeAnchorSecond(1710000004)).toBe(1710000000);
        expect(getFortressTimeAnchorSecond(1710000005)).toBe(1710000005);
    });

    it('uses zero return for the first closed bar', () => {
        expect(computeCloseToCloseLogReturn(100)).toBe(0);
        expect(computeCloseToCloseLogReturn(102, 101)).toBeCloseTo(Math.log(102 / 101), 12);
    });
});

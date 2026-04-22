import { describe, expect, it } from 'vitest';
import { signCell } from 'src/libs/cell';
import { FORTRESS_MAIN_MODE } from './fortress.config';
import {
    getFortressGridTsMs,
    mapFortressQuoteToCell,
    mapFortressQuotesToCells,
    secondsToMs,
} from './fortress-cell.mapper';
import { FortressQuote } from './fortress.types';

describe('Fortress cell mapper', () => {
    const privateKey = 'test-cell-signer-key';

    it('keeps principal mode constants aligned with Fortress mode 5', () => {
        expect(FORTRESS_MAIN_MODE.modeId).toBe('5');
        expect(FORTRESS_MAIN_MODE.bandWidth).toBe(5);
        expect(FORTRESS_MAIN_MODE.rowCount).toBe(20);
        expect(FORTRESS_MAIN_MODE.centerRow).toBe(9);
        expect(FORTRESS_MAIN_MODE.windows).toEqual([
            [5, 10],
            [10, 15],
            [15, 20],
            [20, 25],
            [25, 30],
            [30, 35],
            [35, 40],
            [40, 45],
            [45, 50],
            [50, 55],
            [55, 60],
            [60, 65],
        ]);
    });

    it('maps a Fortress quote to the legacy signed Cell shape', () => {
        const quote = quoteFixture({
            windowIndex: 1,
            startSecond: 1710000010,
            endSecond: 1710000015,
            lowerPrice: 99997.5,
            upperPrice: 100002.5,
            mFinal: 2.3456789,
        });

        const cell = mapFortressQuoteToCell(quote, { privateKey });

        expect(cell).toMatchObject({
            gridTs: 1710000000 * 1000,
            startTs: 1710000010 * 1000,
            endTs: 1710000015 * 1000,
            lowerPrice: '99997.5000',
            upperPrice: '100002.5000',
            rewardRate: '2.345679',
        });
        expect(cell.gridSignature).toBe(signCell(cell, privateKey));
    });

    it('maps only betable quotes by default', () => {
        const nonBetable = quoteFixture({ cellId: 1, betable: false });
        const betable = quoteFixture({ cellId: 2, betable: true });

        expect(mapFortressQuotesToCells([nonBetable, betable], { privateKey })).toHaveLength(1);
        expect(mapFortressQuotesToCells(
            [nonBetable, betable],
            { privateKey, betableOnly: false },
        )).toHaveLength(2);
    });

    it('converts seconds and derives grid anchor from window offset', () => {
        const quote = quoteFixture({
            windowIndex: 11,
            startSecond: 1710000060,
        });

        expect(secondsToMs(1710000060)).toBe(1710000060000);
        expect(getFortressGridTsMs(quote)).toBe(1710000000000);
    });

    function quoteFixture(overrides: Partial<FortressQuote> = {}): FortressQuote {
        return {
            cellId: 109,
            modeId: '5',
            row: 9,
            windowIndex: 1,
            lowerPrice: 99997.5,
            upperPrice: 100002.5,
            startSecond: 1710000010,
            endSecond: 1710000015,
            pRaw: 0.12,
            pRawModel: 0.12,
            kSkew: 1,
            kSafety: 1,
            mBase: 2.3456789,
            mFinal: 2.3456789,
            bandWidth: 5,
            atrMean: 0,
            liability: 0,
            betable: true,
            ...overrides,
        };
    }
});

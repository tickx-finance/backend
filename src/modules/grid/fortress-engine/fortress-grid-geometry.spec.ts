import { describe, expect, it } from 'vitest';
import { signCell } from 'src/libs/cell';
import { FORTRESS_MAIN_MODE } from './fortress.config';
import {
    buildFortressGridGeometry,
    decodeFortressCellId,
    encodeFortressCellId,
} from './fortress-grid-geometry';
import { mapFortressQuoteToCell } from './fortress-cell.mapper';
import { FortressQuote } from './fortress.types';

describe('Fortress grid geometry', () => {
    it('matches Python _build_cells geometry for principal mode', () => {
        const geometry = buildFortressGridGeometry({
            oracleSecond: 1710000007,
            price: 100092,
        });

        expect(geometry).toMatchObject({
            modeId: '5',
            oracleSecond: 1710000007,
            timeAnchorSecond: 1710000005,
            anchorPrice: 100090,
            bandWidth: 5,
            centerRow: 9,
        });
        expect(geometry.cells).toHaveLength(20 * 12);

        expect(geometry.cells[0]).toEqual({
            cellId: 0,
            modeId: '5',
            row: 0,
            windowIndex: 0,
            lowerPrice: 100042.5,
            upperPrice: 100047.5,
            startSecond: 1710000010,
            endSecond: 1710000015,
            betable: false,
        });
        expect(geometry.cells[1]).toEqual({
            cellId: 1,
            modeId: '5',
            row: 0,
            windowIndex: 1,
            lowerPrice: 100042.5,
            upperPrice: 100047.5,
            startSecond: 1710000015,
            endSecond: 1710000020,
            betable: true,
        });

        const centerCurrentWindow = geometry.cells[9 * FORTRESS_MAIN_MODE.windows.length];
        expect(centerCurrentWindow).toEqual({
            cellId: 108,
            modeId: '5',
            row: 9,
            windowIndex: 0,
            lowerPrice: 100087.5,
            upperPrice: 100092.5,
            startSecond: 1710000010,
            endSecond: 1710000015,
            betable: false,
        });

        const last = geometry.cells[geometry.cells.length - 1];
        expect(last).toEqual({
            cellId: 239,
            modeId: '5',
            row: 19,
            windowIndex: 11,
            lowerPrice: 100137.5,
            upperPrice: 100142.5,
            startSecond: 1710000065,
            endSecond: 1710000070,
            betable: true,
        });
    });

    it('encodes and decodes cell ids like Python', () => {
        expect(encodeFortressCellId(9, 0)).toBe(108);
        expect(encodeFortressCellId(19, 11)).toBe(239);
        expect(decodeFortressCellId(239)).toEqual({
            modeId: '5',
            row: 19,
            windowIndex: 11,
        });
        expect(() => decodeFortressCellId(240)).toThrow('Invalid Fortress cell id');
    });

    it('maps betable geometry to a signed legacy Cell accepted by the order deadline shape', () => {
        const privateKey = 'test-cell-signer-key';
        const geometry = buildFortressGridGeometry({
            oracleSecond: 1710000007,
            price: 100092,
        });
        const betable = geometry.cells.find((cell) => cell.betable);
        expect(betable).toBeDefined();

        const quote: FortressQuote = {
            ...betable!,
            pRaw: 0,
            pRawModel: 0,
            kSkew: 1,
            kSafety: 1,
            mBase: 0,
            mFinal: 2.5,
            bandWidth: geometry.bandWidth,
            atrMean: 0,
            liability: 0,
        };
        const cell = mapFortressQuoteToCell(quote, { privateKey });

        expect(cell.gridTs).toBe(1710000005 * 1000);
        expect(cell.startTs).toBeGreaterThanOrEqual(cell.gridTs + 10_000);
        expect(cell.lowerPrice).toBe('100042.5000');
        expect(cell.upperPrice).toBe('100047.5000');
        expect(cell.rewardRate).toBe('2.500000');
        expect(cell.gridSignature).toBe(signCell(cell, privateKey));
    });
});

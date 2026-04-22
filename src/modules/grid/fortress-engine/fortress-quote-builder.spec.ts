import { describe, expect, it } from 'vitest';
import { signCell } from 'src/libs/cell';
import {
    createInitialFortressModeState,
    FORTRESS_GLOBAL_CONFIG,
    FORTRESS_MAIN_MODE,
} from './fortress.config';
import { buildFortressGridGeometry } from './fortress-grid-geometry';
import {
    applyIdleCenterPenalty,
    buildFortressQuotes,
    computeFortressEffectiveMargin,
    computeLiabilitySkew,
} from './fortress-quote-builder';
import { mapFortressQuotesToCells } from './fortress-cell.mapper';

describe('Fortress quote builder', () => {
    it('computes mEff from sigma/lambda risk terms with risk clamp', () => {
        expect(computeFortressEffectiveMargin(
            FORTRESS_MAIN_MODE,
            FORTRESS_GLOBAL_CONFIG,
            { sigma: FORTRESS_GLOBAL_CONFIG.sigmaRef, lambdaIntensity: FORTRESS_GLOBAL_CONFIG.lambdaRef },
        )).toBeCloseTo(FORTRESS_MAIN_MODE.mBase, 15);

        expect(computeFortressEffectiveMargin(
            FORTRESS_MAIN_MODE,
            FORTRESS_GLOBAL_CONFIG,
            { sigma: FORTRESS_GLOBAL_CONFIG.sigmaRef * 10, lambdaIntensity: FORTRESS_GLOBAL_CONFIG.lambdaRef * 10 },
        )).toBeCloseTo(FORTRESS_MAIN_MODE.mBase + FORTRESS_MAIN_MODE.mRiskMax, 15);
    });

    it('builds quote metadata and clamps M_final to mode bounds', () => {
        const geometry = buildFortressGridGeometry({
            oracleSecond: 1710000007,
            price: 100092,
        });
        const state = createInitialFortressModeState();
        state.sigma = FORTRESS_GLOBAL_CONFIG.sigmaRef;
        state.lambdaIntensity = FORTRESS_GLOBAL_CONFIG.lambdaRef;
        state.atrMean = 12.5;

        const pRawByCellId = Object.fromEntries(geometry.cells.map((cell) => [cell.cellId, 0.5]));
        const result = buildFortressQuotes({
            geometry,
            mode: FORTRESS_MAIN_MODE,
            config: FORTRESS_GLOBAL_CONFIG,
            modeState: state,
            pRawByCellId,
        });

        expect(result.quotes).toHaveLength(geometry.cells.length);
        expect(result.mEff).toBeCloseTo(0.022, 15);
        expect(result.quotes[0]).toMatchObject({
            cellId: 0,
            pRaw: 0.5,
            pRawModel: 0.5,
            kSkew: 1,
            kSafety: 1,
            mBase: 1.956,
            mFinal: 1.956,
            bandWidth: 5,
            atrMean: 12.5,
            liability: 0,
            betable: false,
        });
    });

    it('uses epsilon for zero P_raw and applies liability skew when provided', () => {
        const geometry = buildFortressGridGeometry({
            oracleSecond: 1710000007,
            price: 100092,
        });
        const state = createInitialFortressModeState();
        state.sigma = FORTRESS_GLOBAL_CONFIG.sigmaRef;
        state.lambdaIntensity = FORTRESS_GLOBAL_CONFIG.lambdaRef;

        const result = buildFortressQuotes({
            geometry,
            mode: FORTRESS_MAIN_MODE,
            config: FORTRESS_GLOBAL_CONFIG,
            modeState: state,
            pRawByCellId: {},
            liabilities: { 0: 2500 },
        });

        expect(result.quotes[0].pRaw).toBe(FORTRESS_GLOBAL_CONFIG.epsilon);
        expect(result.quotes[0].kSkew).toBeCloseTo(computeLiabilitySkew(
            FORTRESS_MAIN_MODE,
            FORTRESS_GLOBAL_CONFIG,
            2500,
        ), 15);
        expect(result.quotes[0].mFinal).toBe(FORTRESS_MAIN_MODE.mMax);
    });

    it('maps betable quotes to signed legacy cells while preserving socket payload shape', () => {
        const privateKey = 'test-cell-signer-key';
        const geometry = buildFortressGridGeometry({
            oracleSecond: 1710000007,
            price: 100092,
        });
        const state = createInitialFortressModeState();
        state.sigma = FORTRESS_GLOBAL_CONFIG.sigmaRef;
        state.lambdaIntensity = FORTRESS_GLOBAL_CONFIG.lambdaRef;
        const pRawByCellId = Object.fromEntries(geometry.cells.map((cell) => [cell.cellId, 0.5]));
        const { quotes } = buildFortressQuotes({
            geometry,
            mode: FORTRESS_MAIN_MODE,
            config: FORTRESS_GLOBAL_CONFIG,
            modeState: state,
            pRawByCellId,
        });
        const cells = mapFortressQuotesToCells(quotes, { privateKey });

        expect(cells).toHaveLength(quotes.filter((quote) => quote.betable).length);
        expect(cells[0]).toEqual({
            gridTs: 1710000005 * 1000,
            startTs: 1710000015 * 1000,
            endTs: 1710000020 * 1000,
            lowerPrice: '100042.5000',
            upperPrice: '100047.5000',
            rewardRate: '1.956000',
            gridSignature: cells[0].gridSignature,
        });
        expect(cells[0].gridSignature).toBe(signCell(cells[0], privateKey));
        expect(Object.keys(cells[0]).sort()).toEqual([
            'endTs',
            'gridSignature',
            'gridTs',
            'lowerPrice',
            'rewardRate',
            'startTs',
            'upperPrice',
        ]);
    });

    it('applies idle center penalty when ATR mean is not above band width', () => {
        expect(applyIdleCenterPenalty(
            FORTRESS_MAIN_MODE,
            { atrMean: 5 },
            { row: FORTRESS_MAIN_MODE.centerRow, windowIndex: 0 },
            3,
            5,
        )).toBeCloseTo(2, 15);
        expect(applyIdleCenterPenalty(
            FORTRESS_MAIN_MODE,
            { atrMean: 5 },
            { row: FORTRESS_MAIN_MODE.centerRow, windowIndex: 11 },
            3,
            5,
        )).toBeCloseTo(2.5, 15);
        expect(applyIdleCenterPenalty(
            FORTRESS_MAIN_MODE,
            { atrMean: 5 },
            { row: FORTRESS_MAIN_MODE.centerRow + 1, windowIndex: 0 },
            3,
            5,
        )).toBeCloseTo(3 / 1.3, 15);
        expect(applyIdleCenterPenalty(
            FORTRESS_MAIN_MODE,
            { atrMean: 5 },
            { row: FORTRESS_MAIN_MODE.centerRow + 2, windowIndex: 0 },
            3,
            5,
        )).toBe(3);
        expect(applyIdleCenterPenalty(
            FORTRESS_MAIN_MODE,
            { atrMean: 6 },
            { row: FORTRESS_MAIN_MODE.centerRow, windowIndex: 0 },
            3,
            5,
        )).toBe(3);
    });

    it('uses idle center penalty in final quote multipliers', () => {
        const geometry = buildFortressGridGeometry({
            oracleSecond: 1710000007,
            price: 100092,
        });
        const state = createInitialFortressModeState();
        state.sigma = FORTRESS_GLOBAL_CONFIG.sigmaRef;
        state.lambdaIntensity = FORTRESS_GLOBAL_CONFIG.lambdaRef;
        state.atrMean = 0;
        const pRawByCellId = Object.fromEntries(geometry.cells.map((cell) => [cell.cellId, 0.25]));

        const { quotes } = buildFortressQuotes({
            geometry,
            mode: FORTRESS_MAIN_MODE,
            config: FORTRESS_GLOBAL_CONFIG,
            modeState: state,
            pRawByCellId,
        });
        const centerFirstWindow = quotes.find((quote) => (
            quote.row === FORTRESS_MAIN_MODE.centerRow && quote.windowIndex === 0
        ));
        const outerFirstWindow = quotes.find((quote) => (
            quote.row === FORTRESS_MAIN_MODE.centerRow + 2 && quote.windowIndex === 0
        ));

        expect(centerFirstWindow?.mBase).toBeCloseTo(3.912, 15);
        expect(centerFirstWindow?.mFinal).toBeCloseTo(3.912 / 1.5, 15);
        expect(outerFirstWindow?.mFinal).toBeCloseTo(3.912, 15);
    });
});

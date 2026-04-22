import { describe, expect, it } from 'vitest';
import {
    computeAdaptiveBandWidthSeedValue,
    computeFarEdgePressure,
    computeNearCenterConcentration,
    computeOffCenterFloorRisk,
    getNeighborFortressBandWidth,
    normalizeExactPrawSurface,
    selectAdaptiveFortressBandWidth,
    selectFinalFortressBandWidth,
    snapFortressBandWidth,
} from './fortress-bandwidth';
import {
    createInitialFortressModeState,
    FORTRESS_GLOBAL_CONFIG,
    FORTRESS_MAIN_MODE,
} from './fortress.config';
import { buildFortressGridGeometry } from './fortress-grid-geometry';

describe('Fortress adaptive bandwidth', () => {
    it('snaps to the nearest supported dS with lower-value tie break', () => {
        expect(snapFortressBandWidth(4.6, FORTRESS_GLOBAL_CONFIG.bandwidthSelectionSet)).toBe(5);
        expect(snapFortressBandWidth(3, FORTRESS_GLOBAL_CONFIG.bandwidthSelectionSet)).toBe(2.5);
        expect(snapFortressBandWidth(100, FORTRESS_GLOBAL_CONFIG.bandwidthSelectionSet)).toBe(20);
    });

    it('returns adjacent supported dS values', () => {
        expect(getNeighborFortressBandWidth(5, -1, FORTRESS_GLOBAL_CONFIG.bandwidthSelectionSet)).toBe(4);
        expect(getNeighborFortressBandWidth(5, 1, FORTRESS_GLOBAL_CONFIG.bandwidthSelectionSet)).toBe(10);
        expect(getNeighborFortressBandWidth(1, -1, FORTRESS_GLOBAL_CONFIG.bandwidthSelectionSet)).toBe(1);
        expect(getNeighborFortressBandWidth(20, 1, FORTRESS_GLOBAL_CONFIG.bandwidthSelectionSet)).toBe(20);
    });

    it('computes seed dS as alpha * price * sigma_final and snaps it', () => {
        const rawSeed = computeAdaptiveBandWidthSeedValue({
            config: FORTRESS_GLOBAL_CONFIG,
            price: 100092,
            sigma: 0.0001638590404289288,
        });
        expect(rawSeed).toBeCloseTo(28.37369379907935, 12);

        const decision = selectAdaptiveFortressBandWidth({
            mode: FORTRESS_MAIN_MODE,
            config: FORTRESS_GLOBAL_CONFIG,
            currentBandWidth: 5,
            price: 100092,
            sigma: 0.0001638590404289288,
        });
        expect(decision).toEqual({
            modeId: '5',
            currentBandWidth: 5,
            seedBandWidth: 20,
            finalBandWidth: 20,
            action: 'select_seed',
            nearCenterConcentration: 0,
            farEdgePressure: 0,
            nearSignal: false,
            farSignal: false,
            conflict: false,
            floorRiskSeed: false,
            floorRiskFinal: false,
        });
    });

    it('normalizes exact surfaces and computes near/far signals', () => {
        const qSurface = normalizeExactPrawSurface([
            [1, 10],
            [2, 0],
            [3, 10],
        ]);

        expect(qSurface).toEqual([
            [1 / 6, 0.5],
            [2 / 6, 0],
            [3 / 6, 0.5],
        ]);
        expect(computeNearCenterConcentration(qSurface, 1, 1, 0)).toBeCloseTo(1, 15);
        expect(computeFarEdgePressure(qSurface, 1, 1)).toBeCloseTo(1, 15);
    });

    it('detects off-center floor-risk violations only for betable cells outside center band', () => {
        const mode = {
            ...FORTRESS_MAIN_MODE,
            rowCount: 3,
            centerRow: 1,
            windows: [[5, 10], [10, 15]] as const,
        };
        const geometry = buildFortressGridGeometry({
            oracleSecond: 100,
            price: 100,
            mode,
            bandWidth: 5,
        });
        const context = {
            modeId: mode.modeId,
            bandWidth: 5,
            price: 100,
            centerRow: 1,
            timeAnchorSecond: 100,
            mEff: 0.02,
            pFloorCrit: 0.3,
            cells: geometry.cells,
            pRawSurface: [
                [0.9, 0.9],
                [0.9, 0.9],
                [0.1, 0.1],
            ],
            qSurface: [],
        };

        const result = computeOffCenterFloorRisk(context, 0);

        expect(result.noGo).toBe(true);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0]).toMatchObject({
            row: 0,
            windowIndex: 1,
            pRaw: 0.9,
            pFloorCrit: 0.3,
        });
    });

    it('selects final dS using conflict, floor-risk, near, and far rules', () => {
        const modeState = createInitialFortressModeState();
        modeState.sigma = 0.0001638590404289288;
        const baseInput = {
            mode: FORTRESS_MAIN_MODE,
            config: FORTRESS_GLOBAL_CONFIG,
            modeState,
            currentBandWidth: 5,
            price: 100092,
            sigma: modeState.sigma,
            oracleSecond: 1710000007,
        };

        expect(selectFinalFortressBandWidth({
            ...baseInput,
            exactSurfaceFactory: () => contextWithSurface(20, [
                [0, 0.2],
                [0, 0],
                [1, 0.2],
                [0, 0],
                [0, 0.2],
            ]),
        }).action).toBe('fallback_current');

        const floorRiskDecision = selectFinalFortressBandWidth({
            ...baseInput,
            exactSurfaceFactory: (bandWidth) => ({
                ...contextWithSurface(bandWidth, [
                    [0, 0.9],
                    [0, 0],
                    [0, 0],
                    [0, 0],
                    [0, 0],
                ]),
                pFloorCrit: 0.1,
            }),
        });
        expect(floorRiskDecision.action).toBe('fallback_current');
        expect(floorRiskDecision.floorRiskSeed).toBe(true);

        const nearDecision = selectFinalFortressBandWidth({
            ...baseInput,
            exactSurfaceFactory: (bandWidth) => contextWithSurface(bandWidth, [
                [0, 0],
                [0, 0],
                [1, 0],
                [0, 0],
                [0, 0],
            ]),
        });
        expect(nearDecision.action).toBe('decrease_one_step');
        expect(nearDecision.finalBandWidth).toBe(15);

        const farDecision = selectFinalFortressBandWidth({
            ...baseInput,
            exactSurfaceFactory: (bandWidth) => contextWithSurface(bandWidth, [
                [0, 1],
                [0, 0],
                [0, 0],
                [0, 0],
                [0, 1],
            ]),
        });
        expect(farDecision.action).toBe('keep');
        expect(farDecision.finalBandWidth).toBe(20);
        expect(farDecision.farSignal).toBe(true);
    });

    function contextWithSurface(bandWidth: number, pRawSurface: number[][]) {
        const mode = {
            ...FORTRESS_MAIN_MODE,
            rowCount: pRawSurface.length,
            centerRow: Math.floor(pRawSurface.length / 2),
            windows: [[5, 10], [10, 15]] as const,
        };
        return {
            modeId: mode.modeId,
            bandWidth,
            price: 100092,
            centerRow: mode.centerRow,
            timeAnchorSecond: 1710000005,
            mEff: 0.02,
            pFloorCrit: 10,
            cells: buildFortressGridGeometry({
                oracleSecond: 1710000007,
                price: 100092,
                mode,
                bandWidth,
            }).cells,
            pRawSurface,
            qSurface: normalizeExactPrawSurface(pRawSurface),
        };
    }
});

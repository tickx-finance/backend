import { describe, expect, it } from 'vitest';
import { computeFortressAdaptivePWinMatrix } from './fortress-adaptive-mc';
import { FORTRESS_GLOBAL_CONFIG } from './fortress.config';
import { buildFortressGridGeometry } from './fortress-grid-geometry';
import { FortressModeConfig, FortressModeState } from './fortress.types';

describe('Fortress adaptive Monte Carlo', () => {
    it('uses exactly mcNMin paths when adaptive MC is disabled', () => {
        const result = computeFortressAdaptivePWinMatrix({
            price: 100,
            horizon: 2,
            geometry: makeGeometry(),
            mode: {
                ...minimalMode(),
                mcNMin: 3,
                mcNMax: 8,
                adaptiveMc: false,
            },
            config: FORTRESS_GLOBAL_CONFIG,
            modeState: minimalState(),
            oracleSecond: 100,
        });

        expect(result.pathsUsed).toBe(3);
        expect(result.batches).toBe(1);
        expect(result.pwinMatrix).toHaveLength(3);
    });

    it('stops at the first batch when adaptive error thresholds are satisfied', () => {
        const result = computeFortressAdaptivePWinMatrix({
            price: 100,
            horizon: 2,
            geometry: makeGeometry(),
            mode: {
                ...minimalMode(),
                mcNMin: 2,
                mcNMax: 6,
                adaptiveMc: true,
                seAbs: 1,
                seRel: 1,
            },
            config: FORTRESS_GLOBAL_CONFIG,
            modeState: minimalState(),
            oracleSecond: 100,
        });

        expect(result.pathsUsed).toBe(2);
        expect(result.batches).toBe(1);
        expect(result.converged).toBe(true);
    });

    it('adds batches until mcNMax when adaptive error thresholds are not satisfied', () => {
        const result = computeFortressAdaptivePWinMatrix({
            price: 100,
            horizon: 4,
            geometry: makeGeometry(),
            mode: {
                ...minimalMode(),
                mcNMin: 2,
                mcNMax: 4,
                adaptiveMc: true,
                seAbs: 0,
                seRel: 0,
            },
            config: FORTRESS_GLOBAL_CONFIG,
            modeState: {
                ...minimalState(),
                sigma: 0.08,
            },
            oracleSecond: 100,
        });

        expect(result.pathsUsed).toBe(4);
        expect(result.batches).toBe(2);
        expect(result.maxStandardError).toBeGreaterThan(0);
        expect(result.converged).toBe(false);
    });
});

function makeGeometry() {
    return buildFortressGridGeometry({
        oracleSecond: 100,
        price: 100,
        mode: minimalMode(),
    });
}

function minimalState(): FortressModeState {
    return {
        sigma: 0.05,
        sigmaRaw: 0.05,
        lambdaIntensity: 0,
        jumpFlag: false,
        bandWidthCurrent: 2,
        atrMean: 1,
        atrHistory: [],
        jumpSampler: {
            magnitudes: [],
            signs: [],
            maxSamples: 32,
        },
    };
}

function minimalMode(): FortressModeConfig {
    return {
        modeId: 'test',
        bandWidth: 2,
        windows: [[0, 2]],
        sigmaScale: 1,
        pRawGamma: 0,
        pNearBoost: 0,
        pTimeBoost: 0,
        mBase: 0,
        mRiskMax: 0,
        betaSkew: 0,
        poolCap: 0,
        riskBudget: 0,
        mMin: 1,
        mMax: 10,
        rowCount: 3,
        centerRow: 1,
        hlSeconds: 20,
        kappa0: 1,
        kappaQ: 1,
        kappaMin: 1,
        kappaMax: 1,
        mcNMin: 2,
        mcNMax: 4,
        seAbs: 0.001,
        seRel: 0.1,
        pFloor: 0.01,
        adaptiveMc: true,
        centerRowCalibrationAlpha: 1,
        centerRowMultiplierScale: 1,
        adjacentRowMultiplierScale: 1,
        lowEndSoftSpan: 0,
        currentRowLogitShift: 0,
        adjacentRowLogitShift: 0,
        zoneVolShiftScale: 0,
    };
}

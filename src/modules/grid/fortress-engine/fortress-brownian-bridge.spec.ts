import { describe, expect, it } from 'vitest';
import {
    computeBrownianBridgeHitProbability,
    computeFortressPWinMatrix,
} from './fortress-brownian-bridge';
import { buildFortressGridGeometry } from './fortress-grid-geometry';

describe('Fortress Brownian Bridge', () => {
    const epsilon = 1e-12;
    const varianceFloor = 1e-18;

    it('handles direct hit and crossing edge cases', () => {
        expect(computeBrownianBridgeHitProbability({
            startPrice: 100,
            endPrice: 105,
            lowerPrice: 99,
            upperPrice: 101,
            sigma: 0.1,
            epsilon,
            varianceFloor,
        })).toBe(1);

        expect(computeBrownianBridgeHitProbability({
            startPrice: 90,
            endPrice: 110,
            lowerPrice: 99,
            upperPrice: 101,
            sigma: 0.1,
            epsilon,
            varianceFloor,
        })).toBe(1);
    });

    it('uses zeta for both endpoints below or above the band', () => {
        const below = computeBrownianBridgeHitProbability({
            startPrice: 90,
            endPrice: 95,
            lowerPrice: 100,
            upperPrice: 105,
            sigma: 0.2,
            epsilon,
            varianceFloor,
        });
        const expectedBelow = Math.exp(Math.min(
            (-2 * Math.log(100 / 90) * Math.log(100 / 95)) / (0.2 ** 2 + varianceFloor),
            0,
        ));
        expect(below).toBeCloseTo(Math.fround(expectedBelow), 12);

        const above = computeBrownianBridgeHitProbability({
            startPrice: 120,
            endPrice: 115,
            lowerPrice: 100,
            upperPrice: 105,
            sigma: 0.2,
            epsilon,
            varianceFloor,
        });
        const expectedAbove = Math.exp(Math.min(
            (-2 * Math.log(105 / 120) * Math.log(105 / 115)) / (0.2 ** 2 + varianceFloor),
            0,
        ));
        expect(above).toBeCloseTo(Math.fround(expectedAbove), 12);
    });

    it('computes P_win and P_raw for a synthetic path matrix', () => {
        const geometry = buildFortressGridGeometry({
            oracleSecond: 100,
            price: 100,
            mode: {
                ...minimalMode(),
                windows: [[0, 2], [2, 4]],
                rowCount: 1,
                centerRow: 0,
                bandWidth: 10,
            },
        });
        const result = computeFortressPWinMatrix({
            geometry,
            paths: [
                [100, 100, 100, 100, 100],
                [90, 95, 99, 106, 110],
            ],
            sigma: 0.2,
            lockOffset: 0,
            epsilon,
            varianceFloor,
        });

        expect(geometry.cells.map((cell) => ({
            id: cell.cellId,
            L: cell.lowerPrice,
            R: cell.upperPrice,
            start: cell.startSecond,
            end: cell.endSecond,
        }))).toEqual([
            { id: 0, L: 95, R: 105, start: 100, end: 102 },
            { id: 1, L: 95, R: 105, start: 102, end: 104 },
        ]);
        expect(result.pwinMatrix[0]).toEqual([1, 1]);
        expect(result.pwinMatrix[1][0]).toBe(1);
        expect(result.pwinMatrix[1][1]).toBe(1);
        expect(result.pRaw).toEqual([1, 1]);
        expect(result.pRawByCellId).toEqual({ 0: 1, 1: 1 });
    });

    it('applies lock offset and returns zero for expired or empty windows', () => {
        const geometry = buildFortressGridGeometry({
            oracleSecond: 100,
            price: 100,
            mode: {
                ...minimalMode(),
                windows: [[0, 1], [10, 11]],
                rowCount: 1,
                centerRow: 0,
                bandWidth: 10,
            },
        });
        const result = computeFortressPWinMatrix({
            geometry,
            paths: [[90, 90, 90]],
            sigma: 0.2,
            lockOffset: 2,
            epsilon,
            varianceFloor,
        });

        expect(result.pwinMatrix).toEqual([[0, 0]]);
        expect(result.pRaw).toEqual([0, 0]);
    });

    it('returns empty matrices when paths or cells are empty', () => {
        const geometry = buildFortressGridGeometry({
            oracleSecond: 100,
            price: 100,
            mode: {
                ...minimalMode(),
                windows: [],
                rowCount: 1,
                centerRow: 0,
            },
        });
        expect(computeFortressPWinMatrix({
            geometry,
            paths: [[100, 101]],
            sigma: 0.2,
            lockOffset: 0,
            epsilon,
            varianceFloor,
        })).toEqual({
            pwinMatrix: [],
            pRaw: [],
            pRawByCellId: {},
        });
    });

    function minimalMode() {
        return {
            modeId: 'test',
            bandWidth: 10,
            windows: [[0, 1]] as const,
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
            rowCount: 1,
            centerRow: 0,
            hlSeconds: 20,
            kappa0: 1,
            kappaQ: 1,
            kappaMin: 1,
            kappaMax: 1,
            mcNMin: 1,
            mcNMax: 1,
            seAbs: 0,
            seRel: 0,
            pFloor: 0.01,
            adaptiveMc: false,
            centerRowCalibrationAlpha: 1,
            centerRowMultiplierScale: 1,
            adjacentRowMultiplierScale: 1,
            lowEndSoftSpan: 0,
            currentRowLogitShift: 0,
            adjacentRowLogitShift: 0,
            zoneVolShiftScale: 0,
        };
    }
});

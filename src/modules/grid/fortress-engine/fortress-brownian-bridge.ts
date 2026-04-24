import {
    FortressGeometryCell,
    FortressGridGeometry,
    FortressPWinMatrixInput,
    FortressPWinMatrixResult,
} from './fortress.types';

export interface BrownianBridgeHitInput {
    startPrice: number;
    endPrice: number;
    lowerPrice: number;
    upperPrice: number;
    sigma: number;
    dt?: number;
    epsilon: number;
    varianceFloor: number;
}

export function computeBrownianBridgeHitProbability({
    startPrice,
    endPrice,
    lowerPrice,
    upperPrice,
    sigma,
    dt = 1,
    epsilon,
    varianceFloor,
}: BrownianBridgeHitInput): number {
    const s0 = Math.max(startPrice, epsilon);
    const s1 = Math.max(endPrice, epsilon);
    const inBand = (
        (s0 >= lowerPrice && s0 <= upperPrice)
        || (s1 >= lowerPrice && s1 <= upperPrice)
    );
    if (inBand) {
        return 1;
    }

    if (s0 < lowerPrice && s1 < lowerPrice) {
        return clamp01(zeta(lowerPrice, s0, s1, sigma, dt, varianceFloor));
    }
    if (s0 > upperPrice && s1 > upperPrice) {
        return clamp01(zeta(upperPrice, s0, s1, sigma, dt, varianceFloor));
    }

    return 1;
}

export function computeFortressPWinMatrix({
    geometry,
    paths,
    sigma,
    lockOffset,
    epsilon,
    varianceFloor,
}: FortressPWinMatrixInput): FortressPWinMatrixResult {
    const cells = geometry.cells;
    if (cells.length === 0 || paths.length === 0 || paths[0].length < 2) {
        return emptyPWinResult(cells);
    }

    const nPaths = paths.length;
    const nSteps = paths[0].length - 1;
    assertRectangularPathMatrix(paths, nSteps + 1);

    const rowBounds = buildRowBounds(geometry);
    const rowHit = new Map<number, number[][]>();
    const sigmaEffective = Math.max(sigma, epsilon);
    for (const [row, bounds] of rowBounds.entries()) {
        rowHit.set(row, paths.map((path) => {
            const hits: number[] = [];
            for (let step = 0; step < nSteps; step += 1) {
                hits.push(computeBrownianBridgeHitProbability({
                    startPrice: path[step],
                    endPrice: path[step + 1],
                    lowerPrice: bounds.lowerPrice,
                    upperPrice: bounds.upperPrice,
                    sigma: sigmaEffective,
                    epsilon,
                    varianceFloor,
                }));
            }
            return hits;
        }));
    }

    const pwinMatrix = Array.from(
        { length: nPaths },
        () => Array.from({ length: cells.length }, () => 0),
    );

    cells.forEach((cell, cellIndex) => {
        const hitsForRow = rowHit.get(cell.row);
        if (!hitsForRow) {
            return;
        }

        const startStep = clampInteger(
            (cell.startSecond - geometry.oracleSecond) + Math.max(0, lockOffset),
            0,
            nSteps,
        );
        const endStep = Math.max(
            startStep,
            clampInteger(
                (cell.endSecond - geometry.oracleSecond) + Math.max(0, lockOffset),
                0,
                nSteps,
            ),
        );
        if (endStep <= startStep) {
            return;
        }

        for (let pathIndex = 0; pathIndex < nPaths; pathIndex += 1) {
            let noHitProbability = 1;
            for (let step = startStep; step < endStep; step += 1) {
                noHitProbability = Math.fround(
                    noHitProbability * Math.fround(1 - hitsForRow[pathIndex][step]),
                );
            }
            pwinMatrix[pathIndex][cellIndex] = Math.fround(1 - noHitProbability);
        }
    });

    const pRaw = cells.map((_, cellIndex) => {
        const sum = pwinMatrix.reduce((acc, row) => acc + row[cellIndex], 0);
        return sum / nPaths;
    });
    const pRawByCellId = Object.fromEntries(
        cells.map((cell, cellIndex) => [cell.cellId, pRaw[cellIndex]]),
    );

    return {
        pwinMatrix,
        pRaw,
        pRawByCellId,
        paths,
    };
}

function buildRowBounds(geometry: FortressGridGeometry): Map<number, CellPriceBounds> {
    const rowBounds = new Map<number, CellPriceBounds>();
    for (const cell of geometry.cells) {
        if (cell.windowIndex === 0 && !rowBounds.has(cell.row)) {
            rowBounds.set(cell.row, {
                lowerPrice: cell.lowerPrice,
                upperPrice: cell.upperPrice,
            });
        }
    }

    return rowBounds;
}

function emptyPWinResult(cells: FortressGeometryCell[]): FortressPWinMatrixResult {
    return {
        pwinMatrix: [],
        pRaw: cells.map(() => 0),
        pRawByCellId: Object.fromEntries(cells.map((cell) => [cell.cellId, 0])),
        paths: [],
    };
}

function zeta(
    boundaryPrice: number,
    startPrice: number,
    endPrice: number,
    sigma: number,
    dt: number,
    varianceFloor: number,
): number {
    const numerator = -2 * Math.log(boundaryPrice / startPrice) * Math.log(boundaryPrice / endPrice);
    const denominator = sigma * sigma * dt + varianceFloor;
    return Math.exp(Math.min(numerator / denominator, 0));
}

function assertRectangularPathMatrix(paths: number[][], width: number): void {
    for (const path of paths) {
        if (path.length !== width) {
            throw new Error('Fortress path matrix must be rectangular');
        }
    }
}

function clampInteger(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(high, Math.trunc(value)));
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Math.fround(value)));
}

interface CellPriceBounds {
    lowerPrice: number;
    upperPrice: number;
}

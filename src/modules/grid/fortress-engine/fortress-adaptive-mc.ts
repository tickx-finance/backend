import { computeFortressPWinMatrix } from './fortress-brownian-bridge';
import { generateFortressSeedParts, simulateFortressPaths } from './fortress-path-simulator';
import {
    FortressGlobalConfig,
    FortressGridGeometry,
    FortressModeConfig,
    FortressModeState,
    FortressPWinMatrixResult,
} from './fortress.types';

export interface FortressAdaptivePWinInput {
    price: number;
    horizon: number;
    geometry: FortressGridGeometry;
    mode: FortressModeConfig;
    config: FortressGlobalConfig;
    modeState: FortressModeState;
    oracleSecond: number;
    includePaths?: boolean;
}

export interface FortressAdaptivePWinResult extends FortressPWinMatrixResult {
    pathsUsed: number;
    batches: number;
    maxStandardError: number;
    maxRelativeError: number;
    converged: boolean;
}

const MAX_DIAGNOSTIC_PATHS = 100;

export function computeFortressAdaptivePWinMatrix({
    price,
    horizon,
    geometry,
    mode,
    config,
    modeState,
    oracleSecond,
    includePaths = false,
}: FortressAdaptivePWinInput): FortressAdaptivePWinResult {
    if (geometry.cells.length === 0 || horizon <= 0) {
        return {
            pwinMatrix: [],
            pRaw: geometry.cells.map(() => 0),
            pRawByCellId: Object.fromEntries(geometry.cells.map((cell) => [cell.cellId, 0])),
            paths: [],
            pathsUsed: 0,
            batches: 0,
            maxStandardError: 0,
            maxRelativeError: 0,
            converged: true,
        };
    }

    const batchSize = Math.max(1, Math.trunc(mode.mcNMin));
    const maxPaths = mode.adaptiveMc
        ? Math.max(batchSize, Math.trunc(mode.mcNMax))
        : batchSize;
    const pwinMatrix: number[][] = [];
    const allPaths: number[][] = [];
    let stats: PWinErrorStats = emptyStats(geometry.cells.length);
    let batches = 0;

    while (pwinMatrix.length < maxPaths) {
        const pathCount = Math.min(batchSize, maxPaths - pwinMatrix.length);
        const simulation = simulateFortressPaths({
            price,
            pathCount,
            horizon,
            sigma: modeState.sigma,
            lambdaIntensity: modeState.lambdaIntensity,
            jumpSampler: modeState.jumpSampler,
            seedParts: [
                ...generateFortressSeedParts(
                    config.seed,
                    mode.modeId,
                    oracleSecond,
                    price,
                ),
                'batch',
                batches,
            ],
            mu: config.mu,
            useAntithetic: config.useAntithetic,
            epsilon: config.epsilon,
        });
        const paths = simulation.paths;
        const batchPwin = computeFortressPWinMatrix({
            geometry,
            paths,
            sigma: modeState.sigma,
            lockOffset: config.lockOffset,
            epsilon: config.epsilon,
            varianceFloor: config.varianceFloor,
        });

        pwinMatrix.push(...batchPwin.pwinMatrix);
        if (includePaths) {
            allPaths.push(...paths);
        }
        batches += 1;
        stats = computePWinErrorStats(pwinMatrix, geometry.cells.length, mode.pFloor);

        if (!mode.adaptiveMc || stats.converged(mode.seAbs, mode.seRel)) {
            break;
        }
    }

    const pRawByCellId = Object.fromEntries(
        geometry.cells.map((cell, cellIndex) => [cell.cellId, stats.pRaw[cellIndex] ?? 0]),
    );

    return {
        pwinMatrix,
        pRaw: stats.pRaw,
        pRawByCellId,
        paths: includePaths ? selectDiagnosticPaths(allPaths, config.useAntithetic) : [],
        pathsUsed: pwinMatrix.length,
        batches,
        maxStandardError: stats.maxStandardError,
        maxRelativeError: stats.maxRelativeError,
        converged: stats.converged(mode.seAbs, mode.seRel),
    };
}

function computePWinErrorStats(
    pwinMatrix: number[][],
    cellCount: number,
    pFloor: number,
): PWinErrorStats {
    if (cellCount === 0 || pwinMatrix.length === 0) {
        return emptyStats(cellCount);
    }

    const pathCount = pwinMatrix.length;
    const pRaw = Array.from({ length: cellCount }, (_, cellIndex) => {
        const sum = pwinMatrix.reduce((acc, row) => acc + (row[cellIndex] ?? 0), 0);
        return sum / pathCount;
    });
    const standardErrors = pRaw.map((mean, cellIndex) => {
        const variance = pwinMatrix.reduce((acc, row) => {
            const diff = (row[cellIndex] ?? 0) - mean;
            return acc + diff * diff;
        }, 0) / pathCount;
        return Math.sqrt(variance / pathCount);
    });
    const relativeErrors = standardErrors.map((standardError, cellIndex) => {
        return standardError / Math.max(pRaw[cellIndex], pFloor);
    });

    return {
        pRaw,
        maxStandardError: Math.max(...standardErrors),
        maxRelativeError: Math.max(...relativeErrors),
        converged: (seAbs, seRel) => standardErrors.every((standardError, cellIndex) => {
            return standardError <= seAbs && relativeErrors[cellIndex] <= seRel;
        }),
    };
}

function emptyStats(cellCount: number): PWinErrorStats {
    return {
        pRaw: Array.from({ length: cellCount }, () => 0),
        maxStandardError: 0,
        maxRelativeError: 0,
        converged: () => true,
    };
}

interface PWinErrorStats {
    pRaw: number[];
    maxStandardError: number;
    maxRelativeError: number;
    converged(seAbs: number, seRel: number): boolean;
}

function selectDiagnosticPaths(paths: number[][], useAntithetic: boolean): number[][] {
    if (paths.length <= MAX_DIAGNOSTIC_PATHS) {
        return paths;
    }

    if (!useAntithetic || paths.length < 2) {
        return paths.slice(0, MAX_DIAGNOSTIC_PATHS);
    }

    const baseCount = Math.ceil(paths.length / 2);
    const antiCount = Math.floor(paths.length / 2);
    const pairCount = Math.min(antiCount, Math.floor(MAX_DIAGNOSTIC_PATHS / 2));
    const baseSample = paths.slice(0, pairCount);
    const antiSample = paths.slice(baseCount, baseCount + pairCount);

    if (MAX_DIAGNOSTIC_PATHS % 2 === 1 && baseCount > pairCount) {
        return [...baseSample, paths[pairCount], ...antiSample];
    }

    return [...baseSample, ...antiSample];
}

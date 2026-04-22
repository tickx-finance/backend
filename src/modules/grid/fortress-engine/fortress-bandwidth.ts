import {
    FortressBandWidthDecision,
    FortressGeometryCell,
    FortressGridGeometry,
    FortressGlobalConfig,
    FortressModeConfig,
    FortressModeState,
} from './fortress.types';
import { computeFortressPWinMatrix } from './fortress-brownian-bridge';
import { buildFortressGridGeometry } from './fortress-grid-geometry';
import {
    generateFortressSeedParts,
    simulateFortressPaths,
} from './fortress-path-simulator';
import { computeFortressEffectiveMargin } from './fortress-quote-builder';

export interface FortressAdaptiveBandWidthInput {
    mode: FortressModeConfig;
    config: FortressGlobalConfig;
    currentBandWidth: number;
    price: number;
    sigma: number;
}

export interface FortressExactSurfaceContext {
    modeId: string;
    bandWidth: number;
    price: number;
    centerRow: number;
    timeAnchorSecond: number;
    mEff: number;
    pFloorCrit: number;
    cells: FortressGeometryCell[];
    pRawSurface: number[][];
    qSurface: number[][];
}

export interface FortressExactSurfaceInput {
    mode: FortressModeConfig;
    config: FortressGlobalConfig;
    modeState: FortressModeState;
    oracleSecond: number;
    price: number;
    bandWidth: number;
    pathCount?: number;
}

export interface FortressFinalBandWidthInput extends FortressAdaptiveBandWidthInput {
    modeState: FortressModeState;
    oracleSecond: number;
    nearThreshold?: number;
    farThreshold?: number;
    centerRadius?: number;
    edgeDepth?: number;
    exactSurfaceFactory?: (bandWidth: number) => FortressExactSurfaceContext;
    pathCount?: number;
}

export interface FortressFloorRiskResult {
    noGo: boolean;
    bandWidth: number;
    pFloorCrit: number;
    violations: FortressFloorRiskViolation[];
}

export interface FortressFloorRiskViolation {
    cellId: number;
    row: number;
    windowIndex: number;
    pRaw: number;
    pFloorCrit: number;
    lowerPrice: number;
    upperPrice: number;
    startSecond: number;
    endSecond: number;
}

export function snapFortressBandWidth(
    value: number,
    domain: ReadonlyArray<number>,
): number {
    if (domain.length === 0) {
        throw new Error('Fortress bandwidth domain cannot be empty');
    }

    return [...domain].sort((left, right) => {
        const leftDistance = Math.abs(left - value);
        const rightDistance = Math.abs(right - value);
        if (leftDistance !== rightDistance) {
            return leftDistance - rightDistance;
        }
        return left - right;
    })[0];
}

export function getNeighborFortressBandWidth(
    current: number,
    direction: -1 | 0 | 1,
    domain: ReadonlyArray<number>,
): number {
    const sorted = [...domain].sort((left, right) => left - right);
    const snapped = snapFortressBandWidth(current, sorted);
    const index = sorted.indexOf(snapped);
    if (direction < 0) {
        return sorted[Math.max(0, index - 1)];
    }
    if (direction > 0) {
        return sorted[Math.min(sorted.length - 1, index + 1)];
    }
    return sorted[index];
}

export function computeAdaptiveBandWidthSeedValue({
    config,
    price,
    sigma,
}: Pick<FortressAdaptiveBandWidthInput, 'config' | 'price' | 'sigma'>): number {
    const currentPrice = Math.max(price, config.epsilon);
    const sigmaEffective = Math.max(sigma, config.epsilon);
    return config.bandwidthAlpha * currentPrice * sigmaEffective;
}

export function selectAdaptiveFortressBandWidth({
    mode,
    config,
    currentBandWidth,
    price,
    sigma,
}: FortressAdaptiveBandWidthInput): FortressBandWidthDecision {
    const metric = config.bandwidthMetric.trim().toLowerCase();
    if (metric !== 'sigma' && metric !== 'sigma_final') {
        throw new Error(`Unsupported Fortress bandwidth metric: ${config.bandwidthMetric}`);
    }

    const rawSeed = computeAdaptiveBandWidthSeedValue({ config, price, sigma });
    const seedBandWidth = snapFortressBandWidth(rawSeed, config.bandwidthSelectionSet);
    return {
        modeId: mode.modeId,
        currentBandWidth: snapFortressBandWidth(currentBandWidth, config.bandwidthSelectionSet),
        seedBandWidth,
        finalBandWidth: seedBandWidth,
        action: 'select_seed',
        nearCenterConcentration: 0,
        farEdgePressure: 0,
        nearSignal: false,
        farSignal: false,
        conflict: false,
        floorRiskSeed: false,
        floorRiskFinal: false,
    };
}

export function selectFinalFortressBandWidth({
    mode,
    config,
    modeState,
    currentBandWidth,
    price,
    sigma,
    oracleSecond,
    nearThreshold = 0.70,
    farThreshold = 0.15,
    centerRadius = 1,
    edgeDepth = 2,
    exactSurfaceFactory,
    pathCount,
}: FortressFinalBandWidthInput): FortressBandWidthDecision {
    const currentWidth = snapFortressBandWidth(currentBandWidth, config.bandwidthSelectionSet);
    const seedDecision = selectAdaptiveFortressBandWidth({
        mode,
        config,
        currentBandWidth,
        price,
        sigma,
    });
    const dSSeed = seedDecision.seedBandWidth;
    const getContext = exactSurfaceFactory
        ?? ((bandWidth: number) => computeExactSurfaceContext({
            mode,
            config,
            modeState,
            oracleSecond,
            price,
            bandWidth,
            pathCount,
        }));

    const seedContext = getContext(dSSeed);
    const nearCenterConcentration = computeNearCenterConcentration(
        seedContext.qSurface,
        seedContext.centerRow,
        centerRadius,
    );
    const farEdgePressure = computeFarEdgePressure(seedContext.qSurface, edgeDepth);
    const nearSignal = nearCenterConcentration > nearThreshold;
    const farSignal = farEdgePressure > farThreshold;
    const conflict = nearSignal && farSignal;
    const seedFloorRisk = computeOffCenterFloorRisk(seedContext, centerRadius);

    let finalBandWidth = dSSeed;
    let action = 'keep';
    let warning: string | undefined;
    let floorRiskFinal = seedFloorRisk.noGo;

    const floorRiskForWidth = (width: number) => (
        computeOffCenterFloorRisk(getContext(width), centerRadius).noGo
    );

    if (conflict) {
        finalBandWidth = currentWidth;
        action = currentWidth !== dSSeed ? 'fallback_current' : 'keep_seed_conflict';
        warning = 'near and far surface signals conflict';
        if (finalBandWidth !== dSSeed) {
            floorRiskFinal = floorRiskForWidth(finalBandWidth);
        }
    } else if (seedFloorRisk.noGo) {
        finalBandWidth = currentWidth;
        action = currentWidth !== dSSeed ? 'fallback_current' : 'keep_seed_no_go';
        warning = 'seed width violates off-center floor-risk guard';
        if (finalBandWidth !== dSSeed) {
            floorRiskFinal = floorRiskForWidth(finalBandWidth);
        }
    } else if (nearSignal) {
        const candidate = getNeighborFortressBandWidth(dSSeed, -1, config.bandwidthSelectionSet);
        finalBandWidth = candidate;
        action = candidate !== dSSeed ? 'decrease_one_step' : 'keep';
        if (candidate !== dSSeed) {
            floorRiskFinal = floorRiskForWidth(candidate);
            if (floorRiskFinal) {
                finalBandWidth = dSSeed;
                floorRiskFinal = seedFloorRisk.noGo;
                action = 'keep_seed_no_go';
                warning = 'decreased width violates off-center floor-risk guard';
            }
        }
    } else if (farSignal) {
        const candidate = getNeighborFortressBandWidth(dSSeed, 1, config.bandwidthSelectionSet);
        finalBandWidth = candidate;
        action = candidate !== dSSeed ? 'increase_one_step' : 'keep';
        if (candidate !== dSSeed) {
            floorRiskFinal = floorRiskForWidth(candidate);
            if (floorRiskFinal) {
                finalBandWidth = dSSeed;
                floorRiskFinal = seedFloorRisk.noGo;
                action = 'keep_seed_no_go';
                warning = 'increased width violates off-center floor-risk guard';
            }
        }
    }

    return {
        modeId: mode.modeId,
        currentBandWidth: currentWidth,
        seedBandWidth: dSSeed,
        finalBandWidth,
        action,
        nearCenterConcentration,
        farEdgePressure,
        nearSignal,
        farSignal,
        conflict,
        floorRiskSeed: seedFloorRisk.noGo,
        floorRiskFinal,
        warning,
    };
}

export function computeExactSurfaceContext({
    mode,
    config,
    modeState,
    oracleSecond,
    price,
    bandWidth,
    pathCount = mode.mcNMin,
}: FortressExactSurfaceInput): FortressExactSurfaceContext {
    const snappedBandWidth = snapFortressBandWidth(bandWidth, config.bandwidthSelectionSet);
    const geometry = buildFortressGridGeometry({
        oracleSecond,
        price,
        mode,
        bandWidth: snappedBandWidth,
    });
    const horizon = Math.max(...mode.windows.map(([, endSecond]) => endSecond))
        + Math.max(0, config.lockOffset);
    const paths = simulateFortressPaths({
        price,
        pathCount,
        horizon,
        sigma: modeState.sigma,
        lambdaIntensity: modeState.lambdaIntensity,
        jumpSampler: modeState.jumpSampler,
        seedParts: generateFortressSeedParts(config.seed, mode.modeId, oracleSecond, price),
        mu: config.mu,
        useAntithetic: config.useAntithetic,
        epsilon: config.epsilon,
    }).paths;
    const pwin = computeFortressPWinMatrix({
        geometry,
        paths,
        sigma: modeState.sigma,
        lockOffset: config.lockOffset,
        epsilon: config.epsilon,
        varianceFloor: config.varianceFloor,
    });
    const pRawSurface = materializePrawSurface(geometry, pwin.pRawByCellId, mode);
    const qSurface = normalizeExactPrawSurface(pRawSurface);
    const centerRow = Math.max(0, Math.min(mode.centerRow, mode.rowCount - 1));
    const mEff = computeFortressEffectiveMargin(mode, config, modeState);

    return {
        modeId: mode.modeId,
        bandWidth: snappedBandWidth,
        price,
        centerRow,
        timeAnchorSecond: geometry.timeAnchorSecond,
        mEff,
        pFloorCrit: (1 - mEff) / Math.max(mode.mMin, config.epsilon),
        cells: geometry.cells,
        pRawSurface,
        qSurface,
    };
}

export function materializePrawSurface(
    geometry: FortressGridGeometry,
    pRawByCellId: Record<number, number>,
    mode: Pick<FortressModeConfig, 'rowCount' | 'windows'>,
): number[][] {
    const surface = Array.from(
        { length: mode.rowCount },
        () => Array.from({ length: mode.windows.length }, () => 0),
    );

    for (const cell of geometry.cells) {
        if (
            cell.row >= 0
            && cell.row < mode.rowCount
            && cell.windowIndex >= 0
            && cell.windowIndex < mode.windows.length
        ) {
            surface[cell.row][cell.windowIndex] = pRawByCellId[cell.cellId] ?? 0;
        }
    }

    return surface;
}

export function normalizeExactPrawSurface(pRawSurface: number[][]): number[][] {
    if (pRawSurface.length === 0) {
        return [];
    }

    const width = pRawSurface[0].length;
    const normalized = pRawSurface.map((row) => row.map(() => 0));
    for (let column = 0; column < width; column += 1) {
        const columnSum = pRawSurface.reduce((sum, row) => sum + (row[column] ?? 0), 0);
        if (columnSum <= 0) {
            continue;
        }
        for (let row = 0; row < pRawSurface.length; row += 1) {
            normalized[row][column] = pRawSurface[row][column] / columnSum;
        }
    }

    return normalized;
}

export function computeNearCenterConcentration(
    qSurface: number[][],
    centerRow: number,
    centerRadius = 1,
    nearWindowIndex = 0,
): number {
    if (qSurface.length === 0) {
        return 0;
    }
    if (nearWindowIndex < 0 || nearWindowIndex >= qSurface[0].length) {
        throw new Error(`Invalid near window index: ${nearWindowIndex}`);
    }
    const rowLo = Math.max(0, centerRow - Math.max(0, centerRadius));
    const rowHi = Math.min(qSurface.length, centerRow + Math.max(0, centerRadius) + 1);
    let total = 0;
    for (let row = rowLo; row < rowHi; row += 1) {
        total += qSurface[row][nearWindowIndex];
    }
    return total;
}

export function computeFarEdgePressure(
    qSurface: number[][],
    edgeDepth = 2,
    farWindowIndex?: number,
): number {
    if (qSurface.length === 0) {
        return 0;
    }
    const column = farWindowIndex ?? qSurface[0].length - 1;
    if (column < 0 || column >= qSurface[0].length) {
        throw new Error(`Invalid far window index: ${column}`);
    }
    const depth = Math.max(0, edgeDepth);
    if (depth === 0) {
        return 0;
    }

    let total = 0;
    for (let row = 0; row < Math.min(depth, qSurface.length); row += 1) {
        total += qSurface[row][column];
    }
    for (let row = Math.max(0, qSurface.length - depth); row < qSurface.length; row += 1) {
        total += qSurface[row][column];
    }
    return total;
}

export function computeOffCenterFloorRisk(
    context: FortressExactSurfaceContext,
    centerExclusionRadius = 1,
): FortressFloorRiskResult {
    const violations: FortressFloorRiskViolation[] = [];
    const exclusionRadius = Math.max(0, centerExclusionRadius);

    for (const cell of context.cells) {
        if (Math.abs(cell.row - context.centerRow) <= exclusionRadius) {
            continue;
        }
        if (cell.startSecond < context.timeAnchorSecond + 10) {
            continue;
        }
        const pRaw = context.pRawSurface[cell.row]?.[cell.windowIndex] ?? 0;
        if (pRaw <= context.pFloorCrit) {
            continue;
        }
        violations.push({
            cellId: cell.cellId,
            row: cell.row,
            windowIndex: cell.windowIndex,
            pRaw,
            pFloorCrit: context.pFloorCrit,
            lowerPrice: cell.lowerPrice,
            upperPrice: cell.upperPrice,
            startSecond: cell.startSecond,
            endSecond: cell.endSecond,
        });
    }

    return {
        noGo: violations.length > 0,
        bandWidth: context.bandWidth,
        pFloorCrit: context.pFloorCrit,
        violations,
    };
}

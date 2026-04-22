import {
    FortressGlobalConfig,
    FortressModeConfig,
    FortressModeState,
    FortressQuote,
    FortressQuoteBuildInput,
    FortressQuoteBuildResult,
} from './fortress.types';

export function buildFortressQuotes({
    geometry,
    mode,
    config,
    modeState,
    pRawByCellId,
    liabilities = {},
    kSafety = 1,
}: FortressQuoteBuildInput): FortressQuoteBuildResult {
    const mEff = computeFortressEffectiveMargin(mode, config, modeState);
    const quotes = geometry.cells.map((cell) => {
        const pRawModel = clampProbability(
            pRawByCellId[cell.cellId] ?? 0,
            config.epsilon,
        );
        const pRaw = pRawModel;
        const mBase = (1 - mEff) / pRaw;
        const liability = liabilities[cell.cellId] ?? 0;
        const kSkew = computeLiabilitySkew(mode, config, liability);
        const rawMFinal = clamp(mBase * kSkew * kSafety, mode.mMin, mode.mMax);
        const mFinal = applyIdleCenterPenalty(
            mode,
            modeState,
            cell,
            rawMFinal,
            geometry.bandWidth,
        );

        return {
            ...cell,
            pRaw,
            pRawModel,
            kSkew,
            kSafety,
            mBase,
            mFinal,
            bandWidth: geometry.bandWidth,
            atrMean: modeState.atrMean,
            liability,
        };
    });

    return {
        quotes,
        mEff,
    };
}

export function computeFortressEffectiveMargin(
    mode: FortressModeConfig,
    config: FortressGlobalConfig,
    modeState: Pick<FortressModeState, 'sigma' | 'lambdaIntensity'>,
): number {
    const sigmaTerm = Math.max(
        0,
        modeState.sigma / Math.max(config.sigmaRef, config.epsilon) - 1,
    );
    const lambdaTerm = Math.max(
        0,
        modeState.lambdaIntensity / Math.max(config.lambdaRef, config.epsilon) - 1,
    );
    const mRisk = clamp(
        config.aSigma * sigmaTerm + config.aLambda * lambdaTerm,
        0,
        mode.mRiskMax,
    );
    return mode.mBase + mRisk;
}

export function computeLiabilitySkew(
    mode: Pick<FortressModeConfig, 'betaSkew' | 'poolCap'>,
    config: Pick<FortressGlobalConfig, 'epsilon'>,
    liability: number,
): number {
    return 1 / (1 + mode.betaSkew * (liability / Math.max(mode.poolCap, config.epsilon)));
}

export function applyIdleCenterPenalty(
    mode: Pick<FortressModeConfig, 'centerRow' | 'windows'>,
    modeState: Pick<FortressModeState, 'atrMean'>,
    cell: Pick<FortressQuote, 'row' | 'windowIndex'>,
    mFinal: number,
    bandWidth: number,
): number {
    if (modeState.atrMean > bandWidth) {
        return mFinal;
    }

    const rowDistance = Math.abs(Math.trunc(cell.row) - Math.trunc(mode.centerRow));
    const maxWindowIndex = Math.max(0, mode.windows.length - 1);
    if (rowDistance === 0) {
        const divisor = interpolateByWindow(cell.windowIndex, maxWindowIndex, 1.5, 1.2);
        return Math.max(mFinal / divisor, 1.00);
    }
    if (rowDistance === 1) {
        const divisor = interpolateByWindow(cell.windowIndex, maxWindowIndex, 1.3, 1.1);
        return Math.max(mFinal / divisor, 1.02);
    }

    return mFinal;
}

function interpolateByWindow(
    windowIndex: number,
    maxWindowIndex: number,
    startValue: number,
    endValue: number,
): number {
    if (maxWindowIndex <= 0) {
        return endValue;
    }

    const ratio = clamp(windowIndex / maxWindowIndex, 0, 1);
    return startValue + (endValue - startValue) * ratio;
}

function clampProbability(value: number, epsilon: number): number {
    return clamp(value, epsilon, 1 - epsilon);
}

function clamp(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(high, value));
}

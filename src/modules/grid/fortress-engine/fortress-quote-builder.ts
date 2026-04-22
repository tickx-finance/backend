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
        const mFinal = clamp(mBase * kSkew * kSafety, mode.mMin, mode.mMax);

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

function clampProbability(value: number, epsilon: number): number {
    return clamp(value, epsilon, 1 - epsilon);
}

function clamp(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(high, value));
}

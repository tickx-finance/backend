import {
    FORTRESS_MAIN_MODE_ID,
    FortressGlobalConfig,
    FortressModeConfig,
    FortressModeState,
} from './fortress.types';

export const FORTRESS_BAND_WIDTH_DOMAIN = [1, 2, 2.5, 4, 5, 10, 15, 20] as const;

export const FORTRESS_PRINCIPAL_WINDOWS = [
    [5, 10],
    [10, 15],
    [15, 20],
    [20, 25],
    [25, 30],
    [30, 35],
    [35, 40],
    [40, 45],
    [45, 50],
    [50, 55],
    [55, 60],
    [60, 65],
] as const;

export const FORTRESS_MAIN_MODE: FortressModeConfig = {
    modeId: FORTRESS_MAIN_MODE_ID,
    bandWidth: 5,
    windows: FORTRESS_PRINCIPAL_WINDOWS,
    sigmaScale: 0.05,
    pRawGamma: 0,
    pNearBoost: 0,
    pTimeBoost: 0,
    mBase: 0.022,
    mRiskMax: 0.025,
    betaSkew: 4,
    poolCap: 5000,
    riskBudget: 50000,
    mMin: 1.05,
    mMax: 25,
    rowCount: 20,
    centerRow: 9,
    hlSeconds: 20,
    kappa0: 3.1,
    kappaQ: 0.5,
    kappaMin: 2.7,
    kappaMax: 6.0,
    mcNMin: 500,
    mcNMax: 1000,
    seAbs: 0.001,
    seRel: 0.10,
    pFloor: 0.01,
    adaptiveMc: true,
    centerRowCalibrationAlpha: 0.65,
    centerRowMultiplierScale: 1,
    adjacentRowMultiplierScale: 1,
    lowEndSoftSpan: 0,
    currentRowLogitShift: 0,
    adjacentRowLogitShift: 0,
    zoneVolShiftScale: 0,
};

export const FORTRESS_GLOBAL_CONFIG: FortressGlobalConfig = {
    epsilon: 1e-12,
    varianceFloor: 1e-18,
    probabilityFloor: 1e-12,
    mu: 0,
    lockOffset: 1,
    lockDelayMs: 500,
    hawkesMu0: 0.02,
    hawkesAlpha: 0.18,
    hawkesBeta: 0.45,
    sigmaRef: 3e-05,
    lambdaRef: 0.1,
    aSigma: 0.70,
    aLambda: 0.35,
    parkinsonWeight: 0,
    liabilityRho: 0.7,
    useAntithetic: true,
    useSigmaScaling: false,
    usePriceScaling: false,
    bandwidthSelectionSet: FORTRESS_BAND_WIDTH_DOMAIN,
    bandwidthMetric: 'sigma_final',
    bandwidthAlpha: 1.73,
};

export function createInitialFortressModeState(
    mode: FortressModeConfig = FORTRESS_MAIN_MODE,
): FortressModeState {
    return {
        sigma: 0,
        sigmaRaw: 0,
        lambdaIntensity: 0,
        jumpFlag: false,
        bandWidthCurrent: mode.bandWidth,
        atrMean: 0,
        atrHistory: [],
        jumpSampler: {
            magnitudes: [],
            signs: [],
            maxSamples: 5000,
        },
    };
}

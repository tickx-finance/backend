export const FORTRESS_MAIN_MODE_ID = '5';

export interface FortressCell {
    cellId: number;
    modeId: string;
    row: number;
    windowIndex: number;
    lowerPrice: number;
    upperPrice: number;
    startSecond: number;
    endSecond: number;
}

export interface FortressGeometryCell extends FortressCell {
    betable: boolean;
}

export interface FortressGridGeometry {
    modeId: string;
    oracleSecond: number;
    timeAnchorSecond: number;
    anchorPrice: number;
    bandWidth: number;
    centerRow: number;
    cells: FortressGeometryCell[];
}

export interface FortressModeConfig {
    modeId: string;
    bandWidth: number;
    windows: ReadonlyArray<readonly [number, number]>;
    sigmaScale: number;
    pRawGamma: number;
    pNearBoost: number;
    pTimeBoost: number;
    mBase: number;
    mRiskMax: number;
    betaSkew: number;
    poolCap: number;
    riskBudget: number;
    mMin: number;
    mMax: number;
    rowCount: number;
    centerRow: number;
    hlSeconds: number;
    kappa0: number;
    kappaQ: number;
    kappaMin: number;
    kappaMax: number;
    mcNMin: number;
    mcNMax: number;
    seAbs: number;
    seRel: number;
    pFloor: number;
    adaptiveMc: boolean;
    centerRowCalibrationAlpha: number;
    centerRowMultiplierScale: number;
    adjacentRowMultiplierScale: number;
    lowEndSoftSpan: number;
    currentRowLogitShift: number;
    adjacentRowLogitShift: number;
    zoneVolShiftScale: number;
}

export interface FortressGlobalConfig {
    epsilon: number;
    varianceFloor: number;
    probabilityFloor: number;
    mu: number;
    lockOffset: number;
    lockDelayMs: number;
    hawkesMu0: number;
    hawkesAlpha: number;
    hawkesBeta: number;
    sigmaRef: number;
    lambdaRef: number;
    aSigma: number;
    aLambda: number;
    parkinsonWeight: number;
    liabilityRho: number;
    useAntithetic: boolean;
    seed?: number;
    useSigmaScaling: boolean;
    usePriceScaling: boolean;
    bandwidthSelectionSet: ReadonlyArray<number>;
    bandwidthMetric: 'sigma_final';
    bandwidthAlpha: number;
}

export interface FortressModeState {
    vEwma?: number;
    sigma: number;
    sigmaRaw: number;
    lambdaIntensity: number;
    jumpFlag: boolean;
    bandWidthCurrent: number;
    atrMean: number;
    atrHistory: number[];
    jumpSampler: FortressJumpSamplerState;
}

export interface FortressOracleState {
    oracleSecond: number;
    price: number;
    sigmaByMode: Record<string, number>;
    lambdaByMode: Record<string, number>;
    jumpFlagByMode: Record<string, boolean>;
}

export interface FortressOracleTick {
    timestampMs: number;
    price: number;
    volume?: number;
    tradeId?: number;
}

export interface FortressOracleBar {
    oracleSecond: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface FortressOracleUpdate {
    bar: FortressOracleBar;
    previousClose?: number;
    logReturn: number;
    volatilityObservation: number;
    timeAnchorSecond: number;
}

export interface FortressJumpSamplerState {
    magnitudes: number[];
    signs: number[];
    maxSamples: number;
}

export interface FortressStateTransition {
    oracleState: FortressOracleState;
    modeState: FortressModeState;
    geometry: FortressGridGeometry | null;
    bandWidthDecision: FortressBandWidthDecision | null;
    runPricing: boolean;
    refreshBandWidth: boolean;
    logReturn: number;
    vObserved: number;
    vPrevious: number;
    vNow: number;
    decay: number;
    zScore: number;
    kappa: number;
    hawkesFactor: number;
    timeAnchorSecond: number;
}

export interface FortressOracleUpdateOptions {
    runPricing?: boolean;
    refreshBandWidth?: boolean;
}

export interface FortressPathSimulationInput {
    price: number;
    pathCount: number;
    horizon: number;
    sigma: number;
    lambdaIntensity: number;
    jumpSampler: FortressJumpSamplerState;
    seedParts: readonly unknown[];
    mu?: number;
    useAntithetic?: boolean;
    epsilon?: number;
}

export interface FortressPathSimulationResult {
    paths: number[][];
    returns: number[][];
    jumpCount: number;
    pJump: number;
}

export interface FortressPWinMatrixInput {
    geometry: FortressGridGeometry;
    paths: number[][];
    sigma: number;
    lockOffset: number;
    epsilon: number;
    varianceFloor: number;
}

export interface FortressPWinMatrixResult {
    pwinMatrix: number[][];
    pRaw: number[];
    pRawByCellId: Record<number, number>;
}

export interface FortressQuote extends FortressCell {
    pRaw: number;
    pRawModel: number;
    kSkew: number;
    kSafety: number;
    mBase: number;
    mFinal: number;
    bandWidth: number;
    atrMean: number;
    liability: number;
    betable: boolean;
}

export interface FortressQuoteBuildInput {
    geometry: FortressGridGeometry;
    mode: FortressModeConfig;
    config: FortressGlobalConfig;
    modeState: FortressModeState;
    pRawByCellId: Record<number, number>;
    liabilities?: Record<number, number>;
    kSafety?: number;
}

export interface FortressQuoteBuildResult {
    quotes: FortressQuote[];
    mEff: number;
}

export interface FortressBandWidthDecision {
    modeId: string;
    currentBandWidth: number;
    seedBandWidth: number;
    finalBandWidth: number;
    action: string;
    nearCenterConcentration: number;
    farEdgePressure: number;
    nearSignal: boolean;
    farSignal: boolean;
    conflict: boolean;
    floorRiskSeed: boolean;
    floorRiskFinal: boolean;
    warning?: string;
}

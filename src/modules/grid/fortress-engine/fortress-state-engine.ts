import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    createInitialFortressModeState,
    FORTRESS_GLOBAL_CONFIG,
    FORTRESS_MAIN_MODE,
} from './fortress.config';
import { selectFinalFortressBandWidth } from './fortress-bandwidth';
import { buildFortressGridGeometry } from './fortress-grid-geometry';
import {
    FortressGridGeometry,
    FortressGlobalConfig,
    FortressModeConfig,
    FortressModeState,
    FortressOracleState,
    FortressOracleUpdateOptions,
    FortressOracleUpdate,
    FortressStateTransition,
} from './fortress.types';

const ATR_HISTORY_LIMIT = 10;

@Injectable()
export class FortressStateEngine {
    private modeState: FortressModeState;
    private oracleState?: FortressOracleState;
    private geometry?: FortressGridGeometry;

    constructor(
        @Optional()
        @Inject('FORTRESS_MODE_CONFIG')
        private readonly mode: FortressModeConfig = FORTRESS_MAIN_MODE,
        @Optional()
        @Inject('FORTRESS_GLOBAL_CONFIG')
        private readonly config: FortressGlobalConfig = FORTRESS_GLOBAL_CONFIG,
    ) {
        this.modeState = createInitialFortressModeState(this.mode);
    }

    updateOracle(
        update: FortressOracleUpdate,
        options: FortressOracleUpdateOptions = {},
    ): FortressStateTransition {
        const runPricing = options.runPricing ?? true;
        const refreshBandWidth = options.refreshBandWidth ?? runPricing;
        const state = cloneModeState(this.modeState);
        const trueRange = computeTrueRange(
            update.bar.high,
            update.bar.low,
            update.previousClose ?? update.bar.close,
        );
        state.atrHistory = pushBounded(state.atrHistory, trueRange, ATR_HISTORY_LIMIT);
        state.atrMean = mean(state.atrHistory);

        const decay = Math.exp(-Math.log(2) / Math.max(this.mode.hlSeconds, this.config.epsilon));
        const vPrevious = state.vEwma ?? this.config.sigmaRef * this.config.sigmaRef;
        let vObserved = update.volatilityObservation;

        const parkinsonVariance = computeParkinsonVariance(update.bar.high, update.bar.low);
        const parkinsonWeight = clamp(this.config.parkinsonWeight, 0, 1);
        if (parkinsonVariance !== undefined && parkinsonWeight > 0) {
            vObserved = (1 - parkinsonWeight) * vObserved + parkinsonWeight * parkinsonVariance;
        }

        const vNow = (1 - decay) * vObserved + decay * vPrevious;
        const sigmaRaw = Math.sqrt(Math.max(vNow, this.config.varianceFloor));
        const zScore = Math.abs(update.logReturn) / Math.max(sigmaRaw, this.config.epsilon);
        const sigmaRatio = Math.max(
            sigmaRaw / Math.max(this.config.sigmaRef, this.config.epsilon),
            this.config.epsilon,
        );
        const kappa = clamp(
            this.mode.kappa0 * sigmaRatio ** this.mode.kappaQ,
            this.mode.kappaMin,
            this.mode.kappaMax,
        );
        const jumpFlag = zScore > kappa;
        if (jumpFlag) {
            recordJump(state, update.logReturn);
        }

        const hawkesFactor = computeHawkesBandwidthFactor(
            state.bandWidthCurrent,
            this.config.epsilon,
        );
        const hawkesMu0 = this.config.hawkesMu0 * hawkesFactor;
        const hawkesAlpha = this.config.hawkesAlpha * hawkesFactor;
        const lambdaPrevious = state.lambdaIntensity > 0 ? state.lambdaIntensity : hawkesMu0;
        const lambdaNext = (
            hawkesMu0
            + Math.exp(-this.config.hawkesBeta) * (lambdaPrevious - hawkesMu0)
            + hawkesAlpha * (jumpFlag ? 1 : 0)
        );

        let sigma = sigmaRaw;
        if (this.config.useSigmaScaling) {
            sigma *= Math.max(this.mode.sigmaScale, this.config.epsilon);
        }
        if (this.config.usePriceScaling) {
            const priceAdjustment = Math.sqrt(Math.max(update.bar.close, 10000) / 100000);
            sigma *= clamp(priceAdjustment, 0.7, 1.3);
        }

        state.vEwma = vNow;
        state.sigma = sigma;
        state.sigmaRaw = sigmaRaw;
        state.jumpFlag = jumpFlag;
        state.lambdaIntensity = Math.max(0, lambdaNext);
        const bandWidthDecision = runPricing && refreshBandWidth
            ? selectFinalFortressBandWidth({
                mode: this.mode,
                config: this.config,
                modeState: state,
                currentBandWidth: state.bandWidthCurrent,
                price: update.bar.close,
                sigma: state.sigma,
                oracleSecond: update.bar.oracleSecond,
            })
            : null;
        if (bandWidthDecision) {
            state.bandWidthCurrent = bandWidthDecision.finalBandWidth;
        }

        this.modeState = state;
        this.oracleState = {
            oracleSecond: update.bar.oracleSecond,
            price: update.bar.close,
            sigmaByMode: { [this.mode.modeId]: state.sigma },
            lambdaByMode: { [this.mode.modeId]: state.lambdaIntensity },
            jumpFlagByMode: { [this.mode.modeId]: state.jumpFlag },
        };
        this.geometry = runPricing
            ? buildFortressGridGeometry({
                oracleSecond: update.bar.oracleSecond,
                price: update.bar.close,
                mode: this.mode,
                bandWidth: state.bandWidthCurrent,
            })
            : undefined;

        return {
            oracleState: this.oracleState,
            modeState: cloneModeState(this.modeState),
            geometry: this.geometry ? cloneGeometry(this.geometry) : null,
            bandWidthDecision,
            runPricing,
            refreshBandWidth,
            logReturn: update.logReturn,
            vObserved,
            vPrevious,
            vNow,
            decay,
            zScore,
            kappa,
            hawkesFactor,
            timeAnchorSecond: update.timeAnchorSecond,
        };
    }

    getModeState(): FortressModeState {
        return cloneModeState(this.modeState);
    }

    getOracleState(): FortressOracleState | null {
        return this.oracleState ? { ...this.oracleState } : null;
    }

    getGeometry(): FortressGridGeometry | null {
        return this.geometry ? cloneGeometry(this.geometry) : null;
    }

    reset(): void {
        this.modeState = createInitialFortressModeState(this.mode);
        this.oracleState = undefined;
        this.geometry = undefined;
    }
}

export function computeTrueRange(high: number, low: number, previousClose: number): number {
    return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
}

export function computeParkinsonVariance(high: number, low: number): number | undefined {
    if (high <= 0 || low <= 0 || high < low) {
        return undefined;
    }

    const logHighLow = Math.log(high / low);
    return (logHighLow * logHighLow) / (4 * Math.log(2));
}

export function computeHawkesBandwidthFactor(bandWidth: number, epsilon: number): number {
    const effectiveBandWidth = Math.max(bandWidth, epsilon);
    if (effectiveBandWidth >= 5) {
        return 1;
    }

    return Math.exp(-5 / effectiveBandWidth);
}

function recordJump(state: FortressModeState, logReturn: number): void {
    if (logReturn === 0) {
        return;
    }

    state.jumpSampler.magnitudes = pushBounded(
        state.jumpSampler.magnitudes,
        Math.abs(logReturn),
        state.jumpSampler.maxSamples,
    );
    state.jumpSampler.signs = pushBounded(
        state.jumpSampler.signs,
        logReturn > 0 ? 1 : -1,
        state.jumpSampler.maxSamples,
    );
}

function cloneModeState(state: FortressModeState): FortressModeState {
    return {
        ...state,
        atrHistory: [...state.atrHistory],
        jumpSampler: {
            ...state.jumpSampler,
            magnitudes: [...state.jumpSampler.magnitudes],
            signs: [...state.jumpSampler.signs],
        },
    };
}

function cloneGeometry(geometry: FortressGridGeometry): FortressGridGeometry {
    return {
        ...geometry,
        cells: geometry.cells.map((cell) => ({ ...cell })),
    };
}

function pushBounded<T>(items: T[], item: T, limit: number): T[] {
    const next = [...items, item];
    if (next.length <= limit) {
        return next;
    }

    return next.slice(next.length - limit);
}

function mean(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(high, value));
}

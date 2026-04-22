import { describe, expect, it } from 'vitest';
import {
    computeHawkesBandwidthFactor,
    computeParkinsonVariance,
    computeTrueRange,
    FortressStateEngine,
} from './fortress-state-engine';
import { FORTRESS_GLOBAL_CONFIG, FORTRESS_MAIN_MODE } from './fortress.config';
import { FortressOracleUpdate } from './fortress.types';

describe('FortressStateEngine', () => {
    it('ports EWMA volatility, kappa, Hawkes, and ATR state transitions', () => {
        const engine = new FortressStateEngine(mainModeForTest());
        const updates = buildUpdates([100000, 100003, 100001, 100090, 100092]);
        const transitions = updates.map((update) => engine.updateOracle(update));

        expect(transitions.map((transition) => transition.oracleState.oracleSecond)).toEqual([
            1710000000,
            1710000001,
            1710000002,
            1710000003,
            1710000004,
        ]);
        expect(transitions.map((transition) => transition.timeAnchorSecond)).toEqual([
            1710000000,
            1710000000,
            1710000000,
            1710000000,
            1710000000,
        ]);

        const final = transitions[transitions.length - 1];
        expect(final.modeState.vEwma).toBeCloseTo(2.684978513028932e-8, 20);
        expect(final.modeState.sigmaRaw).toBeCloseTo(0.0001638590404289288, 18);
        expect(final.modeState.sigma).toBeCloseTo(0.0001638590404289288, 18);
        expect(final.kappa).toBe(6);
        expect(final.modeState.lambdaIntensity).toBeCloseTo(0.02, 15);
        expect(final.bandWidthDecision.finalBandWidth).toBe(20);
        expect(final.modeState.bandWidthCurrent).toBe(20);
        expect(final.geometry.bandWidth).toBe(20);
        expect(final.modeState.jumpFlag).toBe(false);
        expect(final.modeState.atrMean).toBe(22.6);
        expect(final.modeState.jumpSampler.magnitudes).toHaveLength(0);
        expect(final.modeState.jumpSampler.signs).toEqual([]);
        expect(final.oracleState).toEqual({
            oracleSecond: 1710000004,
            price: 100092,
            sigmaByMode: { '5': final.modeState.sigma },
            lambdaByMode: { '5': final.modeState.lambdaIntensity },
            jumpFlagByMode: { '5': false },
        });
    });

    it('keeps sigma and price scaling disabled on the default main path', () => {
        const engine = new FortressStateEngine(mainModeForTest());
        const transition = engine.updateOracle(buildUpdates([100000, 100500])[1]);

        expect(FORTRESS_GLOBAL_CONFIG.useSigmaScaling).toBe(false);
        expect(FORTRESS_GLOBAL_CONFIG.usePriceScaling).toBe(false);
        expect(transition.modeState.sigma).toBe(transition.modeState.sigmaRaw);
    });

    it('can update oracle volatility and jump state without running pricing', () => {
        const engine = new FortressStateEngine(mainModeForTest());
        const transition = engine.updateOracle(buildUpdates([100000, 100500])[1], {
            runPricing: false,
        });

        expect(transition.runPricing).toBe(false);
        expect(transition.bandWidthDecision).toBeNull();
        expect(transition.geometry).toBeNull();
        expect(engine.getGeometry()).toBeNull();
        expect(transition.oracleState).toMatchObject({
            oracleSecond: 1710000001,
            price: 100500,
        });
        expect(transition.modeState.sigma).toBeGreaterThan(0);
        expect(transition.modeState.lambdaIntensity).toBeGreaterThan(0);
        expect(transition.modeState.bandWidthCurrent).toBe(FORTRESS_MAIN_MODE.bandWidth);
    });

    it('records non-zero returns in the jump sampler when adaptive kappa is breached', () => {
        const engine = new FortressStateEngine({
            ...mainModeForTest(),
            kappa0: 1,
            kappaMin: 1,
            kappaMax: 2,
        });

        const transition = engine.updateOracle(buildUpdates([100000, 100500])[1]);

        expect(transition.modeState.jumpFlag).toBe(true);
        expect(transition.bandWidthDecision.finalBandWidth).toBe(20);
        expect(transition.modeState.jumpSampler.magnitudes).toEqual([
            Math.abs(Math.log(100500 / 100000)),
        ]);
        expect(transition.modeState.jumpSampler.signs).toEqual([1]);
        expect(transition.modeState.lambdaIntensity).toBeCloseTo(0.2, 15);
    });

    it('matches helper formulas from the Python engine', () => {
        expect(computeTrueRange(100095, 100000, 100001)).toBe(95);
        expect(computeParkinsonVariance(100095, 100000)).toBeCloseTo(3.251991049931517e-7, 18);
        expect(computeHawkesBandwidthFactor(5, FORTRESS_GLOBAL_CONFIG.epsilon)).toBe(1);
        expect(computeHawkesBandwidthFactor(2.5, FORTRESS_GLOBAL_CONFIG.epsilon)).toBeCloseTo(
            Math.exp(-2),
            15,
        );
    });

    function buildUpdates(closes: number[]): FortressOracleUpdate[] {
        const highs = [100002, 100004, 100003, 100095, 100094];
        const lows = [99998, 100001, 99999, 100000, 100088];
        return closes.map((close, index) => {
            const previousClose = index === 0 ? undefined : closes[index - 1];
            const logReturn = previousClose === undefined ? 0 : Math.log(close / previousClose);
            return {
                bar: {
                    oracleSecond: 1710000000 + index,
                    open: close,
                    high: highs[index] ?? close,
                    low: lows[index] ?? close,
                    close,
                    volume: 1,
                },
                previousClose,
                logReturn,
                volatilityObservation: logReturn * logReturn,
                timeAnchorSecond: 5 * Math.floor((1710000000 + index) / 5),
            };
        });
    }

    function mainModeForTest() {
        return {
            ...FORTRESS_MAIN_MODE,
            mcNMin: 16,
            mcNMax: 16,
        };
    }
});

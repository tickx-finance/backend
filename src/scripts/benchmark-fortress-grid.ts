import * as dotenv from 'dotenv';
import { performance } from 'perf_hooks';
import {
    FORTRESS_GLOBAL_CONFIG,
    FORTRESS_MAIN_MODE,
} from 'src/modules/grid/fortress-engine/fortress.config';
import { FortressStateEngine } from 'src/modules/grid/fortress-engine/fortress-state-engine';
import { FortressOracleUpdate } from 'src/modules/grid/fortress-engine/fortress.types';
import { buildFortressQuotes } from 'src/modules/grid/fortress-engine/fortress-quote-builder';
import { mapFortressQuotesToCells } from 'src/modules/grid/fortress-engine/fortress-cell.mapper';
import { computeFortressAdaptivePWinMatrix } from 'src/modules/grid/fortress-engine/fortress-adaptive-mc';

dotenv.config();

const ITERATIONS = intEnv('ITERATIONS', 10);
const WARMUP_TICKS = intEnv('WARMUP_TICKS', 120);
const PRICE = numberEnv('PRICE', 100_000);
const MC_N = optionalIntEnv('MC_N');
const MC_N_MIN = intEnv('MC_N_MIN', FORTRESS_MAIN_MODE.mcNMin);
const MC_N_MAX = intEnv('MC_N_MAX', FORTRESS_MAIN_MODE.mcNMax);
const ADAPTIVE_MC = boolEnv('ADAPTIVE_MC', MC_N === undefined);
const CELL_SIGNER_KEY = process.env.CELL_SIGNER_KEY || 'benchmark-cell-signer-key';

async function main() {
    const mode = {
        ...FORTRESS_MAIN_MODE,
        mcNMin: MC_N ?? MC_N_MIN,
        mcNMax: MC_N ?? MC_N_MAX,
        adaptiveMc: ADAPTIVE_MC,
    };
    const engine = new FortressStateEngine(mode, FORTRESS_GLOBAL_CONFIG);
    const priceSeries = buildPriceSeries(PRICE, WARMUP_TICKS + ITERATIONS + 2);
    let previousClose: number | undefined;

    for (let i = 0; i < WARMUP_TICKS; i += 1) {
        const update = makeOracleUpdate(1_710_000_000 + i, priceSeries[i], previousClose);
        previousClose = update.bar.close;
        engine.updateOracle(update, { runPricing: false });
    }

    const samples: BenchmarkSample[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
        const oracleSecond = 1_710_000_000 + WARMUP_TICKS + i;
        const update = makeOracleUpdate(oracleSecond, priceSeries[WARMUP_TICKS + i], previousClose);
        previousClose = update.bar.close;

        const t0 = performance.now();
        const transition = engine.updateOracle(update, {
            runPricing: true,
            refreshBandWidth: true,
        });
        const tState = performance.now();

        if (!transition.geometry) {
            throw new Error('Fortress pricing transition did not produce geometry');
        }

        const horizon = Math.max(...mode.windows.map(([, endSecond]) => endSecond))
            + Math.max(0, FORTRESS_GLOBAL_CONFIG.lockOffset);
        const pwin = computeFortressAdaptivePWinMatrix({
            price: update.bar.close,
            horizon,
            geometry: transition.geometry,
            mode,
            config: FORTRESS_GLOBAL_CONFIG,
            modeState: transition.modeState,
            oracleSecond,
        });
        const tPwin = performance.now();

        const { quotes } = buildFortressQuotes({
            geometry: transition.geometry,
            mode,
            config: FORTRESS_GLOBAL_CONFIG,
            modeState: transition.modeState,
            pRawByCellId: pwin.pRawByCellId,
        });
        const cells = mapFortressQuotesToCells(quotes, {
            privateKey: CELL_SIGNER_KEY,
        });
        const tDone = performance.now();

        samples.push({
            totalMs: tDone - t0,
            stateMs: tState - t0,
            pathsAndPwinMs: tPwin - tState,
            quotesMs: tDone - tPwin,
            cells: cells.length,
            quotes: quotes.length,
            bandWidth: transition.geometry.bandWidth,
            action: transition.bandWidthDecision?.action ?? 'none',
            pathsUsed: pwin.pathsUsed,
            batches: pwin.batches,
            converged: pwin.converged,
            maxStandardError: pwin.maxStandardError,
            maxRelativeError: pwin.maxRelativeError,
        });
    }

    printReport(samples);
}

function makeOracleUpdate(
    oracleSecond: number,
    close: number,
    previousClose?: number,
): FortressOracleUpdate {
    const logReturn = previousClose === undefined ? 0 : Math.log(close / previousClose);
    const wiggle = Math.max(1, close * 0.00005);
    return {
        bar: {
            oracleSecond,
            open: previousClose ?? close,
            high: Math.max(close, previousClose ?? close) + wiggle,
            low: Math.min(close, previousClose ?? close) - wiggle,
            close,
            volume: 1,
        },
        previousClose,
        logReturn,
        volatilityObservation: logReturn * logReturn,
        timeAnchorSecond: 5 * Math.floor(oracleSecond / 5),
    };
}

function buildPriceSeries(basePrice: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => {
        const slow = Math.sin(i / 9) * basePrice * 0.00025;
        const fast = Math.sin(i / 3) * basePrice * 0.00008;
        const drift = i * basePrice * 0.000001;
        return basePrice + slow + fast + drift;
    });
}

function printReport(samples: BenchmarkSample[]) {
    const totals = samples.map((sample) => sample.totalMs);
    const state = samples.map((sample) => sample.stateMs);
    const pwin = samples.map((sample) => sample.pathsAndPwinMs);
    const quotes = samples.map((sample) => sample.quotesMs);
    const last = samples[samples.length - 1];

    console.log('--- Fortress Grid Pricing Benchmark ---');
    console.log(`iterations=${ITERATIONS} warmupTicks=${WARMUP_TICKS} adaptiveMc=${ADAPTIVE_MC} mcNMin=${MC_N ?? MC_N_MIN} mcNMax=${MC_N ?? MC_N_MAX}`);
    console.log(`quotes=${last.quotes} signedCells=${last.cells} lastBandWidth=${last.bandWidth} lastAction=${last.action}`);
    console.log(`pathsUsed=${last.pathsUsed} batches=${last.batches} converged=${last.converged} maxSE=${last.maxStandardError.toFixed(6)} maxRelErr=${last.maxRelativeError.toFixed(6)}`);
    console.log(`total_ms  avg=${avg(totals).toFixed(2)} p50=${percentile(totals, 0.50).toFixed(2)} p95=${percentile(totals, 0.95).toFixed(2)} max=${Math.max(...totals).toFixed(2)}`);
    console.log(`state_ms  avg=${avg(state).toFixed(2)} p95=${percentile(state, 0.95).toFixed(2)}`);
    console.log(`pwin_ms   avg=${avg(pwin).toFixed(2)} p95=${percentile(pwin, 0.95).toFixed(2)}`);
    console.log(`quotes_ms avg=${avg(quotes).toFixed(2)} p95=${percentile(quotes, 0.95).toFixed(2)}`);
}

function avg(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
    return sorted[index];
}

function intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : fallback;
}

function optionalIntEnv(name: string): number | undefined {
    const raw = process.env[name];
    if (!raw) return undefined;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : undefined;
}

function numberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (!raw) return fallback;
    return raw === 'true' || raw === '1';
}

interface BenchmarkSample {
    totalMs: number;
    stateMs: number;
    pathsAndPwinMs: number;
    quotesMs: number;
    cells: number;
    quotes: number;
    bandWidth: number;
    action: string;
    pathsUsed: number;
    batches: number;
    converged: boolean;
    maxStandardError: number;
    maxRelativeError: number;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

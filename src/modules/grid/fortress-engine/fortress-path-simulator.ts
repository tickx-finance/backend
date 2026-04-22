import { FORTRESS_GLOBAL_CONFIG } from './fortress.config';
import {
    FortressJumpSamplerState,
    FortressPathSimulationInput,
    FortressPathSimulationResult,
} from './fortress.types';
import { FortressRandom } from './fortress-rng';

export function simulateFortressPaths(
    input: FortressPathSimulationInput,
): FortressPathSimulationResult {
    const pathCount = Math.trunc(input.pathCount);
    const horizon = Math.trunc(input.horizon);
    if (pathCount <= 0 || horizon <= 0) {
        return {
            paths: [],
            returns: [],
            jumpCount: 0,
            pJump: 0,
        };
    }

    const rng = new FortressRandom(input.seedParts);
    const useAntithetic = input.useAntithetic ?? FORTRESS_GLOBAL_CONFIG.useAntithetic;
    const mu = input.mu ?? FORTRESS_GLOBAL_CONFIG.mu;
    const epsilon = input.epsilon ?? FORTRESS_GLOBAL_CONFIG.epsilon;
    const eps = generateNormalMatrix(pathCount, horizon, rng, useAntithetic);
    const drift = mu - 0.5 * input.sigma ** 2;
    const returns = eps.map((row) => row.map((value) => Math.fround(drift + input.sigma * value)));
    const pJump = input.lambdaIntensity > 0
        ? 1 - Math.exp(-input.lambdaIntensity)
        : 0;
    const jumpCount = pJump > 0
        ? applyHawkesJumps(returns, pJump, input.jumpSampler, input.sigma, rng, useAntithetic)
        : 0;

    const logStart = Math.log(Math.max(input.price, epsilon));
    const paths = returns.map((row) => {
        const path = [Math.fround(input.price)];
        let cumulative = 0;
        for (const value of row) {
            cumulative = Math.fround(cumulative + value);
            path.push(Math.fround(Math.exp(Math.fround(logStart + cumulative))));
        }
        return path;
    });

    return {
        paths,
        returns,
        jumpCount,
        pJump,
    };
}

export function generateFortressSeedParts(
    seed: number | undefined,
    modeId: string,
    oracleSecond: number,
    price: number,
): readonly unknown[] {
    return ['fortress_engine_mc', seed, modeId, oracleSecond, price];
}

function generateNormalMatrix(
    pathCount: number,
    horizon: number,
    rng: FortressRandom,
    useAntithetic: boolean,
): number[][] {
    if (!useAntithetic || pathCount === 1) {
        return Array.from({ length: pathCount }, () => generateNormalRow(horizon, rng));
    }

    const baseCount = Math.ceil(pathCount / 2);
    const base = Array.from({ length: baseCount }, () => generateNormalRow(horizon, rng));
    const anti = base.slice(0, Math.floor(pathCount / 2)).map((row) => row.map((value) => -value));
    return [...base, ...anti];
}

function generateNormalRow(horizon: number, rng: FortressRandom): number[] {
    return Array.from({ length: horizon }, () => Math.fround(rng.normal()));
}

function applyHawkesJumps(
    returns: number[][],
    pJump: number,
    jumpSampler: FortressJumpSamplerState,
    fallbackSigma: number,
    rng: FortressRandom,
    useAntithetic: boolean,
): number {
    const pathCount = returns.length;
    const horizon = returns[0]?.length ?? 0;

    if (!useAntithetic || pathCount === 1) {
        let jumpCount = 0;
        for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
            for (let step = 0; step < horizon; step += 1) {
                if (rng.next() < pJump) {
                    returns[pathIndex][step] = Math.fround(
                        returns[pathIndex][step] + sampleJump(jumpSampler, fallbackSigma, rng),
                    );
                    jumpCount += 1;
                }
            }
        }
        return jumpCount;
    }

    const baseCount = Math.ceil(pathCount / 2);
    const antiCount = Math.floor(pathCount / 2);
    const baseJumps: number[][] = Array.from(
        { length: baseCount },
        () => Array.from({ length: horizon }, () => 0),
    );
    let jumpCount = 0;

    for (let pathIndex = 0; pathIndex < baseCount; pathIndex += 1) {
        for (let step = 0; step < horizon; step += 1) {
            if (rng.next() < pJump) {
                baseJumps[pathIndex][step] = sampleJump(jumpSampler, fallbackSigma, rng);
                jumpCount += 1;
            }
        }
    }

    for (let pathIndex = 0; pathIndex < baseCount; pathIndex += 1) {
        for (let step = 0; step < horizon; step += 1) {
            returns[pathIndex][step] = Math.fround(returns[pathIndex][step] + baseJumps[pathIndex][step]);
        }
    }
    for (let pathIndex = 0; pathIndex < antiCount; pathIndex += 1) {
        for (let step = 0; step < horizon; step += 1) {
            returns[baseCount + pathIndex][step] = Math.fround(
                returns[baseCount + pathIndex][step] + baseJumps[pathIndex][step],
            );
        }
    }

    return jumpCount;
}

function sampleJump(
    jumpSampler: FortressJumpSamplerState,
    fallbackSigma: number,
    rng: FortressRandom,
): number {
    const magnitude = jumpSampler.magnitudes.length > 0
        ? jumpSampler.magnitudes[rng.integer(jumpSampler.magnitudes.length)]
        : Math.abs(rng.normal() * fallbackSigma);

    if (jumpSampler.signs.length > 0) {
        const positiveCount = jumpSampler.signs.filter((sign) => sign > 0).length;
        const pUp = (positiveCount + 1) / (jumpSampler.signs.length + 2);
        return rng.next() < pUp ? magnitude : -magnitude;
    }

    return rng.next() < 0.5 ? -magnitude : magnitude;
}

import { describe, expect, it } from 'vitest';
import {
    generateFortressSeedParts,
    simulateFortressPaths,
} from './fortress-path-simulator';
import { formatSeedPart, stableSeed } from './fortress-rng';

describe('Fortress path simulator', () => {
    it('formats seed parts and derives a stable Node seed', () => {
        expect(formatSeedPart(undefined)).toBe('<none>');
        expect(formatSeedPart(null)).toBe('<none>');
        expect(formatSeedPart(100092)).toBe('100092');
        expect(formatSeedPart(0.000123456789123)).toBe('0.000123456789123');
        expect(stableSeed(['fortress_engine_mc', undefined, '5', 1710000007, 100092])).toBe(
            13352012567979830167n,
        );
    });

    it('generates deterministic antithetic GBM paths with a start column', () => {
        const seedParts = generateFortressSeedParts(undefined, '5', 1710000007, 100092);
        const first = simulateFortressPaths({
            price: 100092,
            pathCount: 5,
            horizon: 4,
            sigma: 0.0001638590404289288,
            lambdaIntensity: 0,
            jumpSampler: {
                magnitudes: [],
                signs: [],
                maxSamples: 5000,
            },
            seedParts,
            useAntithetic: true,
        });
        const second = simulateFortressPaths({
            price: 100092,
            pathCount: 5,
            horizon: 4,
            sigma: 0.0001638590404289288,
            lambdaIntensity: 0,
            jumpSampler: {
                magnitudes: [],
                signs: [],
                maxSamples: 5000,
            },
            seedParts,
            useAntithetic: true,
        });

        expect(second).toEqual(first);
        expect(first.paths).toHaveLength(5);
        expect(first.paths[0]).toHaveLength(5);
        expect(first.paths.every((path) => path[0] === Math.fround(100092))).toBe(true);
        expect(first.returns[0][0] + first.returns[3][0]).toBeCloseTo(
            Math.fround(-(0.0001638590404289288 ** 2)),
            10,
        );
        expect(first.returns[1][2] + first.returns[4][2]).toBeCloseTo(
            Math.fround(-(0.0001638590404289288 ** 2)),
            10,
        );
        expect(first.jumpCount).toBe(0);
        expect(first.pJump).toBe(0);
        expect(first.paths[0].slice(0, 3)).toEqual([
            100092,
            100072.28125,
            100086.5078125,
        ]);
    });

    it('applies Hawkes jumps symmetrically to antithetic paired paths', () => {
        const result = simulateFortressPaths({
            price: 100092,
            pathCount: 4,
            horizon: 3,
            sigma: 0.0001,
            lambdaIntensity: 10,
            jumpSampler: {
                magnitudes: [0.001],
                signs: [1],
                maxSamples: 5000,
            },
            seedParts: ['jump-test', 1],
            useAntithetic: true,
        });

        expect(result.pJump).toBeCloseTo(1 - Math.exp(-10), 15);
        expect(result.jumpCount).toBe(6);
        for (let step = 0; step < 3; step += 1) {
            const driftTwice = Math.fround(-(0.0001 ** 2));
            const pairedSum = Math.fround(result.returns[0][step] + result.returns[2][step]);
            expect(pairedSum).toBeCloseTo(Math.fround(2 * 0.001 + driftTwice), 10);
        }
    });

    it('returns empty matrices for empty simulation dimensions', () => {
        expect(simulateFortressPaths({
            price: 100092,
            pathCount: 0,
            horizon: 65,
            sigma: 0.1,
            lambdaIntensity: 0,
            jumpSampler: {
                magnitudes: [],
                signs: [],
                maxSamples: 5000,
            },
            seedParts: ['empty'],
        })).toEqual({
            paths: [],
            returns: [],
            jumpCount: 0,
            pJump: 0,
        });
    });
});

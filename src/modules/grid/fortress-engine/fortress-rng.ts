import * as crypto from 'crypto';

export class FortressRandom {
    private state: bigint;
    private spareNormal?: number;

    constructor(seedParts: readonly unknown[]) {
        this.state = stableSeed(seedParts);
        if (this.state === 0n) {
            this.state = 0x9e3779b97f4a7c15n;
        }
    }

    next(): number {
        const value = this.nextUint64();
        return Number(value >> 11n) / 2 ** 53;
    }

    normal(): number {
        if (this.spareNormal !== undefined) {
            const value = this.spareNormal;
            this.spareNormal = undefined;
            return value;
        }

        const u1 = Math.max(this.next(), Number.MIN_VALUE);
        const u2 = this.next();
        const radius = Math.sqrt(-2 * Math.log(u1));
        const theta = 2 * Math.PI * u2;
        this.spareNormal = radius * Math.sin(theta);
        return radius * Math.cos(theta);
    }

    integer(maxExclusive: number): number {
        if (maxExclusive <= 0) {
            throw new Error(`Invalid random integer bound: ${maxExclusive}`);
        }

        return Math.floor(this.next() * maxExclusive);
    }

    private nextUint64(): bigint {
        this.state = (this.state + 0x9e3779b97f4a7c15n) & UINT64_MASK;
        let z = this.state;
        z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & UINT64_MASK;
        z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & UINT64_MASK;
        return (z ^ (z >> 31n)) & UINT64_MASK;
    }
}

export function stableSeed(seedParts: readonly unknown[]): bigint {
    const payload = seedParts.map(formatSeedPart).join('|');
    const digest = crypto.createHash('blake2b512').update(payload).digest();
    return digest.readBigUInt64LE(0);
}

export function formatSeedPart(part: unknown): string {
    if (part === null || part === undefined) {
        return '<none>';
    }
    if (typeof part === 'number') {
        if (!Number.isFinite(part)) {
            return String(part);
        }
        return formatPythonGeneralFloat(part, 12);
    }

    return String(part);
}

function formatPythonGeneralFloat(value: number, precision: number): string {
    const absValue = Math.abs(value);
    if (absValue !== 0 && (absValue < 1e-4 || absValue >= 10 ** precision)) {
        return trimExponent(value.toExponential(precision - 1));
    }

    return trimFixed(value.toPrecision(precision));
}

function trimFixed(value: string): string {
    if (!value.includes('.')) {
        return value;
    }

    return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function trimExponent(value: string): string {
    return value
        .replace(/(\.\d*?)0+e/, '$1e')
        .replace(/\.e/, 'e')
        .replace(/e\+?(-?)0*(\d+)/, 'e$1$2');
}

const UINT64_MASK = (1n << 64n) - 1n;

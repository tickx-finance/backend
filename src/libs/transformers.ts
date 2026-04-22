import { ValueTransformer } from 'typeorm';

/**
 * Transforms bigint <-> number (milliseconds since epoch)
 *
 * DB: BIGINT
 * Entity: number (ms)
 */
export const BigIntMsTransformer: ValueTransformer = {
    to(value?: number): string | null {
        if (value === undefined || value === null) return null;

        // Ensure integer milliseconds
        if (!Number.isSafeInteger(value)) {
            throw new Error(`Timestamp must be an integer ms, got: ${value}`);
        }

        return value.toString(); // number -> bigint
    },

    from(value?: string): number | null {
        if (value === undefined || value === null) return null;

        const n = Number(value);

        if (!Number.isSafeInteger(n)) {
            throw new Error(`BigInt value exceeds JS safe integer: ${value}`);
        }

        return n; // bigint -> number (ms)
    },
};

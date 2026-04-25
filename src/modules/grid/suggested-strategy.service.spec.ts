import { describe, expect, it } from 'vitest';
import { SuggestedStrategyService } from './suggested-strategy.service';

describe('SuggestedStrategyService', () => {
    const service = new SuggestedStrategyService();

    it('clusters suggested cells near the center in low volatility', () => {
        const result = service.buildSuggestedStrategy({
            cells: makeCells(),
            sigma: 0.00003,
            atrMean: 5,
        });

        expect(result.volatilityRegime).toBe('low');
        expect(result.cells.length).toBeGreaterThan(6);
        const minRow = Math.min(...result.cells.map((cell) => Number(cell.lowerPrice)));
        const maxRow = Math.max(...result.cells.map((cell) => Number(cell.lowerPrice)));
        expect(maxRow - minRow).toBeLessThanOrEqual(50);
    });

    it('spreads suggested cells wider in high volatility', () => {
        const result = service.buildSuggestedStrategy({
            cells: makeCells(),
            sigma: 0.0002,
            atrMean: 30,
        });

        expect(result.volatilityRegime).toBe('high');
        const minRow = Math.min(...result.cells.map((cell) => Number(cell.lowerPrice)));
        const maxRow = Math.max(...result.cells.map((cell) => Number(cell.lowerPrice)));
        expect(maxRow - minRow).toBeGreaterThanOrEqual(100);
    });

    it('adds slight randomness across repeated runs', () => {
        const seen = new Set<string>();

        for (let i = 0; i < 12; i += 1) {
            const result = service.buildSuggestedStrategy({
                cells: makeCells(),
                sigma: 0.00003,
                atrMean: 5,
            });
            seen.add(result.cells.map((cell) => `${cell.startTs}:${cell.lowerPrice}`).join('|'));
        }

        expect(seen.size).toBeGreaterThan(1);
    });
});

function makeCells() {
    const cells = [];
    const baseStartTs = 1000;
    const basePrice = 100;
    for (let windowIndex = 0; windowIndex < 4; windowIndex += 1) {
        for (let row = 0; row < 9; row += 1) {
            cells.push({
                gridTs: 1000,
                startTs: baseStartTs + windowIndex * 5000,
                endTs: baseStartTs + (windowIndex + 1) * 5000,
                lowerPrice: String(basePrice + row * 25),
                upperPrice: String(basePrice + (row + 1) * 25),
                rewardRate: '2',
                gridSignature: 'sig',
            });
        }
    }

    return cells;
}

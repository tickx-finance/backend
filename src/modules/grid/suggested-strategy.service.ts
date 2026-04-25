import { Injectable } from '@nestjs/common';
import { Cell } from 'src/libs/cell';
import { FORTRESS_GLOBAL_CONFIG } from './fortress-engine/fortress.config';
import { SuggestedStrategyMessage, SuggestedStrategyVolatilityRegime } from '../socket/types';

@Injectable()
export class SuggestedStrategyService {
    buildSuggestedStrategy(input: {
        cells: Cell[];
        sigma?: number | null;
        atrMean?: number | null;
    }): SuggestedStrategyMessage {
        const sigma = input.sigma ?? null;
        const atrMean = input.atrMean ?? null;
        const volatilityRegime = classifyVolatilityRegime(sigma);

        return {
            cells: selectSuggestedCells(input.cells, volatilityRegime),
            volatilityRegime,
            sigma,
            atrMean,
            timestamp: Date.now(),
        };
    }
}

function classifyVolatilityRegime(sigma: number | null): SuggestedStrategyVolatilityRegime {
    if (sigma === null || !Number.isFinite(sigma)) {
        return 'medium';
    }

    if (sigma <= FORTRESS_GLOBAL_CONFIG.sigmaRef * 1.5) {
        return 'low';
    }

    if (sigma >= FORTRESS_GLOBAL_CONFIG.sigmaRef * 3) {
        return 'high';
    }

    return 'medium';
}

function selectSuggestedCells(
    cells: Cell[],
    volatilityRegime: SuggestedStrategyVolatilityRegime,
): Cell[] {
    if (cells.length === 0) {
        return [];
    }

    const uniqueStartTs = Array.from(new Set(cells.map((cell) => cell.startTs))).sort((a, b) => a - b);
    const targetWindows = volatilityRegime === 'low'
        ? uniqueStartTs.slice(0, 4)
        : uniqueStartTs.slice(0, 3);
    const rows = Array.from(new Set(cells.map((cell) => Number(cell.lowerPrice)))).sort((a, b) => a - b);
    const centerRowIndex = Math.floor(rows.length / 2);

    const candidateRowOffsets = volatilityRegime === 'low'
        ? pickLowVolCandidateRowOffsets()
        : volatilityRegime === 'high'
            ? [-4, -2, 0, 2, 4]
            : [-3, -2, -1, 0, 1, 2, 3];

    const candidateRowValues = candidateRowOffsets
        .map((offset) => rows[centerRowIndex + offset])
        .filter((value): value is number => value !== undefined);

    const selectedCells = cells
        .filter((cell) =>
            targetWindows.includes(cell.startTs)
            && candidateRowValues.includes(Number(cell.lowerPrice)),
        )
        .sort((a, b) => {
            if (a.startTs !== b.startTs) return a.startTs - b.startTs;
            return Number(a.lowerPrice) - Number(b.lowerPrice);
        });

    if (volatilityRegime !== 'high') {
        return addRandomnessToSuggestedCells(
            selectedCells,
            rows,
            centerRowIndex,
            volatilityRegime === 'low' ? 10 : 10,
            volatilityRegime === 'low' ? 0.35 : 0.6,
        );
    }

    // In high vol, spread out instead of stacking every near-center row in each window.
    const spread: Cell[] = [];
    for (const startTs of targetWindows) {
        const windowCells = selectedCells.filter((cell) => cell.startTs === startTs);
        if (windowCells.length === 0) continue;

        const picks = [windowCells[0], windowCells[Math.floor(windowCells.length / 2)], windowCells[windowCells.length - 1]]
            .filter((cell, index, arr) => arr.findIndex((candidate) => candidate.lowerPrice === cell.lowerPrice) === index);
        spread.push(...picks);
    }

    return addRandomnessToSuggestedCells(
        spread,
        rows,
        centerRowIndex,
        9,
        0.8,
    );
}

function addRandomnessToSuggestedCells(
    cells: Cell[],
    rows: number[],
    centerRowIndex: number,
    limit: number,
    noiseScale: number,
): Cell[] {
    if (cells.length <= 1) {
        return cells;
    }

    const rowIndexByValue = new Map(rows.map((value, index) => [value, index]));
    const perWindowBudget = Math.max(1, Math.ceil(limit / Math.max(1, new Set(cells.map((cell) => cell.startTs)).size)));
    const windows = Array.from(new Set(cells.map((cell) => cell.startTs))).sort((a, b) => a - b);
    const picks: Cell[] = [];

    for (const startTs of windows) {
        const windowCells = cells
            .filter((cell) => cell.startTs === startTs)
            .map((cell) => {
                const rowValue = Number(cell.lowerPrice);
                const rowIndex = rowIndexByValue.get(rowValue) ?? centerRowIndex;
                const distanceFromCenter = Math.abs(rowIndex - centerRowIndex);

                return {
                    cell,
                    distanceFromCenter,
                    score: distanceFromCenter + Math.random() * noiseScale,
                };
            })
            .sort((a, b) => {
                if (a.score !== b.score) return a.score - b.score;
                return Number(a.cell.lowerPrice) - Number(b.cell.lowerPrice);
            });

        const candidatePoolSize = Math.min(windowCells.length, perWindowBudget + 2);
        const candidatePool = windowCells.slice(0, candidatePoolSize);
        shuffleInPlace(candidatePool);
        picks.push(...candidatePool.slice(0, Math.min(perWindowBudget, candidatePool.length)).map((entry) => entry.cell));
    }

    return picks
        .slice(0, limit)
        .sort((a, b) => {
            if (a.startTs !== b.startTs) return a.startTs - b.startTs;
            return Number(a.lowerPrice) - Number(b.lowerPrice);
        });
}

function shuffleInPlace<T>(items: T[]) {
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
}

function pickLowVolCandidateRowOffsets(): number[] {
    const variants = [
        [0],
        [-1, 0],
        [0, 1],
        [-1, 0, 1],
    ];

    return variants[Math.floor(Math.random() * variants.length)];
}

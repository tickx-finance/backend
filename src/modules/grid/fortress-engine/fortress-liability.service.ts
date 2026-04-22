import { Injectable } from '@nestjs/common';
import BigNumber from 'bignumber.js';
import { Cell, getCellId } from 'src/libs/cell';
import { normalizePrice } from 'src/libs/market.config';
import { FortressGeometryCell } from './fortress.types';

@Injectable()
export class FortressLiabilityService {
    private readonly byCellKey = new Map<string, BigNumber>();

    recordOrderPlaced(
        cell: Pick<Cell, 'startTs' | 'endTs' | 'lowerPrice' | 'upperPrice'>,
        amount: string,
        rewardRate: string,
    ): void {
        this.add(cell, computeOrderLiability(amount, rewardRate));
    }

    recordOrderSettled(
        cell: Pick<Cell, 'startTs' | 'endTs' | 'lowerPrice' | 'upperPrice'>,
        amount: string,
        rewardRate: string,
    ): void {
        this.add(cell, computeOrderLiability(amount, rewardRate).negated());
    }

    getLiabilitiesByFortressCellId(
        cells: readonly FortressGeometryCell[],
    ): Record<number, number> {
        const liabilities: Record<number, number> = {};
        for (const cell of cells) {
            const liability = this.byCellKey.get(getFortressCellKey(cell));
            if (liability && liability.gt(0)) {
                liabilities[cell.cellId] = liability.toNumber();
            }
        }
        return liabilities;
    }

    getCellLiability(
        cell: Pick<Cell, 'startTs' | 'endTs' | 'lowerPrice' | 'upperPrice'>,
    ): string {
        return (this.byCellKey.get(getCellId(cell as Cell)) ?? new BigNumber(0)).toFixed();
    }

    clear(): void {
        this.byCellKey.clear();
    }

    private add(
        cell: Pick<Cell, 'startTs' | 'endTs' | 'lowerPrice' | 'upperPrice'>,
        delta: BigNumber,
    ): void {
        const key = getCellId(cell as Cell);
        const next = (this.byCellKey.get(key) ?? new BigNumber(0)).plus(delta);
        if (next.lte(0)) {
            this.byCellKey.delete(key);
            return;
        }
        this.byCellKey.set(key, next);
    }
}

export function computeOrderLiability(amount: string, rewardRate: string): BigNumber {
    return new BigNumber(amount).multipliedBy(rewardRate);
}

function getFortressCellKey(cell: FortressGeometryCell): string {
    return [
        secondsToMs(cell.startSecond),
        secondsToMs(cell.endSecond),
        normalizePrice(cell.lowerPrice),
        normalizePrice(cell.upperPrice),
    ].join(':');
}

function secondsToMs(second: number): number {
    return second * 1000;
}

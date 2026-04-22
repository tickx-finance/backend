import { Cell, signCell } from 'src/libs/cell';
import { normalizePrice } from 'src/libs/market.config';
import { FORTRESS_MAIN_MODE } from './fortress.config';
import { FortressQuote } from './fortress.types';

export interface FortressCellMappingOptions {
    privateKey: string;
    rewardRatePrecision?: number;
    windows?: ReadonlyArray<readonly [number, number]>;
}

export function mapFortressQuoteToCell(
    quote: FortressQuote,
    options: FortressCellMappingOptions,
): Cell {
    const rewardRatePrecision = options.rewardRatePrecision ?? 6;
    const windows = options.windows ?? FORTRESS_MAIN_MODE.windows;
    const cell: Cell = {
        gridTs: getFortressGridTsMs(quote, windows),
        startTs: secondsToMs(quote.startSecond),
        endTs: secondsToMs(quote.endSecond),
        lowerPrice: normalizePrice(quote.lowerPrice),
        upperPrice: normalizePrice(quote.upperPrice),
        rewardRate: quote.mFinal.toFixed(rewardRatePrecision),
        gridSignature: '',
    };

    cell.gridSignature = signCell(cell, options.privateKey);
    return cell;
}

export function mapFortressQuotesToCells(
    quotes: FortressQuote[],
    options: FortressCellMappingOptions & { betableOnly?: boolean },
): Cell[] {
    const selectedQuotes = options.betableOnly === false
        ? quotes
        : quotes.filter((quote) => quote.betable);

    return selectedQuotes.map((quote) => mapFortressQuoteToCell(quote, options));
}

export function secondsToMs(second: number): number {
    return second * 1000;
}

export function getFortressGridTsMs(
    quote: Pick<FortressQuote, 'startSecond' | 'windowIndex'>,
    windows: ReadonlyArray<readonly [number, number]> = FORTRESS_MAIN_MODE.windows,
): number {
    const window = windows[quote.windowIndex];
    if (!window) {
        throw new Error(`Invalid Fortress window index: ${quote.windowIndex}`);
    }

    const timeAnchorSecond = quote.startSecond - window[0];
    return secondsToMs(timeAnchorSecond);
}

export interface MarketConfig {
    gridXSize: number; // end_ts - start_ts (in milliseconds)
    // start_ts and end_ts must % gridXSize === 0
    pricePrecision: number;
}

export const defaultMarketConfig: MarketConfig = {
    gridXSize: 5000,
    pricePrecision: 4,
}

export function getSettledStartTs(ts: number): number {
    return ts - (ts % defaultMarketConfig.gridXSize);
}

export function normalizePrice(price: number): string {
    return price.toFixed(defaultMarketConfig.pricePrecision);
}
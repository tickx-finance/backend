export interface MarketConfig {
    gridXSize: number; // end_ts - start_ts (in milliseconds)
    // start_ts and end_ts must % gridXSize === 0
}

export const defaultMarketConfig: MarketConfig = {
    gridXSize: 5000,
}

export function getSettledStartTs(ts: number): number {
    return ts - (ts % defaultMarketConfig.gridXSize);
}

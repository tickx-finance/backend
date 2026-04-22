import { Injectable } from '@nestjs/common';
import { LatestPriceState } from 'src/libs/price-tick';
import {
    FortressOracleBar,
    FortressOracleTick,
    FortressOracleUpdate,
} from './fortress.types';

const DEFAULT_TIME_ANCHOR_SECONDS = 5;

@Injectable()
export class GridOracleStateService {
    private currentBar?: MutableOracleBar;
    private lastClosedBar?: FortressOracleBar;
    private lastUpdate?: FortressOracleUpdate;
    private lastTradeId?: number;

    ingestLatestTrade(trade: LatestPriceState): FortressOracleUpdate[] {
        if (this.lastTradeId !== undefined && trade.tradeId <= this.lastTradeId) {
            return [];
        }

        this.lastTradeId = trade.tradeId;
        return this.ingestTick({
            timestampMs: trade.ts,
            price: trade.price,
            volume: trade.qty,
            tradeId: trade.tradeId,
        });
    }

    ingestTick(tick: FortressOracleTick): FortressOracleUpdate[] {
        this.assertValidTick(tick);

        const oracleSecond = Math.floor(tick.timestampMs / 1000);
        if (!this.currentBar) {
            this.currentBar = this.createMutableBar(oracleSecond, tick.price, tick.volume);
            return [];
        }

        if (oracleSecond < this.currentBar.oracleSecond) {
            return [];
        }

        if (oracleSecond === this.currentBar.oracleSecond) {
            this.applyTickToCurrentBar(tick);
            return [];
        }

        const updates: FortressOracleUpdate[] = [];
        const closedBar = this.freezeBar(this.currentBar);
        updates.push(this.closeBar(closedBar));

        let fillSecond = closedBar.oracleSecond + 1;
        let fillClose = closedBar.close;
        while (fillSecond < oracleSecond) {
            const gapBar: FortressOracleBar = {
                oracleSecond: fillSecond,
                open: fillClose,
                high: fillClose,
                low: fillClose,
                close: fillClose,
                volume: 0,
            };
            updates.push(this.closeBar(gapBar));
            fillClose = gapBar.close;
            fillSecond += 1;
        }

        this.currentBar = this.createMutableBar(oracleSecond, tick.price, tick.volume);
        return updates;
    }

    getCurrentOpenBar(): FortressOracleBar | null {
        return this.currentBar ? this.freezeBar(this.currentBar) : null;
    }

    getLastClosedBar(): FortressOracleBar | null {
        return this.lastClosedBar ?? null;
    }

    getLastUpdate(): FortressOracleUpdate | null {
        return this.lastUpdate ?? null;
    }

    reset(): void {
        this.currentBar = undefined;
        this.lastClosedBar = undefined;
        this.lastUpdate = undefined;
        this.lastTradeId = undefined;
    }

    private closeBar(bar: FortressOracleBar): FortressOracleUpdate {
        const previousClose = this.lastClosedBar?.close;
        const logReturn = computeCloseToCloseLogReturn(bar.close, previousClose);
        const update: FortressOracleUpdate = {
            bar,
            previousClose,
            logReturn,
            volatilityObservation: logReturn * logReturn,
            timeAnchorSecond: getFortressTimeAnchorSecond(bar.oracleSecond),
        };

        this.lastClosedBar = bar;
        this.lastUpdate = update;
        return update;
    }

    private createMutableBar(
        oracleSecond: number,
        price: number,
        volume = 0,
    ): MutableOracleBar {
        return {
            oracleSecond,
            open: price,
            high: price,
            low: price,
            close: price,
            volume,
        };
    }

    private applyTickToCurrentBar(tick: FortressOracleTick): void {
        if (!this.currentBar) return;

        this.currentBar.high = Math.max(this.currentBar.high, tick.price);
        this.currentBar.low = Math.min(this.currentBar.low, tick.price);
        this.currentBar.close = tick.price;
        this.currentBar.volume += tick.volume ?? 0;
    }

    private freezeBar(bar: MutableOracleBar): FortressOracleBar {
        return {
            oracleSecond: bar.oracleSecond,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
        };
    }

    private assertValidTick(tick: FortressOracleTick): void {
        if (!Number.isFinite(tick.timestampMs) || tick.timestampMs < 0) {
            throw new Error(`Invalid Fortress oracle tick timestamp: ${tick.timestampMs}`);
        }
        if (!Number.isFinite(tick.price) || tick.price <= 0) {
            throw new Error(`Invalid Fortress oracle tick price: ${tick.price}`);
        }
        if (tick.volume !== undefined && (!Number.isFinite(tick.volume) || tick.volume < 0)) {
            throw new Error(`Invalid Fortress oracle tick volume: ${tick.volume}`);
        }
    }
}

export function getFortressTimeAnchorSecond(
    oracleSecond: number,
    stepSeconds = DEFAULT_TIME_ANCHOR_SECONDS,
): number {
    return stepSeconds * Math.floor(oracleSecond / stepSeconds);
}

export function computeCloseToCloseLogReturn(
    close: number,
    previousClose?: number,
): number {
    if (previousClose === undefined) {
        return 0;
    }

    return Math.log(close / previousClose);
}

interface MutableOracleBar extends FortressOracleBar {}

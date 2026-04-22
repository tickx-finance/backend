export interface FortressPricingCadenceDecision {
    closedTickCount: number;
    runPricing: boolean;
    refreshBandWidth: boolean;
    reason: 'warmup' | 'initial-width' | 'refresh' | 'pricing';
}

export class FortressPricingCadence {
    private closedTickCount = 0;
    private lastBandWidthRefreshTick = 0;

    constructor(
        private readonly warmupTicks = 100,
        private readonly refreshTicks = 3600,
    ) { }

    next(): FortressPricingCadenceDecision {
        this.closedTickCount += 1;

        if (this.closedTickCount <= this.warmupTicks) {
            const refreshBandWidth = this.closedTickCount === this.warmupTicks;
            if (refreshBandWidth) {
                this.lastBandWidthRefreshTick = this.closedTickCount;
            }
            return {
                closedTickCount: this.closedTickCount,
                runPricing: true,
                refreshBandWidth,
                reason: refreshBandWidth ? 'initial-width' : 'warmup',
            };
        }

        if (this.closedTickCount - this.lastBandWidthRefreshTick >= this.refreshTicks) {
            this.lastBandWidthRefreshTick = this.closedTickCount;
            return {
                closedTickCount: this.closedTickCount,
                runPricing: true,
                refreshBandWidth: true,
                reason: 'refresh',
            };
        }

        return {
            closedTickCount: this.closedTickCount,
            runPricing: true,
            refreshBandWidth: false,
            reason: 'pricing',
        };
    }

    reset(): void {
        this.closedTickCount = 0;
        this.lastBandWidthRefreshTick = 0;
    }
}

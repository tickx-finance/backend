export interface FortressPricingCadenceDecision {
    closedTickCount: number;
    runPricing: boolean;
    refreshBandWidth: boolean;
    reason: 'warmup' | 'initial-width' | 'refresh' | 'state-only';
}

export class FortressPricingCadence {
    private closedTickCount = 0;
    private lastPricingTick = 0;

    constructor(
        private readonly warmupTicks = 100,
        private readonly refreshTicks = 3600,
    ) { }

    next(): FortressPricingCadenceDecision {
        this.closedTickCount += 1;

        if (this.closedTickCount <= this.warmupTicks) {
            const refreshBandWidth = this.closedTickCount === this.warmupTicks;
            if (refreshBandWidth) {
                this.lastPricingTick = this.closedTickCount;
            }
            return {
                closedTickCount: this.closedTickCount,
                runPricing: true,
                refreshBandWidth,
                reason: refreshBandWidth ? 'initial-width' : 'warmup',
            };
        }

        if (this.closedTickCount - this.lastPricingTick >= this.refreshTicks) {
            this.lastPricingTick = this.closedTickCount;
            return {
                closedTickCount: this.closedTickCount,
                runPricing: true,
                refreshBandWidth: true,
                reason: 'refresh',
            };
        }

        return {
            closedTickCount: this.closedTickCount,
            runPricing: false,
            refreshBandWidth: false,
            reason: 'state-only',
        };
    }

    reset(): void {
        this.closedTickCount = 0;
        this.lastPricingTick = 0;
    }
}

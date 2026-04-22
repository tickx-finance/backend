import { describe, expect, it } from 'vitest';
import { FortressPricingCadence } from './fortress-pricing-cadence';

describe('FortressPricingCadence', () => {
    it('runs pricing during warmup and then on refresh cadence', () => {
        const cadence = new FortressPricingCadence(3, 5);

        expect(cadence.next()).toEqual({ closedTickCount: 1, runPricing: true, refreshBandWidth: false, reason: 'warmup' });
        expect(cadence.next()).toEqual({ closedTickCount: 2, runPricing: true, refreshBandWidth: false, reason: 'warmup' });
        expect(cadence.next()).toEqual({ closedTickCount: 3, runPricing: true, refreshBandWidth: true, reason: 'initial-width' });
        expect(cadence.next()).toEqual({ closedTickCount: 4, runPricing: false, refreshBandWidth: false, reason: 'state-only' });
        expect(cadence.next()).toEqual({ closedTickCount: 5, runPricing: false, refreshBandWidth: false, reason: 'state-only' });
        expect(cadence.next()).toEqual({ closedTickCount: 6, runPricing: false, refreshBandWidth: false, reason: 'state-only' });
        expect(cadence.next()).toEqual({ closedTickCount: 7, runPricing: false, refreshBandWidth: false, reason: 'state-only' });
        expect(cadence.next()).toEqual({ closedTickCount: 8, runPricing: true, refreshBandWidth: true, reason: 'refresh' });
    });

    it('supports zero warmup for tests and shadow state-only modes', () => {
        const cadence = new FortressPricingCadence(0, 2);

        expect(cadence.next()).toEqual({ closedTickCount: 1, runPricing: false, refreshBandWidth: false, reason: 'state-only' });
        expect(cadence.next()).toEqual({ closedTickCount: 2, runPricing: true, refreshBandWidth: true, reason: 'refresh' });
    });
});

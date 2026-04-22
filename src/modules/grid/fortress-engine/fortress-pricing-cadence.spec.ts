import { describe, expect, it } from 'vitest';
import { FortressPricingCadence } from './fortress-pricing-cadence';

describe('FortressPricingCadence', () => {
    it('runs pricing every tick and refreshes band width on cadence', () => {
        const cadence = new FortressPricingCadence(3, 5);

        expect(cadence.next()).toEqual({ closedTickCount: 1, runPricing: true, refreshBandWidth: false, reason: 'warmup' });
        expect(cadence.next()).toEqual({ closedTickCount: 2, runPricing: true, refreshBandWidth: false, reason: 'warmup' });
        expect(cadence.next()).toEqual({ closedTickCount: 3, runPricing: true, refreshBandWidth: true, reason: 'initial-width' });
        expect(cadence.next()).toEqual({ closedTickCount: 4, runPricing: true, refreshBandWidth: false, reason: 'pricing' });
        expect(cadence.next()).toEqual({ closedTickCount: 5, runPricing: true, refreshBandWidth: false, reason: 'pricing' });
        expect(cadence.next()).toEqual({ closedTickCount: 6, runPricing: true, refreshBandWidth: false, reason: 'pricing' });
        expect(cadence.next()).toEqual({ closedTickCount: 7, runPricing: true, refreshBandWidth: false, reason: 'pricing' });
        expect(cadence.next()).toEqual({ closedTickCount: 8, runPricing: true, refreshBandWidth: true, reason: 'refresh' });
    });

    it('supports zero warmup for tests', () => {
        const cadence = new FortressPricingCadence(0, 2);

        expect(cadence.next()).toEqual({ closedTickCount: 1, runPricing: true, refreshBandWidth: false, reason: 'pricing' });
        expect(cadence.next()).toEqual({ closedTickCount: 2, runPricing: true, refreshBandWidth: true, reason: 'refresh' });
    });
});

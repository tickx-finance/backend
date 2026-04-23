import { describe, expect, it } from 'vitest';
import {
    computeHumanVerifiedWinSettlement,
    WIN_SETTLEMENT_DECIMAL_PLACES,
} from './human-verified-win-bonus';

describe('computeHumanVerifiedWinSettlement', () => {
    it('keeps base reward rate and payout when bonus is disabled', () => {
        expect(computeHumanVerifiedWinSettlement({
            amount: '100',
            baseRewardRate: '2',
            humanVerified: true,
            bonusRateBps: 0,
        })).toEqual({
            settledRewardRate: '2',
            settledPayout: '200',
            settlementBonusBps: 0,
            settlementHumanVerified: true,
        });
    });

    it('keeps base reward rate and payout for unverified users', () => {
        expect(computeHumanVerifiedWinSettlement({
            amount: '100',
            baseRewardRate: '2',
            humanVerified: false,
            bonusRateBps: 500,
        })).toEqual({
            settledRewardRate: '2',
            settledPayout: '200',
            settlementBonusBps: 0,
            settlementHumanVerified: false,
        });
    });

    it('applies bonus basis points for verified users', () => {
        expect(computeHumanVerifiedWinSettlement({
            amount: '100',
            baseRewardRate: '2',
            humanVerified: true,
            bonusRateBps: 500,
        })).toEqual({
            settledRewardRate: '2.1',
            settledPayout: '210',
            settlementBonusBps: 500,
            settlementHumanVerified: true,
        });
    });

    it('rounds down using the shared settlement precision boundary', () => {
        const result = computeHumanVerifiedWinSettlement({
            amount: '1.234567891',
            baseRewardRate: '1.987654321',
            humanVerified: true,
            bonusRateBps: 333,
        });

        expect(result.settledRewardRate).toBe('2.053843209');
        expect(result.settledPayout).toBe('2.535608878');
        expect(result.settlementBonusBps).toBe(333);
        expect(result.settlementHumanVerified).toBe(true);
        expect(result.settledRewardRate.split('.')[1]).toHaveLength(WIN_SETTLEMENT_DECIMAL_PLACES);
        expect(result.settledPayout.split('.')[1]).toHaveLength(WIN_SETTLEMENT_DECIMAL_PLACES);
    });

    it('normalizes invalid bonus values to zero', () => {
        expect(computeHumanVerifiedWinSettlement({
            amount: '100',
            baseRewardRate: '2',
            humanVerified: true,
            bonusRateBps: Number.NaN,
        })).toEqual({
            settledRewardRate: '2',
            settledPayout: '200',
            settlementBonusBps: 0,
            settlementHumanVerified: true,
        });
    });
});

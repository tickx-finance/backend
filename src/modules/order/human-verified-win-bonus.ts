import BigNumber from 'bignumber.js';

export const WIN_SETTLEMENT_DECIMAL_PLACES = 9;
const BPS_DENOMINATOR = new BigNumber(10000);

export interface ComputeHumanVerifiedWinSettlementInput {
    amount: string;
    baseRewardRate: string;
    humanVerified: boolean;
    bonusRateBps: number;
}

export interface HumanVerifiedWinSettlementResult {
    settledRewardRate: string;
    settledPayout: string;
    settlementBonusBps: number;
    settlementHumanVerified: boolean;
}

export function computeHumanVerifiedWinSettlement(
    input: ComputeHumanVerifiedWinSettlementInput,
): HumanVerifiedWinSettlementResult {
    const amount = new BigNumber(input.amount);
    const baseRewardRate = new BigNumber(input.baseRewardRate);
    const bonusRateBps = normalizeBonusRateBps(input.bonusRateBps);
    const shouldApplyBonus = input.humanVerified && bonusRateBps > 0;

    const bonusMultiplier = shouldApplyBonus
        ? new BigNumber(1).plus(new BigNumber(bonusRateBps).dividedBy(BPS_DENOMINATOR))
        : new BigNumber(1);

    const settledRewardRate = baseRewardRate
        .multipliedBy(bonusMultiplier)
        .decimalPlaces(WIN_SETTLEMENT_DECIMAL_PLACES, BigNumber.ROUND_DOWN);

    const settledPayout = amount
        .multipliedBy(settledRewardRate)
        .decimalPlaces(WIN_SETTLEMENT_DECIMAL_PLACES, BigNumber.ROUND_DOWN);

    return {
        settledRewardRate: settledRewardRate.toFixed(),
        settledPayout: settledPayout.toFixed(),
        settlementBonusBps: shouldApplyBonus ? bonusRateBps : 0,
        settlementHumanVerified: input.humanVerified,
    };
}

function normalizeBonusRateBps(bonusRateBps: number): number {
    if (!Number.isFinite(bonusRateBps) || bonusRateBps <= 0) {
        return 0;
    }

    return Math.floor(bonusRateBps);
}

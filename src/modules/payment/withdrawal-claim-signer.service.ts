import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { env } from 'src/config';
import { PaymentChainClient } from './payment-chain.client';

export interface WithdrawalClaimSignature {
    trader: string;
    amount: string;
    displayAmount: string;
    nonce: string;
    deadline: number;
    signature: string;
    digest: string;
    reservePoolAddress: string;
    quoteAssetAddress: string;
}

@Injectable()
export class WithdrawalClaimSigner {
    constructor(private readonly chainClient: PaymentChainClient) { }

    async signWithdrawalClaim(input: {
        trader: string;
        amount: string;
        deadline: number;
    }): Promise<WithdrawalClaimSignature> {
        const trader = ethers.getAddress(input.trader);
        const decimals = await this.chainClient.getQuoteAssetDecimals();
        const amount = ethers.parseUnits(input.amount, decimals);
        const deadline = BigInt(input.deadline);
        const nonce = await this.chainClient.getTraderNonce(trader);
        const digest = await this.chainClient.getClaimDigest(trader, amount, nonce, deadline);
        const signature = WithdrawalClaimSigner.signDigest(digest, env.payment.claimSignerPrivateKey);

        return {
            trader,
            amount: amount.toString(),
            displayAmount: input.amount,
            nonce: nonce.toString(),
            deadline: input.deadline,
            signature,
            digest,
            reservePoolAddress: env.payment.reservePoolAddress,
            quoteAssetAddress: env.payment.quoteAssetAddress,
        };
    }

    static signDigest(digest: string, privateKey: string): string {
        return new ethers.SigningKey(privateKey).sign(digest).serialized;
    }
}

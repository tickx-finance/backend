import { describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import { PaymentChainReader } from './payment-chain.client';
import { WithdrawalClaimSigner } from './withdrawal-claim-signer.service';

describe('WithdrawalClaimSigner phase 1 primitives', () => {
    it('signs the raw contract claim digest with the configured private key', async () => {
        const signer = ethers.Wallet.createRandom();
        const digest = ethers.keccak256(ethers.toUtf8Bytes('claim-digest'));
        const signature = WithdrawalClaimSigner.signDigest(digest, signer.privateKey);

        expect(ethers.recoverAddress(digest, signature)).toBe(signer.address);
    });

    it('can mock the reserve contract reader surface used by the payment client', async () => {
        const claimSigner = ethers.Wallet.createRandom().address;
        const reader: PaymentChainReader = {
            asset: async () => '0x8603a12c549007a3AFE026EFAD797640Bda30760',
            claimSigner: async () => claimSigner,
            nonces: async () => 7n,
            getClaimDigest: async (trader, amount, nonce, deadline) => {
                return ethers.solidityPackedKeccak256(
                    ['address', 'uint256', 'uint256', 'uint256'],
                    [trader, amount, nonce, deadline],
                );
            },
        };

        const trader = ethers.Wallet.createRandom().address;
        const nonce = await reader.nonces(trader);
        const digest = await reader.getClaimDigest(trader, 100n, nonce, 1234n);

        expect(await reader.claimSigner()).toBe(claimSigner);
        expect(nonce).toBe(7n);
        expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
    });
});

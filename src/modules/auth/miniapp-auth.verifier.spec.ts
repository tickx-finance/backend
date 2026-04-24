import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../libs/worldapp/siwe', () => ({
    verifySiweMessage: vi.fn(),
}));

vi.mock('../../libs/worldapp/worldapp', () => ({
    WorldApp: {
        verifyHuman: vi.fn(),
    },
}));

import { verifySiweMessage } from '../../libs/worldapp/siwe';
import { WorldApp } from '../../libs/worldapp/worldapp';
import { MiniAppAuthVerifier } from './miniapp-auth.verifier';

describe('MiniAppAuthVerifier', () => {
    const verifier = new MiniAppAuthVerifier();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects mini-app login when status is not success', async () => {
        await expect(verifier.verifyLogin('nonce-1', {
            status: 'error',
            message: 'message',
            signature: 'signature',
            address: '0x1111111111111111111111111111111111111111',
            version: 2,
        })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects mini-app login when SIWE verification fails', async () => {
        vi.mocked(verifySiweMessage).mockResolvedValue({
            isValid: false,
            siweMessageData: { address: null },
        } as any);

        await expect(verifier.verifyLogin('nonce-1', {
            status: 'success',
            message: 'message',
            signature: 'signature',
            address: '0x1111111111111111111111111111111111111111',
            version: 2,
        })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns the canonical address when SIWE verification succeeds', async () => {
        vi.mocked(verifySiweMessage).mockResolvedValue({
            isValid: true,
            siweMessageData: { address: '0x1111111111111111111111111111111111111111' },
        } as any);

        await expect(verifier.verifyLogin('nonce-1', {
            status: 'success',
            message: 'message',
            signature: 'signature',
            address: '0x1111111111111111111111111111111111111111',
            version: 2,
        })).resolves.toEqual({
            address: '0x1111111111111111111111111111111111111111',
        });
    });

    it('rejects verify-human when signal does not match address', async () => {
        await expect(verifier.verifyHuman(
            '0x1111111111111111111111111111111111111111',
            {
                action: 'verify-human',
                signal: '0x2222222222222222222222222222222222222222',
                payload: {
                    proof: 'proof',
                    merkle_root: 'root',
                    nullifier_hash: 'nullifier',
                    verification_level: 'orb',
                },
            },
        )).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects verify-human when World App proof verification fails', async () => {
        vi.mocked(WorldApp.verifyHuman).mockResolvedValue(false);

        await expect(verifier.verifyHuman(
            '0x1111111111111111111111111111111111111111',
            {
                action: 'verify-human',
                signal: '0x1111111111111111111111111111111111111111',
                payload: {
                    proof: 'proof',
                    merkle_root: 'root',
                    nullifier_hash: 'nullifier',
                    verification_level: 'orb',
                },
            },
        )).rejects.toBeInstanceOf(BadRequestException);
    });
});

import { describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { AuthService } from './auth.service';
import { AuthType } from './entities/user-auth-profile.entity';
import { env } from '../../config';
import { MiniAppAuthVerifier } from './miniapp-auth.verifier';

describe('AuthService wss signature validation', () => {
    it('returns false instead of throwing for invalid address input', async () => {
        const service = new AuthService({ get: vi.fn() } as any, { upsert: vi.fn() } as any, new MiniAppAuthVerifier());

        await expect(service.validateWssSignature('demo-user', 'msg', 'sig', false))
            .resolves
            .toBe(false);
    });

    it('backfills wallet login into auth profile and preserves human verification snapshot in JWT', async () => {
        const wallet = ethers.Wallet.createRandom();
        const challenge = 'challenge-text';
        const redis = {
            get: vi.fn().mockResolvedValue(challenge),
            del: vi.fn().mockResolvedValue(1),
        };
        const profileService = {
            upsert: vi.fn().mockResolvedValue({
                address: wallet.address,
                lastAuthType: AuthType.WALLET,
                miniAppUserId: 'world-user-1',
                humanVerified: true,
            }),
        };
        const service = new AuthService(redis as any, profileService as any, new MiniAppAuthVerifier());
        const signature = await wallet.signMessage(challenge);
        const wssSpy = vi.spyOn(service, 'generateWssKey')
            .mockResolvedValue({ key: 'wss-key', expiresAt: 123 });

        const result = await service.login(wallet.address, signature);
        const payload = jwt.verify(result.accessToken, env.secret.jwtSecret) as any;

        expect(profileService.upsert).toHaveBeenCalledWith({
            address: wallet.address,
            lastAuthType: AuthType.WALLET,
        });
        expect(payload).toMatchObject({
            sub: wallet.address,
            authType: AuthType.WALLET,
            humanVerified: true,
            miniAppUserId: 'world-user-1',
        });
        expect(result).toMatchObject({
            wssKey: 'wss-key',
            wssKeyExpiresAt: 123,
        });

        wssSpy.mockRestore();
    });

    it('logs in a mini-app user and writes mini-app auth profile fields into JWT', async () => {
        const wallet = ethers.Wallet.createRandom();
        const nonce = 'miniapp-nonce-1';
        const message = `Tapl miniapp login nonce:${nonce}`;
        const signature = await wallet.signMessage(message);
        const profileService = {
            upsert: vi.fn().mockResolvedValue({
                address: wallet.address,
                lastAuthType: AuthType.MINIAPP,
                miniAppUserId: 'world-user-7',
                humanVerified: true,
                humanVerifiedAt: new Date('2026-04-23T00:00:00.000Z'),
                humanVerificationSource: 'worldchain-miniapp',
            }),
        };
        const service = new AuthService({ get: vi.fn() } as any, profileService as any, new MiniAppAuthVerifier());
        const wssSpy = vi.spyOn(service, 'generateWssKey')
            .mockResolvedValue({ key: 'mini-wss-key', expiresAt: 456 });

        const result = await service.loginMiniApp({
            nonce,
            miniAppUserId: 'world-user-7',
            payload: {
                status: 'success',
                message,
                signature,
                address: wallet.address,
                version: 1,
            },
            humanProof: {
                action: 'verify-human',
                signal: wallet.address,
                payload: {
                    proof: 'proof',
                    merkle_root: 'root',
                    nullifier_hash: 'nullifier',
                    verification_level: 'orb',
                },
            },
        });
        const payload = jwt.verify(result.accessToken, env.secret.jwtSecret) as any;

        expect(profileService.upsert).toHaveBeenCalledWith(expect.objectContaining({
            address: wallet.address,
            lastAuthType: AuthType.MINIAPP,
            miniAppUserId: 'world-user-7',
            humanVerified: true,
            humanVerificationSource: 'worldchain-miniapp',
        }));
        expect(payload).toMatchObject({
            sub: wallet.address,
            authType: AuthType.MINIAPP,
            humanVerified: true,
            miniAppUserId: 'world-user-7',
        });
        expect(result).toMatchObject({
            wssKey: 'mini-wss-key',
            wssKeyExpiresAt: 456,
        });

        wssSpy.mockRestore();
    });
});

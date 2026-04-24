import { describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { AuthService } from './auth.service';
import { AuthType } from './entities/user-auth-profile.entity';
import { env } from '../../config';

describe('AuthService wss signature validation', () => {
    it('returns false instead of throwing for invalid address input', async () => {
        const verifier = { verify: vi.fn() };
        const service = new AuthService(
            { get: vi.fn(), set: vi.fn(), del: vi.fn() } as any,
            { upsert: vi.fn() } as any,
            verifier as any,
            { consumeNonce: vi.fn(), createNonce: vi.fn() } as any,
        );

        await expect(service.validateWssSignature('demo-user', 'msg', 'sig', false))
            .resolves
            .toBe(false);
    });

    it('backfills wallet login into auth profile and preserves human verification snapshot in JWT', async () => {
        const wallet = ethers.Wallet.createRandom();
        const challenge = 'challenge-text';
        const verifier = { verify: vi.fn() };
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
        const service = new AuthService(
            redis as any,
            profileService as any,
            verifier as any,
            { consumeNonce: vi.fn(), createNonce: vi.fn() } as any,
        );
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

    it('logs in a mini-app user without trusting human verification from login payload', async () => {
        const wallet = ethers.Wallet.createRandom();
        const nonce = 'miniapp-nonce-1';
        const profileService = {
            upsert: vi.fn().mockResolvedValue({
                address: wallet.address,
                lastAuthType: AuthType.MINIAPP,
                miniAppUserId: 'world-user-7',
                humanVerified: false,
                humanVerifiedAt: null,
                humanVerificationSource: null,
            }),
        };
        const miniAppNonceService = {
            consumeNonce: vi.fn().mockResolvedValue(true),
            createNonce: vi.fn(),
        };
        const verifier = {
            verifyLogin: vi.fn().mockResolvedValue({
                address: wallet.address,
            }),
            verifyHuman: vi.fn(),
        };
        const service = new AuthService(
            { get: vi.fn(), set: vi.fn(), del: vi.fn() } as any,
            profileService as any,
            verifier as any,
            miniAppNonceService as any,
        );
        const wssSpy = vi.spyOn(service, 'generateWssKey')
            .mockResolvedValue({ key: 'mini-wss-key', expiresAt: 456 });

        const result = await service.loginMiniApp({
            nonce,
            miniAppUserId: 'world-user-7',
            payload: {
                status: 'success',
                message: 'unused-in-stub',
                signature: 'unused-in-stub',
                address: wallet.address,
                version: 2,
            },
        });
        const payload = jwt.verify(result.accessToken, env.secret.jwtSecret) as any;

        expect(verifier.verifyLogin).toHaveBeenCalledWith(nonce, expect.objectContaining({
            address: wallet.address,
        }));
        expect(miniAppNonceService.consumeNonce).toHaveBeenCalledWith(nonce);
        expect(profileService.upsert).toHaveBeenCalledWith(expect.objectContaining({
            address: wallet.address,
            lastAuthType: AuthType.MINIAPP,
            miniAppUserId: 'world-user-7',
        }));
        expect(payload).toMatchObject({
            sub: wallet.address,
            authType: AuthType.MINIAPP,
            humanVerified: false,
            miniAppUserId: 'world-user-7',
        });
        expect(result).toMatchObject({
            wssKey: 'mini-wss-key',
            wssKeyExpiresAt: 456,
        });

        wssSpy.mockRestore();
    });

    it('rejects mini-app login when nonce cannot be consumed', async () => {
        const wallet = ethers.Wallet.createRandom();
        const nonce = 'miniapp-nonce-expired';
        const verifier = {
            verifyLogin: vi.fn().mockResolvedValue({
                address: wallet.address,
            }),
            verifyHuman: vi.fn(),
        };
        const service = new AuthService(
            { get: vi.fn(), set: vi.fn(), del: vi.fn() } as any,
            { upsert: vi.fn() } as any,
            verifier as any,
            { consumeNonce: vi.fn().mockResolvedValue(false), createNonce: vi.fn() } as any,
        );

        await expect(service.loginMiniApp({
            nonce,
            miniAppUserId: 'world-user-7',
            payload: {
                status: 'success',
                message: 'unused-in-stub',
                signature: 'unused-in-stub',
                address: wallet.address,
                version: 2,
            },
        })).rejects.toThrow('Invalid Nonce, Payload');
    });

    it('verifies human proof separately and refreshes JWT claims from profile state', async () => {
        const wallet = ethers.Wallet.createRandom();
        const verifier = {
            verifyLogin: vi.fn(),
            verifyHuman: vi.fn().mockResolvedValue({
                humanVerified: true,
                verificationSource: 'worldchain-miniapp',
                verifiedAt: new Date('2026-04-24T00:00:00.000Z'),
            }),
        };
        const profileService = {
            getCachedByAddress: vi.fn().mockResolvedValue({
                address: wallet.address,
                lastAuthType: AuthType.MINIAPP,
                miniAppUserId: 'world-user-7',
                humanVerified: false,
                nullifierHash: null,
            }),
            getByNullifierHash: vi.fn().mockResolvedValue(null),
            upsert: vi.fn().mockResolvedValue({
                address: wallet.address,
                lastAuthType: AuthType.MINIAPP,
                miniAppUserId: 'world-user-7',
                humanVerified: true,
                humanVerifiedAt: new Date('2026-04-24T00:00:00.000Z'),
                humanVerificationSource: 'worldchain-miniapp',
                nullifierHash: 'nullifier',
            }),
        };
        const redis = {
            get: vi.fn(),
            set: vi.fn().mockResolvedValue('OK'),
            del: vi.fn().mockResolvedValue(1),
        };
        const service = new AuthService(
            redis as any,
            profileService as any,
            verifier as any,
            { consumeNonce: vi.fn(), createNonce: vi.fn() } as any,
        );
        const wssSpy = vi.spyOn(service, 'generateWssKey')
            .mockResolvedValue({ key: 'human-wss-key', expiresAt: 789 });

        const result = await service.verifyMiniAppHuman(wallet.address, {
            action: 'verify-human',
            signal: wallet.address,
            payload: {
                proof: 'proof',
                merkle_root: 'root',
                nullifier_hash: 'nullifier',
                verification_level: 'orb',
            },
        });
        const payload = jwt.verify(result.accessToken, env.secret.jwtSecret) as any;

        expect(verifier.verifyHuman).toHaveBeenCalledWith(wallet.address, expect.objectContaining({
            signal: wallet.address,
        }));
        expect(profileService.upsert).toHaveBeenCalledWith({
            address: wallet.address,
            humanVerified: true,
            humanVerifiedAt: new Date('2026-04-24T00:00:00.000Z'),
            humanVerificationSource: 'worldchain-miniapp',
            nullifierHash: 'nullifier',
        });
        expect(payload).toMatchObject({
            sub: wallet.address,
            authType: AuthType.MINIAPP,
            humanVerified: true,
            miniAppUserId: 'world-user-7',
        });
        expect(redis.set).toHaveBeenCalledWith(
            'flag:auth:verify-human:nullifier',
            '1',
            'EX',
            5,
            'NX',
        );
        expect(redis.del).toHaveBeenCalledWith('flag:auth:verify-human:nullifier');

        wssSpy.mockRestore();
    });

    it('rejects verify-human when current user already owns a nullifier hash', async () => {
        const wallet = ethers.Wallet.createRandom();
        const service = new AuthService(
            { set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) } as any,
            {
                getCachedByAddress: vi.fn().mockResolvedValue({
                    address: wallet.address,
                    nullifierHash: 'existing-nullifier',
                }),
                getByNullifierHash: vi.fn(),
                upsert: vi.fn(),
            } as any,
            { verifyHuman: vi.fn() } as any,
            { consumeNonce: vi.fn(), createNonce: vi.fn() } as any,
        );

        await expect(service.verifyMiniAppHuman(wallet.address, {
            action: 'verify-human',
            signal: wallet.address,
            payload: {
                proof: 'proof',
                merkle_root: 'root',
                nullifier_hash: 'new-nullifier',
                verification_level: 'orb',
            },
        })).rejects.toThrow('User verified');
    });

    it('rejects verify-human when another profile already owns the nullifier hash', async () => {
        const wallet = ethers.Wallet.createRandom();
        const service = new AuthService(
            { set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) } as any,
            {
                getCachedByAddress: vi.fn().mockResolvedValue({
                    address: wallet.address,
                    nullifierHash: null,
                }),
                getByNullifierHash: vi.fn().mockResolvedValue({
                    address: ethers.Wallet.createRandom().address,
                    nullifierHash: 'shared-nullifier',
                }),
                upsert: vi.fn(),
            } as any,
            { verifyHuman: vi.fn() } as any,
            { consumeNonce: vi.fn(), createNonce: vi.fn() } as any,
        );

        await expect(service.verifyMiniAppHuman(wallet.address, {
            action: 'verify-human',
            signal: wallet.address,
            payload: {
                proof: 'proof',
                merkle_root: 'root',
                nullifier_hash: 'shared-nullifier',
                verification_level: 'orb',
            },
        })).rejects.toThrow('Invalid Nullifier Hash');
    });
});

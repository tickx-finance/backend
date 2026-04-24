import { describe, expect, it, vi } from 'vitest';
import { AuthType } from './entities/user-auth-profile.entity';
import { UserAuthProfileService } from './user-auth-profile.service';

describe('UserAuthProfileService', () => {
    it('creates a wallet profile when missing', async () => {
        const harness = makeHarness();

        const profile = await harness.service.upsert({
            address: '0x1111111111111111111111111111111111111111',
        });

        expect(profile).toMatchObject({
            address: '0x1111111111111111111111111111111111111111',
            lastAuthType: AuthType.WALLET,
            miniAppUserId: null,
            miniAppUsername: null,
            humanVerified: false,
        });
        expect(harness.redis.set).toHaveBeenCalled();
    });

    it('updates an existing profile with miniapp and human verification metadata', async () => {
        const existing = {
            id: 'profile-1',
            address: '0x1111111111111111111111111111111111111111',
            lastAuthType: AuthType.WALLET,
            miniAppUserId: null,
            miniAppUsername: null,
            humanVerified: false,
            humanVerifiedAt: null,
            humanVerificationSource: null,
            nullifierHash: null,
        };
        const harness = makeHarness({ existing });
        const verifiedAt = new Date('2026-04-23T12:00:00Z');

        const profile = await harness.service.upsert({
            address: existing.address,
            lastAuthType: AuthType.MINIAPP,
            miniAppUserId: 'world-user-1',
            miniAppUsername: 'kol_name',
            humanVerified: true,
            humanVerifiedAt: verifiedAt,
            humanVerificationSource: 'world_id',
            nullifierHash: 'nullifier-1',
        });

        expect(profile).toMatchObject({
            id: 'profile-1',
            address: existing.address,
            lastAuthType: AuthType.MINIAPP,
            miniAppUserId: 'world-user-1',
            miniAppUsername: 'kol_name',
            humanVerified: true,
            humanVerifiedAt: verifiedAt,
            humanVerificationSource: 'world_id',
            nullifierHash: 'nullifier-1',
        });
        expect(harness.redis.set).toHaveBeenCalled();
    });

    it('reads a profile by address', async () => {
        const existing = {
            id: 'profile-1',
            address: '0x1111111111111111111111111111111111111111',
        };
        const harness = makeHarness({ existing });

        await expect(harness.service.getByAddress(existing.address))
            .resolves
            .toEqual(existing);
    });

    it('reads a profile from redis cache before hitting postgres', async () => {
        const existing = {
            id: 'profile-1',
            address: '0x1111111111111111111111111111111111111111',
            lastAuthType: AuthType.MINIAPP,
            miniAppUserId: 'world-user-1',
            miniAppUsername: 'kol_name',
            humanVerified: true,
            humanVerifiedAt: new Date('2026-04-23T12:00:00Z'),
            humanVerificationSource: 'world_id',
            nullifierHash: 'nullifier-1',
            createdAt: new Date('2026-04-23T12:00:00Z'),
            updatedAt: new Date('2026-04-23T12:00:00Z'),
        };
        const harness = makeHarness({
            redisValue: JSON.stringify({
                ...existing,
                humanVerifiedAt: existing.humanVerifiedAt.toISOString(),
                createdAt: existing.createdAt.toISOString(),
                updatedAt: existing.updatedAt.toISOString(),
            }),
        });

        await expect(harness.service.getCachedByAddress(existing.address))
            .resolves
            .toMatchObject({
                address: existing.address,
                humanVerified: true,
                miniAppUserId: 'world-user-1',
                miniAppUsername: 'kol_name',
            });
        expect(harness.repo.findOne).not.toHaveBeenCalled();
    });

    it('loads from postgres on cache miss and backfills redis', async () => {
        const existing = {
            id: 'profile-1',
            address: '0x1111111111111111111111111111111111111111',
            lastAuthType: AuthType.MINIAPP,
            miniAppUserId: 'world-user-1',
            miniAppUsername: 'kol_name',
            humanVerified: true,
            humanVerifiedAt: new Date('2026-04-23T12:00:00Z'),
            humanVerificationSource: 'world_id',
            nullifierHash: 'nullifier-1',
        };
        const harness = makeHarness({ existing });

        await expect(harness.service.getCachedByAddress(existing.address))
            .resolves
            .toEqual(existing);
        expect(harness.repo.findOne).toHaveBeenCalledTimes(1);
        expect(harness.redis.set).toHaveBeenCalled();
    });

    it('reads a profile by nullifier hash', async () => {
        const existing = {
            id: 'profile-1',
            address: '0x1111111111111111111111111111111111111111',
            nullifierHash: 'nullifier-1',
        };
        const harness = makeHarness({ existing });

        await expect(harness.service.getByNullifierHash(existing.nullifierHash))
            .resolves
            .toEqual(existing);
    });
});

function makeHarness(options: { existing?: any; redisValue?: string | null } = {}) {
    const repo = {
        findOne: vi.fn().mockResolvedValue(options.existing ?? null),
        findOneOrFail: vi.fn().mockResolvedValue(options.existing),
        create: vi.fn().mockImplementation((entity) => entity),
        save: vi.fn().mockImplementation(async (entity) => entity),
    };
    const redis = {
        get: vi.fn().mockResolvedValue(options.redisValue ?? null),
        set: vi.fn().mockResolvedValue('OK'),
    };

    return {
        repo,
        redis,
        service: new UserAuthProfileService(repo as any, redis as any),
    };
}

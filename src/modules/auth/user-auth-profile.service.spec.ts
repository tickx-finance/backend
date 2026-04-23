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
            humanVerified: false,
        });
    });

    it('updates an existing profile with miniapp and human verification metadata', async () => {
        const existing = {
            id: 'profile-1',
            address: '0x1111111111111111111111111111111111111111',
            lastAuthType: AuthType.WALLET,
            miniAppUserId: null,
            humanVerified: false,
            humanVerifiedAt: null,
            humanVerificationSource: null,
        };
        const harness = makeHarness({ existing });
        const verifiedAt = new Date('2026-04-23T12:00:00Z');

        const profile = await harness.service.upsert({
            address: existing.address,
            lastAuthType: AuthType.MINIAPP,
            miniAppUserId: 'world-user-1',
            humanVerified: true,
            humanVerifiedAt: verifiedAt,
            humanVerificationSource: 'world_id',
        });

        expect(profile).toMatchObject({
            id: 'profile-1',
            address: existing.address,
            lastAuthType: AuthType.MINIAPP,
            miniAppUserId: 'world-user-1',
            humanVerified: true,
            humanVerifiedAt: verifiedAt,
            humanVerificationSource: 'world_id',
        });
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
});

function makeHarness(options: { existing?: any } = {}) {
    const repo = {
        findOne: vi.fn().mockResolvedValue(options.existing ?? null),
        findOneOrFail: vi.fn().mockResolvedValue(options.existing),
        create: vi.fn().mockImplementation((entity) => entity),
        save: vi.fn().mockImplementation(async (entity) => entity),
    };

    return {
        repo,
        service: new UserAuthProfileService(repo as any),
    };
}

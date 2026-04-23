import { describe, expect, it } from 'vitest';
import { AuthType } from './entities/user-auth-profile.entity';
import { toAuthenticatedUser } from './types';

describe('auth JWT payload mapping', () => {
    it('maps claims into backward-compatible request user shape', () => {
        expect(toAuthenticatedUser({
            sub: '0x1111111111111111111111111111111111111111',
            authType: AuthType.MINIAPP,
            humanVerified: true,
            miniAppUserId: 'world-1',
        })).toEqual({
            address: '0x1111111111111111111111111111111111111111',
            authType: AuthType.MINIAPP,
            humanVerified: true,
            miniAppUserId: 'world-1',
        });
    });
});

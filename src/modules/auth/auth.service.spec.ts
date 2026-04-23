import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService wss signature validation', () => {
    it('returns false instead of throwing for invalid address input', async () => {
        const service = new AuthService({ get: vi.fn() } as any);

        await expect(service.validateWssSignature('demo-user', 'msg', 'sig', false))
            .resolves
            .toBe(false);
    });
});

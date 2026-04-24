import { describe, expect, it, vi } from 'vitest';
import { MiniAppNonceService } from './miniapp-nonce.service';

describe('MiniAppNonceService', () => {
    it('creates a nonce and stores it in redis with ttl', async () => {
        const harness = makeHarness();

        const nonce = await harness.service.createNonce();

        expect(nonce).toMatch(/^[a-f0-9]{32}$/);
        expect(harness.redis.set).toHaveBeenCalledWith(
            `auth:miniapp:nonce:${nonce}`,
            '1',
            'EX',
            300,
        );
    });

    it('consumes a valid nonce exactly once', async () => {
        const harness = makeHarness({ redisGet: '1' });

        await expect(harness.service.consumeNonce('nonce-1')).resolves.toBe(true);
        expect(harness.repo.findOne).toHaveBeenCalled();
        expect(harness.repo.save).toHaveBeenCalled();
        expect(harness.redis.del).toHaveBeenCalledWith('auth:miniapp:nonce:nonce-1');
    });

    it('rejects nonce replay when already persisted', async () => {
        const harness = makeHarness({ existing: { id: 'used' }, redisGet: '1' });

        await expect(harness.service.consumeNonce('nonce-1')).resolves.toBe(false);
        expect(harness.repo.save).not.toHaveBeenCalled();
        expect(harness.redis.del).not.toHaveBeenCalled();
    });

    it('rejects missing or expired nonce from redis', async () => {
        const harness = makeHarness({ redisGet: null });

        await expect(harness.service.consumeNonce('nonce-1')).resolves.toBe(false);
        expect(harness.repo.save).not.toHaveBeenCalled();
    });
});

function makeHarness(options: { existing?: any; redisGet?: string | null } = {}) {
    const repo = {
        findOne: vi.fn().mockResolvedValue(options.existing ?? null),
        create: vi.fn().mockImplementation((entity) => entity),
        save: vi.fn().mockImplementation(async (entity) => ({ id: 'nonce-id', ...entity })),
    };
    const redis = {
        get: vi.fn().mockResolvedValue(options.redisGet ?? null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
    };

    return {
        repo,
        redis,
        service: new MiniAppNonceService(repo as any, redis as any),
    };
}

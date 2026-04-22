import { describe, expect, it, vi } from 'vitest';
import { PaymentWithdrawalExpiryWorker } from './payment-withdrawal-expiry.worker';

describe('PaymentWithdrawalExpiryWorker', () => {
    it('expires due withdrawal sessions through PaymentService', async () => {
        const paymentService = {
            expireWithdrawal: vi.fn().mockResolvedValue(undefined),
        };
        const withdrawalSessionRepo = {
            find: vi.fn().mockResolvedValue([
                { sessionId: 'session-1' },
                { sessionId: 'session-2' },
            ]),
        };
        const worker = new PaymentWithdrawalExpiryWorker(
            paymentService as any,
            withdrawalSessionRepo as any,
        );

        const result = await worker.expireDueSessions(new Date('2026-01-01T00:00:00Z'));

        expect(withdrawalSessionRepo.find).toHaveBeenCalledWith(expect.objectContaining({
            order: { expiresAt: 'ASC' },
        }));
        expect(paymentService.expireWithdrawal).toHaveBeenCalledWith('session-1');
        expect(paymentService.expireWithdrawal).toHaveBeenCalledWith('session-2');
        expect(result).toEqual({
            scanned: 2,
            expired: 2,
            failed: 0,
        });
    });

    it('does not run overlapping expiry sweeps', async () => {
        let release!: () => void;
        const firstFind = new Promise<any[]>((resolve) => {
            release = () => resolve([]);
        });
        const withdrawalSessionRepo = {
            find: vi.fn().mockReturnValueOnce(firstFind),
        };
        const worker = new PaymentWithdrawalExpiryWorker(
            { expireWithdrawal: vi.fn() } as any,
            withdrawalSessionRepo as any,
        );

        const first = worker.expireDueSessions();
        const second = await worker.expireDueSessions();
        release();

        await first;
        expect(second).toBeNull();
    });
});

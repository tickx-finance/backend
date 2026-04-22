import { describe, expect, it, vi } from 'vitest';
import { PaymentWorkerRunner } from './payment-worker-runner.service';

describe('PaymentWorkerRunner', () => {
    it('starts and stops payment workers through lifecycle hooks', () => {
        const chainSyncWorker = {
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
        };
        const withdrawalExpiryWorker = {
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
        };
        const runner = new PaymentWorkerRunner(
            chainSyncWorker as never,
            withdrawalExpiryWorker as never,
        );

        runner.onModuleInit();
        runner.onModuleDestroy();

        expect(chainSyncWorker.startPolling).toHaveBeenCalledTimes(1);
        expect(withdrawalExpiryWorker.startPolling).toHaveBeenCalledTimes(1);
        expect(chainSyncWorker.stopPolling).toHaveBeenCalledTimes(1);
        expect(withdrawalExpiryWorker.stopPolling).toHaveBeenCalledTimes(1);
    });
});

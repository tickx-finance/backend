import { describe, expect, it, vi } from 'vitest';
import { PaymentChainEventProcessor } from './payment-chain-event-processor.service';
import {
    PaymentChainEvent,
    PaymentChainEventName,
    PaymentChainLedgerStatus,
} from './entities/payment-chain-event.entity';
import { WithdrawalStatus } from './entities/withdrawal-session.entity';

describe('PaymentChainEventProcessor', () => {
    it('applies TraderDeposited events to account ledger and deposit history', async () => {
        const harness = makeHarness();
        const event = makeEvent(PaymentChainEventName.TRADER_DEPOSITED);

        const status = await harness.processor.processOne(event);

        expect(status).toBe(PaymentChainLedgerStatus.APPLIED);
        expect(harness.account.deposit).toHaveBeenCalledWith(
            event.trader,
            event.amount,
            event.txHash,
            event.logIndex,
        );
        expect(harness.depositRepo.save).toHaveBeenCalled();
        expect(event.appliedToLedger).toBe(true);
    });

    it('matches TraderClaimed events to an open withdrawal session', async () => {
        const harness = makeHarness({
            withdrawalSessions: [{
                sessionId: 'session-1',
                userId: '0x1111111111111111111111111111111111111111',
                amount: '100.000000000',
                status: WithdrawalStatus.OPEN,
                txHash: null,
                approvalSignature: '0xsig',
                createdAt: new Date('2026-01-01T00:00:00Z'),
                expiresAt: new Date('2026-01-01T00:15:00Z'),
            }],
        });
        const event = makeEvent(PaymentChainEventName.TRADER_CLAIMED, {
            amount: '100',
        });

        const status = await harness.processor.processOne(event);

        expect(status).toBe(PaymentChainLedgerStatus.APPLIED);
        expect(harness.account.withdrawSucceeded).toHaveBeenCalledWith(
            event.trader,
            '100.000000000',
            event.txHash,
            event.logIndex,
        );
        expect(harness.withdrawalSessionRepo.save.mock.calls[0][0]).toMatchObject({
            status: WithdrawalStatus.SUCCESS,
            txHash: event.txHash,
        });
        expect(harness.withdrawalHistoryRepo.save).toHaveBeenCalled();
    });

    it('marks unmatched TraderClaimed events as audit-only', async () => {
        const harness = makeHarness();
        const event = makeEvent(PaymentChainEventName.TRADER_CLAIMED);

        const status = await harness.processor.processOne(event);

        expect(status).toBe(PaymentChainLedgerStatus.AUDIT_ONLY);
        expect(harness.account.withdrawSucceeded).not.toHaveBeenCalled();
        expect(event.ledgerError).toContain('No matching OPEN withdrawal session');
    });
});

function makeHarness(options: {
    withdrawalSessions?: any[];
} = {}) {
    const account = {
        deposit: vi.fn().mockResolvedValue(undefined),
        withdrawSucceeded: vi.fn().mockResolvedValue(undefined),
    };
    const eventRepo = {
        find: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockImplementation(async (entity) => entity),
    };
    const depositRepo = {
        findOne: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((entity) => entity),
        save: vi.fn().mockImplementation(async (entity) => entity),
    };
    const withdrawalHistoryRepo = {
        findOne: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((entity) => entity),
        save: vi.fn().mockImplementation(async (entity) => entity),
    };
    const withdrawalSessionRepo = {
        find: vi.fn().mockResolvedValue(options.withdrawalSessions ?? []),
        save: vi.fn().mockImplementation(async (entity) => entity),
    };
    const eventPublisher = {
        emitWithdrawSuccess: vi.fn(),
    };

    return {
        account,
        eventRepo,
        depositRepo,
        withdrawalHistoryRepo,
        withdrawalSessionRepo,
        eventPublisher,
        processor: new PaymentChainEventProcessor(
            account as any,
            eventRepo as any,
            depositRepo as any,
            withdrawalHistoryRepo as any,
            withdrawalSessionRepo as any,
            eventPublisher as any,
        ),
    };
}

function makeEvent(
    eventName: PaymentChainEventName,
    overrides: Partial<PaymentChainEvent> = {},
): PaymentChainEvent {
    return {
        id: 'event-1',
        chainId: '480',
        contractAddress: '0x2222222222222222222222222222222222222222',
        eventName,
        trader: '0x1111111111111111111111111111111111111111',
        amount: '100',
        txHash: '0xabc',
        logIndex: 1,
        blockNumber: '10',
        blockHash: '0xblock',
        rawArgs: {},
        appliedToLedger: false,
        ledgerStatus: PaymentChainLedgerStatus.PENDING,
        ledgerError: null,
        processedAt: null,
        createdAt: new Date(),
        ...overrides,
    };
}

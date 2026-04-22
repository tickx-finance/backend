import { describe, expect, it, vi } from 'vitest';
import { PaymentService } from './payment.service';
import { WithdrawalStatus } from './entities/withdrawal-session.entity';

describe('PaymentService production withdrawal session', () => {
    it('locks funds, signs a claim, stores session metadata, and returns tx-ready fields', async () => {
        const harness = makeHarness();

        const result = await harness.service.requestWithdrawal(
            '0x1111111111111111111111111111111111111111',
            '100',
        );

        expect(harness.account.withdrawRequested).toHaveBeenCalledWith(
            '0x1111111111111111111111111111111111111111',
            '100',
            expect.any(String),
        );
        expect(harness.signer.signWithdrawalClaim).toHaveBeenCalledWith({
            trader: '0x1111111111111111111111111111111111111111',
            amount: '100',
            deadline: expect.any(Number),
        });
        expect(harness.withdrawalSessionRepo.save.mock.calls[0][0]).toMatchObject({
            userId: '0x1111111111111111111111111111111111111111',
            amount: '100',
            status: WithdrawalStatus.OPEN,
            approvalSignature: '0xsignature',
            nonce: '7',
            reservePoolAddress: '0x2222222222222222222222222222222222222222',
            quoteAssetAddress: '0x3333333333333333333333333333333333333333',
        });
        expect(result).toMatchObject({
            amount: '100',
            approvalSignature: '0xsignature',
            nonce: '7',
            reservePoolAddress: '0x2222222222222222222222222222222222222222',
            quoteAssetAddress: '0x3333333333333333333333333333333333333333',
            method: 'withdrawTrader',
            isExisting: false,
        });
    });

    it('returns an existing open session without creating a new signature', async () => {
        const expiresAt = new Date(Date.now() + 60_000);
        const harness = makeHarness({
            existingSession: {
                sessionId: 'session-1',
                userId: '0x1111111111111111111111111111111111111111',
                amount: '100',
                status: WithdrawalStatus.OPEN,
                approvalSignature: '0xexisting',
                deadline: '1770000000',
                nonce: '9',
                reservePoolAddress: '0x2222222222222222222222222222222222222222',
                quoteAssetAddress: '0x3333333333333333333333333333333333333333',
                txHash: null,
                createdAt: new Date(),
                expiresAt,
            },
        });

        const result = await harness.service.requestWithdrawal(
            '0x1111111111111111111111111111111111111111',
            '100',
        );

        expect(harness.account.withdrawRequested).not.toHaveBeenCalled();
        expect(harness.signer.signWithdrawalClaim).not.toHaveBeenCalled();
        expect(result).toEqual({
            sessionId: 'session-1',
            amount: '100',
            approvalSignature: '0xexisting',
            deadline: 1770000000,
            nonce: '9',
            reservePoolAddress: '0x2222222222222222222222222222222222222222',
            quoteAssetAddress: '0x3333333333333333333333333333333333333333',
            method: 'withdrawTrader',
            expiresAt,
            isExisting: true,
        });
    });
});

function makeHarness(options: { existingSession?: any } = {}) {
    const account = {
        deposit: vi.fn(),
        withdrawRequested: vi.fn().mockResolvedValue(undefined),
        withdrawSucceeded: vi.fn(),
        withdrawCancelled: vi.fn(),
    };
    const signer = {
        signWithdrawalClaim: vi.fn().mockResolvedValue({
            trader: '0x1111111111111111111111111111111111111111',
            amount: '100',
            nonce: '7',
            deadline: 1770000000,
            signature: '0xsignature',
            digest: '0xdigest',
            reservePoolAddress: '0x2222222222222222222222222222222222222222',
            quoteAssetAddress: '0x3333333333333333333333333333333333333333',
        }),
    };
    const depositRepo = repoMock();
    const withdrawalHistoryRepo = repoMock();
    const withdrawalSessionRepo = repoMock();
    withdrawalSessionRepo.findOne.mockResolvedValue(options.existingSession ?? null);
    const eventPublisher = {
        emitWithdrawQueued: vi.fn(),
        emitWithdrawSuccess: vi.fn(),
        emitWithdrawCancelled: vi.fn(),
    };

    return {
        account,
        signer,
        depositRepo,
        withdrawalHistoryRepo,
        withdrawalSessionRepo,
        eventPublisher,
        service: new PaymentService(
            account as any,
            signer as any,
            depositRepo as any,
            withdrawalHistoryRepo as any,
            withdrawalSessionRepo as any,
            eventPublisher as any,
        ),
    };
}

function repoMock() {
    return {
        findOne: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((entity) => entity),
        save: vi.fn().mockImplementation(async (entity) => entity),
        find: vi.fn().mockResolvedValue([]),
    };
}

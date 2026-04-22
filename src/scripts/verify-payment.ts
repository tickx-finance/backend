import { PaymentService } from '../modules/payment/payment.service';
import { AccountService } from '../modules/account/account.service';
import { Logger } from '@nestjs/common';
import { PAYMENT_EVENT_PUBLISHER, PaymentEventPublisher } from 'src/modules/payment/payment.events';
import { ACCOUNT_EVENT_PUBLISHER, AccountEventPublisher } from 'src/modules/account/account.events';
import { DepositSuccessMessage, WithdrawQueuedMessage, WithdrawCancelledMessage, WithdrawSuccessMessage } from 'src/modules/socket/types';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerEntry } from 'src/modules/account/entities/ledger-entry.entity';
import { LedgerSnapshot } from 'src/modules/account/entities/ledger-snapshot.entity';
import { WithdrawalHistory } from 'src/modules/payment/entities/withdrawal-history.entity';
import { WithdrawalSession } from 'src/modules/payment/entities/withdrawal-session.entity';
import { DepositHistory } from 'src/modules/payment/entities/deposit-history.entity';
import { AccountModule } from 'src/modules/account/account.module';
import { PaymentModule } from 'src/modules/payment/payment.module';

// Mock Socket Service
class MockEventPublisher implements PaymentEventPublisher, AccountEventPublisher {
    async emitDepositSuccess(msg: DepositSuccessMessage) {
        console.log(`[MockSocket] DepositSuccess: ${JSON.stringify(msg)}`);
    }
    async emitWithdrawQueued(msg: WithdrawQueuedMessage) {
        console.log(`[MockSocket] WithdrawQueued: ${JSON.stringify(msg)}`);
    }
    async emitWithdrawCancelled(msg: WithdrawCancelledMessage) {
        console.log(`[MockSocket] WithdrawCancelled: ${JSON.stringify(msg)}`);
    }
    async emitWithdrawSuccess(msg: WithdrawSuccessMessage) {
        console.log(`[MockSocket] WithdrawSuccess: ${JSON.stringify(msg)}`);
    }
    async emitBalanceUpdate(msg: any) { console.log(`[MockSocket] BalanceUpdate: ${JSON.stringify(msg)}`); }

}

async function runVerification() {
    console.log('Starting verification...');

    const FIXED_NOW = 1768450682526;
    const originalDateNow = Date.now;
    Date.now = () => FIXED_NOW;

    const mockEventPublisher = new MockEventPublisher();

    const moduleFixture = await Test.createTestingModule({
        imports: [
            ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
            TypeOrmModule.forRoot({
                type: 'postgres',
                url: 'postgres://app_user:sniperman@localhost:5437/db0',
                entities: [LedgerEntry, LedgerSnapshot, WithdrawalHistory, WithdrawalSession, DepositHistory],
                synchronize: true,
            }),
            AccountModule,
            PaymentModule,
        ],
    })
        .overrideProvider(PAYMENT_EVENT_PUBLISHER)
        .useValue(mockEventPublisher)
        .overrideProvider(ACCOUNT_EVENT_PUBLISHER)
        .useValue(mockEventPublisher)
        .compile();


    const app = moduleFixture.createNestApplication();
    await app.init();
    const paymentService = app.get(PaymentService);
    const accountService = app.get(AccountService);

    const userId = `0x396343362be2A4dA1cE0C1C210945346fb82Aa49`;
    const depositAmount = '1000';
    const withdrawAmount = '100';
    const depositTxHash = `0xec54755e2139a5dcf315a1ccd685a82fe186444c710746bafd2a3f1cd9b19c2c`;

    try {
        console.log(`Starting verification for user ${userId}`);

        // 1. Deposit
        console.log('--- Step 1: Deposit ---');
        await paymentService.handleDeposit(userId, depositAmount, depositTxHash, 1);

        // Check balance
        let balance = await accountService.getBalance(userId);
        console.log(`Balance after deposit: Free: ${balance.free}, Locked: ${balance.locked}`);

        if (balance.free !== depositAmount) {
            console.error('Deposit failed verification');
            process.exit(1);
        }

        // 2. Request Withdrawal
        console.log('--- Step 2: Request Withdrawal ---');
        const session = await paymentService.requestWithdrawal(userId, withdrawAmount);
        console.log(`Withdrawal session created: ${session.sessionId}`);

        // Check balance
        balance = await accountService.getBalance(userId);
        console.log(`Balance after withdraw request: Free: ${balance.free}, Locked: ${balance.locked}`);

        if (balance.locked !== withdrawAmount) {
            console.error('Withdraw request failed verification: funds not locked');
            process.exit(1);
        }

        // 3. Finalize Withdrawal
        console.log('--- Step 3: Finalize Withdrawal ---');
        const withdrawTxHash = `0xdff6f46aafa7014e109b1836c68c052c126277648d3d016bc42cbb7731061a86`;
        const finalized = await paymentService.finalizeWithdrawal(session.sessionId, withdrawTxHash, 1);

        console.log(`Withdrawal finalized: ${JSON.stringify(finalized)}`);

        // Check balance
        balance = await accountService.getBalance(userId);
        console.log(`Balance after finalized: Free: ${balance.free}, Locked: ${balance.locked}`);

        if (balance.locked !== '0') {
            console.error('Withdraw finalization failed verification: funds still locked');
            process.exit(1);
        }

        const expectedFree = (parseInt(depositAmount) - parseInt(withdrawAmount)).toString();
        if (balance.free !== expectedFree) {
            console.error(`Final balance mismatch. Expected ${expectedFree}, got ${balance.free}`);
            process.exit(1);
        }

        console.log('Payment Module Verification Passed!');
        await app.close();
    } catch (error) {
        console.error('Payment Module Verification Failed:', error);
    } finally {
        Date.now = originalDateNow;
        await app.close();
    }
}

runVerification();
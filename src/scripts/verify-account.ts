import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AccountModule } from '../modules/account/account.module';
import { AccountService } from '../modules/account/account.service';
import { LedgerEntry } from '../modules/account/entities/ledger-entry.entity';
import { LedgerSnapshot } from '../modules/account/entities/ledger-snapshot.entity';

async function runVerification() {
    console.log('Starting verification...');

    const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
            ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
            TypeOrmModule.forRoot({
                type: 'postgres',
                url: 'postgres://app_user:sniperman@localhost:5437/db0',
                entities: [LedgerEntry, LedgerSnapshot],
                synchronize: true, // For testing only
            }),
            AccountModule,
        ],
    }).compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    const accountService = app.get(AccountService); // Resolves proxy?
    // Note: AccountService is scoped? No, singleton.

    const userId = `0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97`;
    console.log(`Testing with User ID: ${userId}`);

    async function printBalance() {
        const balance = await accountService.getBalance(userId);
        console.log(`Balance: ${JSON.stringify(balance)}`);
    }

    try {
        await printBalance();
        // 1. Deposit
        console.log('1. Depositing 1000...');
        await accountService.deposit(userId, '1000', 'dep-2', 1);
        await printBalance();
        // 2. Place Bet
        // console.log('2. Placing bet 100...');
        // await accountService.placeBet(userId, '100', 'market-1', 'cell-1');

        // await printBalance();
        // 2.1 Bet Settle
        // console.log('2.1 Bet Settle 100...');
        // await accountService.settleBet(userId, '100', true, '1.1', 'market-1', 'cell-1');

        // await printBalance();
        // 3. Withdraw request
        // console.log('3. Withdrawing 500...');
        // await accountService.withdrawRequested(userId, '500', 'with-1');
        // await printBalance();

        // 4. Withdraw succeeded
        // console.log('4. Withdrawing 500...');
        // await accountService.withdrawSucceeded(userId, '500', 'with-1', 1);
        // await printBalance();

        console.log('Verification Success! Check logs/DB for details.');
    } catch (error) {
        console.error('Verification Failed:', error);
    } finally {
        await app.close();
    }
}

runVerification();

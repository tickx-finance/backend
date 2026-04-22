import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AccountModule } from '../modules/account/account.module';
import { AccountService } from '../modules/account/account.service';
import { OrderModule } from '../modules/order/order.module';
import { OrderService } from '../modules/order/order.service';
import { LedgerEntry } from '../modules/account/entities/ledger-entry.entity';
import { LedgerSnapshot } from '../modules/account/entities/ledger-snapshot.entity';
import { OrderStatus } from '../modules/order/types';

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
            OrderModule,
        ],
    }).compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    const accountService = app.get(AccountService);
    const orderService = app.get(OrderService);

    const userId = `user-${Date.now()}`;
    console.log(`Testing with User ID: ${userId}`);

    async function printBalance() {
        const balance = await accountService.getBalance(userId);
        console.log(`Balance: free=${balance.free}, locked=${balance.locked}`);
    }

    try {
        console.log('--- Initial Balance ---');
        await printBalance();

        // 1. Deposit
        console.log('\n--- 1. Deposit 1000 ---');
        await accountService.deposit(userId, '1000', `dep-${Date.now()}`, 1);
        await new Promise(r => setTimeout(r, 100)); // Wait for async? Wallet/Queue might be async? 
        // AccountService.deposit uses shardQueue.enqueue which awaits execution? 
        // Yes, it returns the result of enqueue which returns result of task.
        await printBalance();

        // 2. Place Order
        console.log('\n--- 2. Place Order 100 ---');
        const cellId = `cell-${Date.now()}`;
        const marketId = 'market-1';
        const order = await orderService.placeOrder(userId, {
            amount: '100',
            cellId,
            marketId,
        });
        console.log('Order Placed:', order);
        await printBalance();

        // Verify In-Memory State
        const activeOrder = orderService.activeOrdersById.get(order.orderId);
        if (activeOrder && activeOrder.orderId === order.orderId) {
            console.log('✅ Order found in memory');
        } else {
            console.error('❌ Order NOT found in memory');
        }

        // 3. Duplicate Order Check
        console.log('\n--- 3. Duplicate Check ---');
        try {
            await orderService.placeOrder(userId, {
                amount: '50',
                cellId,
                marketId,
            });
            console.error('❌ Duplicate order check FAILED (Should have thrown)');
        } catch (e) {
            console.log('✅ Duplicate order check PASSED:', e.message);
        }

        // 4. Settle Order (WIN)
        console.log('\n--- 4. Settle Order (WIN) ---');
        // Reward rate 2.0 -> Profit 100. Total payout 200.
        // Balance change: Locked -100, Free +200. Net +100.
        // Initial 1000. After deposit 1000.
        // After bet: Free 900, Locked 100.
        // After win: Locked 0, Free 900 + 200 = 1100.
        await orderService.settleOrder(order.orderId, true, '2.0');
        await printBalance();

        const settledOrder = orderService.activeOrdersById.get(order.orderId);
        if (settledOrder.status === OrderStatus.SETTLED) {
            console.log('✅ Order status SETTLED');
        } else {
            console.error('❌ Order status NOT SETTLED');
        }

        console.log('\nVerification Success!');
    } catch (error) {
        console.error('Verification Failed:', error);
    } finally {
        await app.close();
    }
}

runVerification();

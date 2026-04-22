import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AccountModule } from '../modules/account/account.module';
import { AccountService } from '../modules/account/account.service';
import { OrderModule } from '../modules/order/order.module';
import { OrderService } from '../modules/order/order.service';
import { LedgerEntry } from '../modules/account/entities/ledger-entry.entity';
import { LedgerSnapshot } from '../modules/account/entities/ledger-snapshot.entity';
import { OrderPriceTickChannel } from '../modules/order/price-tick.channel';
import { PriceTick } from '../libs/price-tick';
import { defaultMarketConfig } from '../libs/market.config';
import { BigNumber } from 'bignumber.js';
import { ORDER_EVENT_PUBLISHER, OrderEventPublisher } from 'src/modules/order/order.events';
import { Cell, signCell } from 'src/libs/cell';
import { env } from 'src/config';
import { Order } from 'src/modules/order/entities/order.entity';
import { AccountEventPublisher } from 'src/modules/account/account.events';

// Mock Socket Service
class MockEventPublisher implements OrderEventPublisher, AccountEventPublisher {
    async emitOrderUpdate(msg: any) { console.log(`[MockSocket] OrderUpdate: ${JSON.stringify(msg)}`); }
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
                entities: [LedgerEntry, LedgerSnapshot, Order],
                synchronize: true,
            }),
            AccountModule,
            OrderModule,
        ],
    })
        .overrideProvider(ORDER_EVENT_PUBLISHER)
        .useValue(mockEventPublisher)
        .compile();


    const app = moduleFixture.createNestApplication();
    await app.init();

    const accountService = app.get(AccountService);
    const orderService = app.get(OrderService);
    const priceTickChannel = app.get(OrderPriceTickChannel);

    const user1Id = `0x396343362be2A4dA1cE0C1C210945346fb82Aa49`;
    const user2Id = `0x51c9A4b99B5C86A8c67243B5a9Ea19ECeF5f3235`;
    console.log(`Testing with User 1: ${user1Id}, User 2: ${user2Id}`);

    async function printBalance(userId: string, label: string) {
        const balance = await accountService.getBalance(userId);
        console.log(`[${label}] Balance: free=${balance.free}, locked=${balance.locked}`);
        return balance;
    }

    try {
        console.log('--- Initial Balances ---');
        await printBalance(user1Id, 'User1');
        await printBalance(user2Id, 'User2');

        // 1. Deposit 1000 to both
        console.log('\n--- 1. Deposit 1000 Each ---');
        await accountService.deposit(user1Id, '1000', `dep1`, 1);
        await accountService.deposit(user2Id, '1000', `dep2`, 1);
        await new Promise(r => setTimeout(r, 100)); // Allow async processing

        await printBalance(user1Id, 'User1');
        await printBalance(user2Id, 'User2');

        // 2. Place Orders
        // Market Config assumption: Standard grid.
        // We need a cell that hasn't started yet but is valid.
        // XSize = e.g. 30000ms.
        // Let's target a timestamp in the future.
        // Actually, placeOrder checks if cell.startTs < Date.now() + xSize?
        // Logic: if (dto.cell.startTs < Date.now() + xSize) throw "Cell hit deadline" ???
        // Wait, if startTs is LESS than now + xSize, it throws? That means we can only place far future orders?
        // Let's re-read the logic in OrderService:
        // if (dto.cell.startTs < Date.now() + xSize) { throw ... "Cell hit deadline" }
        // That seems backwards if xSize is "min lead time"? Or maybe "max lead time"?
        // If xSize is "deadline offset", then startTs must be GREATER than startTs + xSize??
        // Ah, let's assume the check means "If the cell is starting TOO SOON" (less than XSize away).
        // Let's verify XSize default. Assuming it's small or we pick a far enough time.
        // Actually, let's just pick a time safely in future.
        // Let's look at OrderService again if needed.
        // Line 72: if (dto.cell.startTs < Date.now() + xSize)
        // If xSize is e.g. 0 (unlikely) or negative...
        // Usually xSize is "grid duration".
        // Let's assume we need to pick a time > Date.now() + xSize.
        // We'll trust the default config for now or just force a Large TS.

        const now = Date.now();
        let targetStartTs = now + 60000; // +60s should be safe
        targetStartTs = targetStartTs - (targetStartTs % defaultMarketConfig.gridXSize);

        const marketId = 'BTCUSDT';

        try {
            console.log(`\n--- 2. Place Orders for Cell Start ${targetStartTs} ---`);

            // User 1: High Range (Winning)
            // Assume Price will be 100.
            // User 1 bets 90-110.
            const cell1 = new Cell(targetStartTs, targetStartTs, targetStartTs + defaultMarketConfig.gridXSize, '90', '110', '2', '')
            cell1.gridSignature = signCell(cell1, env.secret.cellSignerKey)
            await orderService.placeOrder(user1Id, {
                amount: '100',
                marketId,
                cell: cell1
            });

            // User 2: Low Range (Losing)
            // Bets 10-20.
            const cell2 = new Cell(targetStartTs - 20000, targetStartTs - 20000, targetStartTs + defaultMarketConfig.gridXSize, '10', '20', '2', '')
            cell2.gridSignature = signCell(cell2, env.secret.cellSignerKey)
            await orderService.placeOrder(user2Id, {
                amount: '100',
                marketId,
                cell: cell2
            });

            console.log('Orders placed.');
        } catch (err) {
            console.error('Failed to place orders:', err);
        }
        await printBalance(user1Id, 'User1'); // Expect 900
        await printBalance(user2Id, 'User2'); // Expect 900

        // 3. Inject Price Tick
        console.log('\n--- 3. Inject Price Tick ---');
        const price = 100;
        const tick: PriceTick = {
            timestamp: targetStartTs + 10, // Just after start
            price: price
        };
        console.log(`Injecting tick: Price=${price} at Time=${tick.timestamp}`);
        priceTickChannel.send(tick);

        // sleep for a bit to allow worker to process
        await new Promise(r => setTimeout(r, 5000));

        // 4. Verify Results
        console.log('\n--- 4. Verify Results ---');
        const finalBal1 = await printBalance(user1Id, 'User1');
        const finalBal2 = await printBalance(user2Id, 'User2');

        // User 1 should win: 90 <= 100 <= 110.
        // Payout = 100 * 2.0 = 200.
        // Net = 900 + 200 = 1100.
        // Free = 1100, Locked = 0.
        if (Number(finalBal1.free) === 1100 && Number(finalBal1.locked) === 0) {
            console.log('✅ User 1 WON (Free Balance 1100, Locked 0)');
        } else {
            console.error(`❌ User 1 Verify Failed. Expected Free Balance 1100, Locked 0, got Free ${finalBal1.free}, Locked ${finalBal1.locked}`);
        }

        // User 2 should lose: 10 <= 100 <= 20 is FALSE.
        // Payout = 0.
        // Net = 900.
        // Free = 900, Locked = 0.
        if (Number(finalBal2.free) === 900 && Number(finalBal2.locked) === 0) {
            console.log('✅ User 2 LOST (Free Balance 900, Locked 0)');
        } else {
            console.error(`❌ User 2 Verify Failed. Expected Free Balance 900, Locked 0, got Free ${finalBal2.free}, Locked ${finalBal2.locked}`);
        }

        console.log('\nVerification Success!');

    } catch (error) {
        console.error('Verification Failed:', error);
    } finally {
        Date.now = originalDateNow;
        await app.close();
    }
}

runVerification();

import dataSource from '../libs/typeorm.config';
import { Order } from '../modules/order/entities/order.entity';
import { DepositHistory } from '../modules/payment/entities/deposit-history.entity';
import { WithdrawalHistory } from '../modules/payment/entities/withdrawal-history.entity';
import { OrderStatus } from '../modules/order/types';

/**
 * Insert mock settlement data for testing API 2
 * Window: 1704067200 - 1704068100 (15 minutes = 900 seconds)
 */
async function insertMockData() {
  console.log('Connecting to database...');
  await dataSource.initialize();
  console.log('Database connected!');

  const windowStart = 1704067200;
  const windowEnd = 1704068100;
  const windowStartMs = windowStart * 1000;
  const windowEndMs = windowEnd * 1000;

  console.log(`\nInserting mock data for window: ${windowStart} - ${windowEnd} (15 minutes)`);

  try {
    // ========== 0. Clean up existing mock data in window ==========
    console.log('\n🧹 Cleaning up existing mock data...');
    
    // Delete existing deposits in window
    await dataSource
      .createQueryBuilder()
      .delete()
      .from(DepositHistory)
      .where('"createdAt" BETWEEN :start AND :end', {
        start: new Date(windowStartMs),
        end: new Date(windowEndMs),
      })
      .execute();
    console.log('  ✓ Cleaned deposits');

    // Delete existing withdrawals in window  
    await dataSource
      .createQueryBuilder()
      .delete()
      .from(WithdrawalHistory)
      .where('"createdAt" BETWEEN :start AND :end', {
        start: new Date(windowStartMs),
        end: new Date(windowEndMs),
      })
      .execute();
    console.log('  ✓ Cleaned withdrawals');

    // Delete existing orders (settlements) in window
    await dataSource
      .createQueryBuilder()
      .delete()
      .from(Order)
      .where('"settledAt" BETWEEN :start AND :end', {
        start: windowStartMs,
        end: windowEndMs,
      })
      .execute();
    console.log('  ✓ Cleaned orders (settlements)');

    // ========== 1. Insert Mock Deposits ==========
    console.log('\n📝 Inserting deposits...');
    const depositRepo = dataSource.getRepository(DepositHistory);
    
    const deposits: Partial<DepositHistory>[] = [
      {
        userId: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000', // 1 ETH
        txHash: '0xabc123def456789012345678901234567890123456789012345678901234abcd',
        logIndex: 0,
        createdAt: new Date(windowStartMs + 60000), // +1 minute
      },
      {
        userId: '0xabcdef1234567890abcdef1234567890abcdef12',
        amount: '2500000000000000000', // 2.5 ETH
        txHash: '0xdef456abc7890123456789012345678901234567890123456789012345678901',
        logIndex: 1,
        createdAt: new Date(windowStartMs + 180000), // +3 minutes
      },
      {
        userId: '0x9876543210987654321098765432109876543210',
        amount: '500000000000000000', // 0.5 ETH
        txHash: '0x123789abc456def7890123456789012345678901234567890123456789012345',
        logIndex: 0,
        createdAt: new Date(windowStartMs + 300000), // +5 minutes
      },
      {
        userId: '0x5555555555555555555555555555555555555555',
        amount: '3000000000000000000', // 3 ETH
        txHash: '0x555aaa555aaa555aaa555aaa555aaa555aaa555aaa555aaa555aaa555aaa555a',
        logIndex: 2,
        createdAt: new Date(windowStartMs + 450000), // +7.5 minutes
      },
    ];

    for (const deposit of deposits) {
      const entity = depositRepo.create(deposit);
      await depositRepo.save(entity);
      console.log(`  ✓ Deposit: ${deposit.amount} wei from ${deposit.userId?.slice(0, 10)}... at ${deposit.createdAt?.toISOString()}`);
    }
    console.log(`  Total deposits inserted: ${deposits.length}`);

    // ========== 2. Insert Mock Withdrawals ==========
    console.log('\n📝 Inserting withdrawals...');
    const withdrawalRepo = dataSource.getRepository(WithdrawalHistory);
    
    const withdrawals: Partial<WithdrawalHistory>[] = [
      {
        sessionId: 'session_001',
        userId: '0x1234567890123456789012345678901234567890',
        amount: '500000000000000000', // 0.5 ETH
        txHash: '0xwithdraw11111111111111111111111111111111111111111111111111111111',
        logIndex: 0,
        createdAt: new Date(windowStartMs + 240000), // +4 minutes
      },
      {
        sessionId: 'session_002',
        userId: '0xfedcba0987654321fedcba0987654321fedcba09',
        amount: '1200000000000000000', // 1.2 ETH
        txHash: '0xwithdraw22222222222222222222222222222222222222222222222222222222',
        logIndex: 1,
        createdAt: new Date(windowStartMs + 420000), // +7 minutes
      },
    ];

    for (const withdrawal of withdrawals) {
      const entity = withdrawalRepo.create(withdrawal);
      await withdrawalRepo.save(entity);
      console.log(`  ✓ Withdrawal: ${withdrawal.amount} wei to ${withdrawal.userId?.slice(0, 10)}... at ${withdrawal.createdAt?.toISOString()}`);
    }
    console.log(`  Total withdrawals inserted: ${withdrawals.length}`);

    // ========== 3. Insert Mock Orders (Settlements) ==========
    console.log('\n📝 Inserting orders (settlements)...');
    const orderRepo = dataSource.getRepository(Order);
    
    const orders: Partial<Order>[] = [
      {
        orderId: 'order_bet_001',
        userId: '0x1111111111111111111111111111111111111111',
        marketId: 'market_btc_usd',
        cellTimeStart: windowStartMs,
        cellTimeEnd: windowStartMs + 300000, // 5 minutes cell
        lowerPrice: '95000.00',
        upperPrice: '97000.00',
        amount: '100000000000000000', // 0.1 ETH stake
        rewardRate: '1000', // 10% in basis points (1000 = 10%)
        placedAt: windowStartMs - 600000, // Placed 10 mins before
        status: OrderStatus.SETTLED,
        settledAt: windowStartMs + 120000, // Settled at +2 minutes
        settledWin: true, // WIN
      },
      {
        orderId: 'order_bet_002',
        userId: '0x2222222222222222222222222222222222222222',
        marketId: 'market_btc_usd',
        cellTimeStart: windowStartMs,
        cellTimeEnd: windowStartMs + 600000, // 10 minutes cell
        lowerPrice: '96000.00',
        upperPrice: '98000.00',
        amount: '200000000000000000', // 0.2 ETH stake
        rewardRate: '1500', // 15%
        placedAt: windowStartMs - 300000,
        status: OrderStatus.SETTLED,
        settledAt: windowStartMs + 360000, // Settled at +6 minutes
        settledWin: true, // WIN
      },
      {
        orderId: 'order_bet_003',
        userId: '0x3333333333333333333333333333333333333333',
        marketId: 'market_eth_usd',
        cellTimeStart: windowStartMs,
        cellTimeEnd: windowStartMs + 900000, // 15 minutes cell
        lowerPrice: '3500.00',
        upperPrice: '3600.00',
        amount: '500000000000000000', // 0.5 ETH stake
        rewardRate: '800', // 8%
        placedAt: windowStartMs - 900000,
        status: OrderStatus.SETTLED,
        settledAt: windowStartMs + 480000, // Settled at +8 minutes
        settledWin: false, // LOSS
      },
      {
        orderId: 'order_bet_004',
        userId: '0x4444444444444444444444444444444444444444',
        marketId: 'market_btc_usd',
        cellTimeStart: windowStartMs + 300000,
        cellTimeEnd: windowStartMs + 600000,
        lowerPrice: '95500.00',
        upperPrice: '96500.00',
        amount: '150000000000000000', // 0.15 ETH
        rewardRate: '1200', // 12%
        placedAt: windowStartMs - 120000,
        status: OrderStatus.SETTLED,
        settledAt: windowStartMs + 600000, // Settled at +10 minutes
        settledWin: true, // WIN
      },
      {
        orderId: 'order_bet_005',
        userId: '0x5555555555555555555555555555555555555555',
        marketId: 'market_sol_usd',
        cellTimeStart: windowStartMs + 600000,
        cellTimeEnd: windowStartMs + 900000,
        lowerPrice: '100.00',
        upperPrice: '105.00',
        amount: '300000000000000000', // 0.3 ETH
        rewardRate: '2000', // 20%
        placedAt: windowStartMs + 100000,
        status: OrderStatus.SETTLED,
        settledAt: windowStartMs + 780000, // Settled at +13 minutes
        settledWin: true, // WIN
      },
    ];

    for (const order of orders) {
      const entity = orderRepo.create(order);
      await orderRepo.save(entity);
      const outcome = order.settledWin ? 'WIN' : 'LOSS';
      const payout = order.settledWin 
        ? BigInt(order.amount!) + (BigInt(order.amount!) * BigInt(order.rewardRate!)) / BigInt(10000)
        : 0;
      console.log(`  ✓ Order: ${order.orderId} - ${outcome} - Payout: ${payout} wei at ${new Date(order.settledAt!).toISOString()}`);
    }
    console.log(`  Total orders inserted: ${orders.length}`);

    console.log('\n✅ Mock data inserted successfully!');
    console.log('\nSummary:');
    console.log(`  - Deposits: ${deposits.length}`);
    console.log(`  - Withdrawals: ${withdrawals.length}`);
    console.log(`  - Settlements (Orders): ${orders.length} (3 WIN, 2 LOSS)`);
    console.log(`\nWindow: ${new Date(windowStartMs).toISOString()} - ${new Date(windowEndMs).toISOString()}`);

  } catch (error) {
    console.error('❌ Error inserting mock data:', error);
    throw error;
  } finally {
    await dataSource.destroy();
    console.log('\nDatabase connection closed.');
  }
}

// Run if executed directly
if (require.main === module) {
  insertMockData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { insertMockData };

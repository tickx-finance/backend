import dataSource from '../libs/typeorm.config';
import { LedgerSnapshot } from '../modules/account/entities/ledger-snapshot.entity';
import { uuidv7 } from 'uuidv7';

/**
 * Insert mock balance data for testing API 4 (Risk/Liability)
 */
async function insertMockBalanceData() {
  console.log('Connecting to database...');
  await dataSource.initialize();
  console.log('Database connected!');

  try {
    const snapshotRepo = dataSource.getRepository(LedgerSnapshot);

    // Clean up existing mock data first
    console.log('\n🧹 Cleaning up existing mock balance data...');
    await snapshotRepo
      .createQueryBuilder()
      .delete()
      .where('"userId" LIKE :prefix', { prefix: 'mock_user_%' })
      .execute();
    console.log('  ✓ Cleaned old mock data');

    console.log('\n📝 Inserting mock balance snapshots...');

    // Create mock users with balances
    const mockUsers = [
      {
        userId: 'mock_user_001',
        free: '1000000000000000000',      // 1 ETH free
        locked: '500000000000000000',      // 0.5 ETH locked
        freeTap: '0',
      },
      {
        userId: 'mock_user_002',
        free: '2500000000000000000',      // 2.5 ETH free
        locked: '1000000000000000000',     // 1 ETH locked
        freeTap: '0',
      },
      {
        userId: 'mock_user_003',
        free: '500000000000000000',       // 0.5 ETH free
        locked: '0',                       // 0 locked
        freeTap: '0',
      },
      {
        userId: 'mock_user_004',
        free: '10000000000000000000',     // 10 ETH free
        locked: '2500000000000000000',     // 2.5 ETH locked
        freeTap: '0',
      },
      {
        userId: 'mock_user_005',
        free: '3000000000000000000',      // 3 ETH free
        locked: '500000000000000000',      // 0.5 ETH locked
        freeTap: '100000000000000000',     // 0.1 ETH freeTap
      },
      {
        userId: 'mock_user_006',
        free: '750000000000000000',       // 0.75 ETH free
        locked: '250000000000000000',      // 0.25 ETH locked
        freeTap: '0',
      },
      {
        userId: 'mock_user_007',
        free: '5000000000000000000',      // 5 ETH free
        locked: '1000000000000000000',     // 1 ETH locked
        freeTap: '0',
      },
      {
        userId: 'mock_user_008',
        free: '200000000000000000',       // 0.2 ETH free
        locked: '0',
        freeTap: '0',
      },
      {
        userId: 'mock_user_009',
        free: '8000000000000000000',      // 8 ETH free
        locked: '2000000000000000000',     // 2 ETH locked
        freeTap: '0',
      },
      {
        userId: 'mock_user_010',
        free: '1500000000000000000',      // 1.5 ETH free
        locked: '500000000000000000',      // 0.5 ETH locked
        freeTap: '0',
      },
    ];

    const now = new Date();
    let totalLiability = BigInt(0);

    for (let i = 0; i < mockUsers.length; i++) {
      const user = mockUsers[i];
      
      // Create ledger snapshot
      const snapshot = snapshotRepo.create({
        userId: user.userId,
        ledgerSeq: uuidv7(),
        balanceAfter: {
          free: user.free,
          locked: user.locked,
          freeTap: user.freeTap,
        },
        createdAt: new Date(now.getTime() - i * 1000), // Slight time difference
      });

      await snapshotRepo.save(snapshot);

      // Calculate user total (free + locked)
      const userTotal = BigInt(user.free) + BigInt(user.locked);
      totalLiability += userTotal;

      console.log(`  ✓ ${user.userId}: free=${user.free} wei, locked=${user.locked} wei, total=${userTotal.toString()} wei`);
    }

    console.log(`\n✅ Mock balance data inserted successfully!`);
    console.log('\nSummary:');
    console.log(`  - Total users: ${mockUsers.length}`);
    console.log(`  - Total liability (free + locked): ${totalLiability.toString()} wei`);
    console.log(`  - In ETH: ${(Number(totalLiability) / 1e18).toFixed(4)} ETH`);

  } catch (error) {
    console.error('❌ Error inserting mock balance data:', error);
    throw error;
  } finally {
    await dataSource.destroy();
    console.log('\nDatabase connection closed.');
  }
}

// Run if executed directly
if (require.main === module) {
  insertMockBalanceData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { insertMockBalanceData };

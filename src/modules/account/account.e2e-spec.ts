import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-modules/ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

import { AccountModule } from './account.module';
import { AccountService } from './account.service';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerSnapshot } from './entities/ledger-snapshot.entity';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';
import { SocketModule } from '../socket/socket.module';

const postgresTestUrl = process.env.POSTGRES_TEST_URL;
const redisTestUrl = process.env.REDIS_TEST_URL;

const silentEventPublisher: EventPublisher = {
    emitDepositSuccess: async () => undefined,
    emitWithdrawQueued: async () => undefined,
    emitWithdrawCancelled: async () => undefined,
    emitWithdrawSuccess: async () => undefined,
    emitOrderUpdate: async () => undefined,
    emitBalanceUpdate: async () => undefined,
    emitNewPrice: async () => undefined,
    emitGridUpdate: async () => undefined,
};

describe('AccountModule integration', () => {
    let app: INestApplication;
    let dataSource: DataSource;
    let redis: Redis;
    let accountService: AccountService;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ envFilePath: '.env.test', isGlobal: true }),
                RedisModule.forRoot({
                    type: 'single',
                    url: redisTestUrl,
                    options: {},
                }),
                TypeOrmModule.forRoot({
                    type: 'postgres',
                    url: postgresTestUrl,
                    entities: [LedgerEntry, LedgerSnapshot],
                    synchronize: true,
                    dropSchema: true,
                }),
                AccountModule,
            ],
        })
            .overrideModule(SocketModule)
            .useModule({
                module: class AccountTestSocketModule { },
                providers: [{ provide: EVENT_PUBLISHER, useValue: silentEventPublisher }],
                exports: [EVENT_PUBLISHER],
            })
            .compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        dataSource = app.get(DataSource);
        accountService = app.get(AccountService);
        redis = new Redis(redisTestUrl);
    });

    beforeEach(async () => {
        await cleanup();
    });

    afterEach(async () => {
        await cleanup();
    });

    afterAll(async () => {
        await redis.quit();
        await app.close();
    });

    async function cleanup() {
        if (redis) {
            await redis.flushdb();
        }

        if (dataSource) {
            await dataSource.getRepository(LedgerSnapshot).clear();
            await dataSource.getRepository(LedgerEntry).clear();
        }
    }

    it('applies individual account actions in sequence', async () => {
        const userId = 'account-sequential-user';

        await accountService.deposit(userId, '1000', 'deposit-tx', 1);
        await expectBalance(userId, {
            free: '1000',
            freeTap: '0',
            locked: '0',
            lastLedgerSeq: '1',
        });

        await accountService.placeBet(userId, '100', 'market-1', 'cell-1');
        await expectBalance(userId, {
            free: '900',
            freeTap: '0',
            locked: '100',
            lastLedgerSeq: '2',
        });

        await accountService.settleBet(userId, '100', true, '2', 'market-1', 'cell-1');
        await expectBalance(userId, {
            free: '1100',
            freeTap: '0',
            locked: '0',
            lastLedgerSeq: '3',
        });

        await accountService.withdrawRequested(userId, '500', 'withdraw-session');
        await expectBalance(userId, {
            free: '600',
            freeTap: '0',
            locked: '500',
            lastLedgerSeq: '4',
        });

        await accountService.withdrawSucceeded(userId, '500', 'withdraw-tx', 1);
        await expectBalance(userId, {
            free: '600',
            freeTap: '0',
            locked: '0',
            lastLedgerSeq: '5',
        });

        const entries = await dataSource.getRepository(LedgerEntry).find({
            where: { userId },
            order: { ledgerSeq: 'ASC' },
        });
        expect(entries.map((entry) => entry.ledgerSeq)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('keeps winning decimal reward payouts at 9-digit balance precision', async () => {
        const userId = 'account-decimal-reward-user';

        await accountService.deposit(userId, '1000', 'decimal-reward-deposit-tx', 1);
        await accountService.placeBet(userId, '101', 'market-decimal', 'cell-decimal');
        await accountService.settleBet(userId, '101', true, '1.956000', 'market-decimal', 'cell-decimal');

        await expectBalance(userId, {
            free: '1096.556',
            freeTap: '0',
            locked: '0',
            lastLedgerSeq: '3',
        });

        const settlementEntry = await dataSource.getRepository(LedgerEntry).findOneByOrFail({
            userId,
            eventType: 'BET_SETTLE',
        });
        expect(settlementEntry.deltas.free).toBe('197.556');
    });

    it('deduplicates repeated economic events', async () => {
        const userId = 'account-dedup-user';

        await accountService.deposit(userId, '1000', 'duplicate-deposit-tx', 1);
        await accountService.deposit(userId, '1000', 'duplicate-deposit-tx', 1);

        await expectBalance(userId, {
            free: '1000',
            freeTap: '0',
            locked: '0',
            lastLedgerSeq: '1',
        });

        const entries = await dataSource.getRepository(LedgerEntry).findBy({ userId });
        expect(entries).toHaveLength(1);
    });

    it('handles concurrent orders for one account without overspending', async () => {
        const userId = 'account-concurrent-user';

        await accountService.deposit(userId, '1000', 'concurrent-deposit-tx', 1);

        const results = await Promise.allSettled(
            Array.from({ length: 20 }, (_, index) =>
                accountService.placeBet(userId, '100', 'market-concurrent', `cell-${index}`),
            ),
        );

        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        const rejected = results.filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(10);
        expect(rejected).toHaveLength(10);
        await expectBalance(userId, {
            free: '0',
            freeTap: '0',
            locked: '1000',
            lastLedgerSeq: '11',
        });

        const entries = await dataSource.getRepository(LedgerEntry).find({
            where: { userId },
            order: { ledgerSeq: 'ASC' },
        });
        expect(entries).toHaveLength(11);
        expect(entries.map((entry) => entry.ledgerSeq)).toEqual(
            Array.from({ length: 11 }, (_, index) => String(index + 1)),
        );
    });

    async function expectBalance(
        userId: string,
        expected: {
            free: string;
            freeTap: string;
            locked: string;
            lastLedgerSeq: string;
        },
    ) {
        await expect(accountService.getBalance(userId)).resolves.toMatchObject({
            userId,
            ...expected,
        });
    }
});

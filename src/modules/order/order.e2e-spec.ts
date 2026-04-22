import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-modules/ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

import { Cell, signCell } from '../../libs/cell';
import { defaultMarketConfig } from '../../libs/market.config';
import { PriceTick } from '../../libs/price-tick';
import { AccountModule } from '../account/account.module';
import { AccountService } from '../account/account.service';
import { LedgerEntry } from '../account/entities/ledger-entry.entity';
import { LedgerSnapshot } from '../account/entities/ledger-snapshot.entity';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';
import { SocketModule } from '../socket/socket.module';
import { Order } from './entities/order.entity';
import { OrderModule } from './order.module';
import { OrderService } from './order.service';
import { OrderStatus } from './types';

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

describe('OrderModule integration', () => {
    const fixedNow = 1768450682526;
    const originalDateNow = Date.now;

    let app: INestApplication;
    let dataSource: DataSource;
    let redis: Redis;
    let accountService: AccountService;
    let orderService: OrderService;

    beforeAll(async () => {
        Date.now = () => fixedNow;

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
                    entities: [LedgerEntry, LedgerSnapshot, Order],
                    synchronize: true,
                    dropSchema: true,
                }),
                AccountModule,
                OrderModule,
            ],
        })
            .overrideModule(SocketModule)
            .useModule({
                module: class OrderTestSocketModule { },
                providers: [{ provide: EVENT_PUBLISHER, useValue: silentEventPublisher }],
                exports: [EVENT_PUBLISHER],
            })
            .compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        dataSource = app.get(DataSource);
        accountService = app.get(AccountService);
        orderService = app.get(OrderService);
        redis = new Redis(redisTestUrl);
    });

    beforeEach(async () => {
        await cleanup();
    });

    afterEach(async () => {
        await cleanup();
    });

    afterAll(async () => {
        Date.now = originalDateNow;
        await redis.quit();
        await app.close();
    });

    async function cleanup() {
        if (redis) {
            await redis.flushdb();
        }

        if (dataSource) {
            await dataSource.getRepository(Order).clear();
            await dataSource.getRepository(LedgerSnapshot).clear();
            await dataSource.getRepository(LedgerEntry).clear();
        }
    }

    it('places orders and settles win/loss against account balances', async () => {
        const user1Id = 'order-user-winner';
        const user2Id = 'order-user-loser';
        const marketId = 'BTCUSDT';
        const startTs = nextTradableStartTs();

        await accountService.deposit(user1Id, '1000', 'order-deposit-user-1', 1);
        await accountService.deposit(user2Id, '1000', 'order-deposit-user-2', 1);

        const winningCell = signedCell({
            startTs,
            lowerPrice: '90',
            upperPrice: '110',
            rewardRate: '2',
        });
        const losingCell = signedCell({
            startTs,
            lowerPrice: '10',
            upperPrice: '20',
            rewardRate: '2',
        });

        const winningOrder = await orderService.placeOrder(user1Id, {
            amount: '100',
            marketId,
            cell: winningCell,
        });
        const losingOrder = await orderService.placeOrder(user2Id, {
            amount: '100',
            marketId,
            cell: losingCell,
        });

        await expectBalance(user1Id, { free: '900', locked: '100' });
        await expectBalance(user2Id, { free: '900', locked: '100' });
        expect(winningOrder.status).toBe(OrderStatus.OPEN);
        expect(losingOrder.status).toBe(OrderStatus.OPEN);

        const winningTick: PriceTick = {
            timestamp: startTs + 10,
            price: 100,
        };
        await orderService.handleSinglePriceTick(winningTick);

        await expectBalance(user1Id, { free: '1100', locked: '0' });
        await expectBalance(user2Id, { free: '900', locked: '100' });

        const expiredTick: PriceTick = {
            timestamp: startTs + defaultMarketConfig.gridXSize + 1,
            price: 100,
        };
        await orderService.handleSinglePriceTick(expiredTick);

        await expectBalance(user2Id, { free: '900', locked: '0' });

        const savedWinner = await orderService.getOrderById(winningOrder.orderId);
        const savedLoser = await orderService.getOrderById(losingOrder.orderId);
        expect(savedWinner).toMatchObject({
            status: OrderStatus.SETTLED,
            settledWin: true,
            settledAt: winningTick.timestamp,
        });
        expect(savedLoser).toMatchObject({
            status: OrderStatus.SETTLED,
            settledWin: false,
            settledAt: expiredTick.timestamp,
        });
    });

    it('rolls back optimistic order state when account rejects the bet', async () => {
        const userId = 'order-insufficient-user';
        const marketId = 'BTCUSDT';
        const startTs = nextTradableStartTs();
        const cell = signedCell({
            startTs,
            lowerPrice: '90',
            upperPrice: '110',
            rewardRate: '2',
        });

        await accountService.deposit(userId, '50', 'small-order-deposit', 1);

        await expect(orderService.placeOrder(userId, {
            amount: '100',
            marketId,
            cell,
        })).rejects.toThrow('Insufficient balance');

        await expectBalance(userId, { free: '50', locked: '0' });
        await expect(dataSource.getRepository(Order).find()).resolves.toHaveLength(0);

        await accountService.deposit(userId, '100', 'second-order-deposit', 1);
        const order = await orderService.placeOrder(userId, {
            amount: '100',
            marketId,
            cell,
        });
        expect(order.status).toBe(OrderStatus.OPEN);
        await expectBalance(userId, { free: '50', locked: '100' });
    });

    it('handles concurrent order placements without account overspending', async () => {
        const userId = 'order-concurrent-user';
        const marketId = 'BTCUSDT';
        const startTs = nextTradableStartTs();

        await accountService.deposit(userId, '1000', 'concurrent-order-deposit', 1);

        const results = await Promise.allSettled(
            Array.from({ length: 20 }, (_, index) => orderService.placeOrder(userId, {
                amount: '100',
                marketId,
                cell: signedCell({
                    startTs,
                    lowerPrice: String(10 + index),
                    upperPrice: String(11 + index),
                    rewardRate: '2',
                }),
            })),
        );

        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        const rejected = results.filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(10);
        expect(rejected).toHaveLength(10);
        await expectBalance(userId, { free: '0', locked: '1000' });

        const orders = await dataSource.getRepository(Order).findBy({ userId });
        expect(orders).toHaveLength(10);
    });

    function nextTradableStartTs(): number {
        const minStart = fixedNow + defaultMarketConfig.gridXSize * 3;
        const remainder = minStart % defaultMarketConfig.gridXSize;
        return remainder === 0 ? minStart : minStart + defaultMarketConfig.gridXSize - remainder;
    }

    function signedCell(params: {
        startTs: number;
        lowerPrice: string;
        upperPrice: string;
        rewardRate: string;
    }): Cell {
        const cell: Cell = {
            gridTs: params.startTs,
            startTs: params.startTs,
            endTs: params.startTs + defaultMarketConfig.gridXSize,
            lowerPrice: params.lowerPrice,
            upperPrice: params.upperPrice,
            rewardRate: params.rewardRate,
            gridSignature: '',
        };
        cell.gridSignature = signCell(cell, process.env.CELL_SIGNER_KEY);
        return cell;
    }

    async function expectBalance(userId: string, expected: { free: string; locked: string }) {
        await expect(accountService.getBalance(userId)).resolves.toMatchObject({
            userId,
            free: expected.free,
            freeTap: '0',
            locked: expected.locked,
        });
    }
});

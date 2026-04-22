import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { OrderStatus } from './types';
import { TokenBucket } from 'src/libs/token-bucket';
import { EVENT_PUBLISHER, EventPublisher, OrderUpdateMessage } from '../socket/types';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { Repository } from 'typeorm';
import { buildCellFromOrder, getCellId, signCell } from 'src/libs/cell';
import { PriceTick } from 'src/libs/price-tick';
import { defaultMarketConfig, getSettledStartTs } from 'src/libs/market.config';
import { BigNumber } from 'bignumber.js';
import { env } from 'src/config';

@Injectable()
export class OrderService implements OnModuleInit {
    private readonly logger = new Logger(OrderService.name);

    // In-memory state
    // public for testing/inspection
    private userCellIndex = new Map<string, Map<string, boolean>>(); // userId -> Set<cellId>
    private activeOrdersByBucket = new Map<number, Map<string, Order>>(); // timeBucket -> Map<orderId, ActiveOrder>

    private rateLimiters = new Map<string, TokenBucket>();

    constructor(
        @InjectRepository(Order)
        private readonly orderRepository: Repository<Order>,
        private readonly accountService: AccountService,
        @Inject(EVENT_PUBLISHER)
        private readonly events: EventPublisher,
    ) {
    }

    async onModuleInit() {
        this.logger.debug('Initializing OrderService');
        console.log('----------Initializing OrderService');
        const activeOrders = await this.getPeristedActiveOrders();
        this.logger.debug(`Loaded ${activeOrders.length} active orders from DB`);
        console.log('----------Loaded', activeOrders.length, 'active orders from DB');
        this.activeOrdersByBucket = this.buildActiveOrdersByBucket(activeOrders);
        this.logger.debug(`Loaded ${this.activeOrdersByBucket.size} active orders into memory`);
        console.log('----------Loaded', this.activeOrdersByBucket.size, 'active orders into memory');
        this.userCellIndex = this.buildUserCellIndex(activeOrders);
        this.logger.debug(`Loaded ${this.userCellIndex.size} user cells into memory`);
        console.log('----------Loaded', this.userCellIndex.size, 'user cells into memory');
    }

    buildActiveOrdersByBucket(activeOrders: Order[]) {
        const bucketMap = new Map<number, Map<string, Order>>();
        for (const order of activeOrders) {
            const bucket = bucketMap.get(order.cellTimeStart);
            if (!bucket) {
                bucketMap.set(order.cellTimeStart, new Map());
            }
            bucketMap.get(order.cellTimeStart)!.set(order.orderId, order);
        }
        return bucketMap;
    }
    buildUserCellIndex(activeOrders: Order[]) {
        const userCellIndex = new Map<string, Map<string, boolean>>();
        for (const order of activeOrders) {
            const userCells = userCellIndex.get(order.userId);
            if (!userCells) {
                userCellIndex.set(order.userId, new Map());
            }
            userCellIndex.get(order.userId)!.set(getCellId(buildCellFromOrder(order)), true);
        }
        return userCellIndex;
    }

    async handleSinglePriceTick(priceTick: PriceTick) {
        const settledStartTs = getSettledStartTs(priceTick.timestamp);

        // 1️⃣ Winning bucket
        const bucket = this.activeOrdersByBucket.get(settledStartTs);
        const winSettlePromises: Promise<void>[] = [];
        if (bucket) {
            for (const order of bucket.values()) {
                const win =
                    BigNumber(priceTick.price).lte(order.upperPrice) &&
                    BigNumber(priceTick.price).gte(order.lowerPrice);
                if (win) {
                    this.logger.debug(`Order ${order.orderId} won at ${priceTick.timestamp}, ${priceTick.price}`);
                    winSettlePromises.push(this.settleOrder(order, priceTick.timestamp, true));
                }
            }
        }
        await Promise.all(winSettlePromises);

        // 2️⃣ Expired buckets
        const expireSettlePromises: Promise<void>[] = [];
        for (const [bucketStartTs, bucket] of this.activeOrdersByBucket) {
            if (bucketStartTs + defaultMarketConfig.gridXSize < priceTick.timestamp) {
                for (const order of bucket.values()) {
                    this.logger.debug(`Order ${order.orderId} expired at ${priceTick.timestamp}`);
                    expireSettlePromises.push(this.settleOrder(order, priceTick.timestamp, false));
                }
            }
        }
        await Promise.all(expireSettlePromises);
    }


    async placeOrder(userId: string, dto: PlaceOrderDto): Promise<Order> {
        // 0. validate cell
        // a. Cell deadline check
        const xSize = defaultMarketConfig.gridXSize;
        if (dto.cell.startTs < Date.now() + xSize) {
            throw new Error("Cell hit deadline. Can't place it anymore")
        }

        // b. Cell signature check
        const expectedSignature = signCell(dto.cell, env.secret.cellSignerKey);
        if (dto.cell.gridSignature !== expectedSignature) {
            throw new Error("Invalid cell signature");
        }

        // 1. Rate Limit
        let rateLimiter = this.rateLimiters.get(userId);
        if (!rateLimiter) {
            rateLimiter = new TokenBucket({
                capacity: 20,
                refillRatePerSecond: 5,
            });
            this.rateLimiters.set(userId, rateLimiter);
        }

        const canPlace = await rateLimiter.consume(1);
        if (!canPlace) {
            throw new Error('Order placement rate limit exceeded');
        }

        const cellId = getCellId(dto.cell);
        // this.logger.debug(`Placing order for cell ${cellId}`);
        // 2. Duplicate Check
        const userCells = this.userCellIndex.get(userId);
        if (userCells && userCells.get(cellId)) {
            throw new Error('Duplicate order for this cell');
        }

        // 4. Create Active Order
        // Design: OrderID = hash(user_id + CellID)
        // For simplicity/uniqueness in JS, we can use `${userId}:${dto.cellId}` as the ID or hash it.
        const orderId = `${userId}:${cellId}`;

        // 6. Optimistic Fanout ws
        const wsMsg: OrderUpdateMessage = {
            orderId,
            userId,
            amount: dto.amount,
            marketId: dto.marketId,
            cell: dto.cell,
            status: OrderStatus.OPEN,
        }
        await this.events.emitOrderUpdate(wsMsg)

        // 5. Update In-mem Active Orders (Optimistic Lock)
        // Crucial: Must update BEFORE placeBet to prevent double-spending in race conditions
        if (!this.userCellIndex.has(userId)) {
            this.userCellIndex.set(userId, new Map());
        }
        this.userCellIndex.get(userId).set(cellId, true);

        // 3. Call Account Service
        // This will throw if insufficient balance
        try {
            await this.accountService.placeBet(userId, dto.amount, dto.marketId, cellId);
            // Bucket storage
            let bucket = this.activeOrdersByBucket.get(dto.cell.startTs);
            if (!bucket) {
                bucket = new Map();
                this.activeOrdersByBucket.set(dto.cell.startTs, bucket);
            }
            const order: Order = {
                orderId,
                userId,
                marketId: dto.marketId,
                cellTimeStart: dto.cell.startTs,
                cellTimeEnd: dto.cell.endTs,
                lowerPrice: dto.cell.lowerPrice,
                upperPrice: dto.cell.upperPrice,
                amount: dto.amount,
                rewardRate: dto.cell.rewardRate,
                placedAt: Date.now(),
                status: OrderStatus.OPEN,
            };
            bucket.set(orderId, order);
            this.logger.log(`Order placed: ${orderId}`);

            // 7. Save to DB
            const dbRecord = this.orderRepository.create(order);
            await this.orderRepository.save(dbRecord);
            return order;
        } catch (error) {
            // Rollback optimistic updates on failure
            this.userCellIndex.get(userId)?.delete(cellId);

            // Emit rejection event
            const rejectMsg: OrderUpdateMessage = {
                ...wsMsg,
                status: OrderStatus.REJECTED,
            };
            await this.events.emitOrderUpdate(rejectMsg);

            throw error;
        }
    }

    async settleOrder(order: Order, settledTs: number, win: boolean): Promise<void> {
        if (order.status === OrderStatus.SETTLED) {
            this.logger.warn(`Order already settled: ${order.orderId}`);
            return;
        }

        const cell = buildCellFromOrder(order);
        const cellId = getCellId(cell);

        // 1. Call Account Service
        await this.accountService.settleBet(
            order.userId,
            order.amount,
            win,
            order.rewardRate,
            order.marketId,
            cellId
        );

        // 2. Update Status
        order.status = OrderStatus.SETTLED;

        this.logger.log(`Order settled: ${order.orderId}, Win: ${win}`);
        // 3. Fanout ws
        const wsMsg: OrderUpdateMessage = {
            orderId: order.orderId,
            userId: order.userId,
            marketId: order.marketId,
            cell,
            status: OrderStatus.SETTLED,
            amount: order.amount,
            settledWin: win,
            settledTimestamp: settledTs,
        }
        await this.events.emitOrderUpdate(wsMsg)

        // 4. Cleanup User Index
        const userCells = this.userCellIndex.get(order.userId);
        if (userCells) {
            userCells.delete(cellId);
            if (userCells.size === 0) {
                this.userCellIndex.delete(order.userId);
            }
        }

        // 5. Remove from active orders
        const bucket = this.activeOrdersByBucket.get(order.cellTimeStart);
        if (bucket) {
            bucket.delete(order.orderId);
            if (bucket.size === 0) {
                this.activeOrdersByBucket.delete(order.cellTimeStart);
            }
        }

        // 6. Update db record
        order.settledAt = settledTs;
        order.settledWin = win;

        await this.orderRepository.save(order);
    }

    async getOrderById(orderId: string): Promise<Order | null> {
        return this.orderRepository.findOneBy({ orderId });
    }

    async getPeristedActiveOrders(): Promise<Order[]> {
        return this.orderRepository.find({
            where: {
                status: OrderStatus.OPEN,
            },
        });
    }

    async getUserOrders(userId: string, status?: OrderStatus, limit: number = 20, offset: number = 0): Promise<Order[]> {
        const where: any = { userId };
        if (status) {
            where.status = status;
        }
        return this.orderRepository.find({
            where,
            take: limit,
            skip: offset,
            order: {
                placedAt: 'DESC',
            },
        });
    }

}

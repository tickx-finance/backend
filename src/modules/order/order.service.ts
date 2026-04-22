import { Injectable, Logger } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { OrderStatus } from './types';
import { TokenBucket } from 'src/libs/token-bucket';
import { SocketService } from '../socket/socket.service';
import { OrderUpdateMessage } from '../socket/types';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { Repository } from 'typeorm';
import { buildCellFromOrder } from 'src/libs/cell';
import { PriceTick } from 'src/libs/price-tick';
import { defaultMarketConfig, getSettledStartTs } from 'src/libs/market.config';
import { BigNumber } from 'bignumber.js';

@Injectable()
export class OrderService {
    private readonly logger = new Logger(OrderService.name);

    // In-memory state
    // public for testing/inspection
    public readonly userCellIndex = new Map<string, Set<string>>(); // userId -> Set<cellId>
    public readonly activeOrdersByBucket = new Map<number, Map<string, Order>>(); // timeBucket -> Map<orderId, ActiveOrder>

    private rateLimiters = new Map<string, TokenBucket>();
    private priceTickQueue: PriceTick[] = [];
    constructor(
        @InjectRepository(Order)
        private readonly orderRepository: Repository<Order>,
        private readonly accountService: AccountService,
        private readonly socketService: SocketService,
    ) {
    }

    enqueuePriceTick(priceTick: PriceTick) {
        this.priceTickQueue.push(priceTick);
        this.processMarketPriceTicks();
    }

    async processMarketPriceTicks() {
        while (this.priceTickQueue.length > 0) {
            const priceTick = this.priceTickQueue.shift();
            this.logger.log(`Processing price tick: ${priceTick}`);
            const settledStartTs = getSettledStartTs(priceTick.timestamp);
            const bucket = this.activeOrdersByBucket.get(settledStartTs);
            if (bucket) {
                for (const order of bucket.values()) {
                    const win = BigNumber(priceTick.price).lte(order.upperPrice) && BigNumber(priceTick.price).gte(order.lowerPrice);
                    if (win) {
                        this.settleOrder(order, priceTick.timestamp, true);
                    }
                }
            }
            // fetch all bucket that has endTs <= priceTick.timestamp
            for (const [bucketStartTs, bucket] of this.activeOrdersByBucket) {
                if (bucketStartTs + defaultMarketConfig.gridXSize < priceTick.timestamp) {
                    for (const order of bucket.values()) {
                        this.settleOrder(order, priceTick.timestamp, false);
                    }
                }
            }
        }
    }

    async placeOrder(userId: string, dto: PlaceOrderDto): Promise<Order> {
        // 0. validate cell
        const xSize = defaultMarketConfig.gridXSize;
        if (dto.cell.startTs < Date.now() + xSize) {
            throw new Error("Cell hit deadline. Can't place it anymore")
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

        const cellId = dto.cell.id;
        // 2. Duplicate Check
        const userCells = this.userCellIndex.get(userId);
        if (userCells && userCells.has(cellId)) {
            throw new Error('Duplicate order for this cell');
        }

        // 3. Call Account Service
        // This will throw if insufficient balance
        await this.accountService.placeBet(userId, dto.amount, dto.marketId, cellId);

        // 4. Create Active Order
        // Design: OrderID = hash(user_id + CellID)
        // For simplicity/uniqueness in JS, we can use `${userId}:${dto.cellId}` as the ID or hash it.
        const orderId = `${userId}:${cellId}`;

        // TODO: We need cellTimeEnd to bucket correctly. 
        // For now, receiving it in DTO or defaulting.
        // Let's assume the client passes it or we fetch it. 
        // Updating DTO to include it is safest for now without a GridService.

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

        // 5. Update In-mem Active Orders
        if (!this.userCellIndex.has(userId)) {
            this.userCellIndex.set(userId, new Set());
        }
        this.userCellIndex.get(userId).add(cellId);

        // Bucket storage
        let bucket = this.activeOrdersByBucket.get(dto.cell.startTs);
        if (!bucket) {
            bucket = new Map();
            this.activeOrdersByBucket.set(dto.cell.startTs, bucket);
        }
        bucket.set(orderId, order);

        this.logger.log(`Order placed: ${orderId}`);
        // 6. Fanout ws
        const wsMsg: OrderUpdateMessage = {
            orderId,
            userId,
            marketId: dto.marketId,
            cell: dto.cell,
            status: OrderStatus.OPEN,
        }
        await this.socketService.emitOrderUpdate(wsMsg)

        // 7. Save to DB
        const dbRecord = this.orderRepository.create(order);
        await this.orderRepository.save(dbRecord);
        return order;
    }

    async settleOrder(order: Order, settledTs: number, win: boolean): Promise<void> {
        if (order.status === OrderStatus.SETTLED) {
            this.logger.warn(`Order already settled: ${order.orderId}`);
            return;
        }

        const cell = buildCellFromOrder(order);
        const cellId = cell.id;

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
        }
        await this.socketService.emitOrderUpdate(wsMsg)

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
}

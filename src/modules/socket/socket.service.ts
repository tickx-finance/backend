import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { LatestPriceState } from 'src/libs/price-tick';
import { BalanceUpdateMessage, DepositSuccessMessage, EventName, EventPublisher, getGridRoom, getUserRoom, OrderUpdateMessage, WithdrawCancelledMessage, WithdrawQueuedMessage, WithdrawSuccessMessage } from './types';
import { Cell } from 'src/libs/cell';

@Injectable()
@WebSocketGateway({
    cors: {
        origin: '*', // TODO: change to production domain
    },
})
export class SocketService implements EventPublisher {
    @WebSocketServer() server: Server;
    constructor() { }

    async emitGridUpdate(msg: Cell[]) {
        this.server
            .emit(EventName.GridUpdate, msg);
    }

    async emitBalanceUpdate(msg: BalanceUpdateMessage) {
        this.server
            .to(getUserRoom(msg.userId))
            .emit(EventName.BalanceUpdate, msg);
    }

    async emitOrderUpdate(msg: OrderUpdateMessage) {
        this.server
            .to(getUserRoom(msg.userId))
            .emit(EventName.OrderUpdate, msg);
    }

    async emitDepositSuccess(msg: DepositSuccessMessage) {
        this.server
            .to(getUserRoom(msg.userId))
            .emit(EventName.DepositSuccess, msg);
    }

    async emitWithdrawQueued(msg: WithdrawQueuedMessage) {
        this.server
            .to(getUserRoom(msg.userId))
            .emit(EventName.WithdrawQueued, msg);
    }

    async emitWithdrawCancelled(msg: WithdrawCancelledMessage) {
        this.server
            .to(getUserRoom(msg.userId))
            .emit(EventName.WithdrawCancelled, msg);
    }

    async emitWithdrawSuccess(msg: WithdrawSuccessMessage) {
        this.server
            .to(getUserRoom(msg.userId))
            .emit(EventName.WithdrawSuccess, msg);
    }

    async emitNewPrice(price: LatestPriceState) {
        const msg = { price: price.price, ts: price.ts }
        this.server
            .emit(EventName.PriceNow, msg);
    }
}

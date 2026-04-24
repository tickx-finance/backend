/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import {
  EventName,
  getSuggestedStrategyRoom,
  getOrderFollowTargetRoom,
  getUserRoom,
  PlaceOrderPayload,
  SubscribeOrderFollowsPayload,
  SubscribeUserPayload,
} from './types';
import { AuthService } from '../auth/auth.service';
import { OrderService } from '../order/order.service';
import { getCellId } from 'src/libs/cell';
import { OrderFollowService } from '../order-follow/order-follow.service';

@WebSocketGateway({
  cors: {
    origin: '*', // TODO: change to production domain
  },
})
export class SocketGateway {
  private readonly logger: Logger = new Logger(SocketGateway.name);

  constructor(
    private readonly authService: AuthService,
    private readonly orderService: OrderService,
    private readonly orderFollowService: OrderFollowService,
  ) {

  }
  @WebSocketServer() server: Server;

  @SubscribeMessage(EventName.SubscribeUser)
  async handleSubscribeUser(@ConnectedSocket() client: Socket, @MessageBody() payload: SubscribeUserPayload) {
    const message = payload.userId
    const signature = payload.signature

    if (await this.authService.validateWssSignature(payload.userId, message, signature, true)) {
      const room = getUserRoom(payload.userId);
      client.join(room)

      client.emit('subscribed', { room, status: 'success' });

      this.logger.log(`User ${client.id} joined ${room}`);
    } else {
      client.send('Invalid wss signature');
    }

  }

  @SubscribeMessage(EventName.SubscribeOrderFollows)
  async handleSubscribeOrderFollows(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubscribeOrderFollowsPayload,
  ) {
    const message = payload.userId;

    if (await this.authService.validateWssSignature(payload.userId, message, payload.signature, true)) {
      const canListen = await this.orderFollowService.canListenToTarget(
        payload.userId,
        payload.targetUserId,
      );
      if (!canListen) {
        client.send('Order follow subscription is not active or eligible');
        return;
      }

      const room = getOrderFollowTargetRoom(payload.targetUserId);
      client.join(room);

      client.emit('subscribed', { room, status: 'success' });
      this.logger.log(`User ${client.id} joined order follow target room ${room}`);
    } else {
      client.send('Invalid wss signature');
    }
  }

  @SubscribeMessage(EventName.SubscribeSuggestedStrategy)
  async handleSubscribeSuggestedStrategy(
    @ConnectedSocket() client: Socket,
  ) {
    const room = getSuggestedStrategyRoom();
    client.join(room);
    client.emit('subscribed', { room, status: 'success' });
    this.logger.log(`User ${client.id} joined suggested strategy room ${room}`);
  }

  @SubscribeMessage(EventName.UnsubscribeSuggestedStrategy)
  async handleUnsubscribeSuggestedStrategy(
    @ConnectedSocket() client: Socket,
  ) {
    const room = getSuggestedStrategyRoom();
    client.leave(room);
    client.emit('unsubscribed', { room, status: 'success' });
    this.logger.log(`User ${client.id} left suggested strategy room ${room}`);
  }

  @SubscribeMessage(EventName.UnsubscribeOrderFollows)
  async handleUnsubscribeOrderFollows(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubscribeOrderFollowsPayload,
  ) {
    const message = payload.userId;

    if (await this.authService.validateWssSignature(payload.userId, message, payload.signature, true)) {
      const canListen = await this.orderFollowService.canListenToTarget(
        payload.userId,
        payload.targetUserId,
      );
      if (!canListen) {
        client.send('Order follow subscription is not active or eligible');
        return;
      }

      const room = getOrderFollowTargetRoom(payload.targetUserId);
      client.leave(room);

      client.emit('unsubscribed', { room, status: 'success' });
      this.logger.log(`User ${client.id} left order follow target room ${room}`);
    } else {
      client.send('Invalid wss signature');
    }
  }

  @SubscribeMessage(EventName.PlaceBet)
  async handlePlaceBet(@ConnectedSocket() client: Socket, @MessageBody() payload: PlaceOrderPayload) {
    const cellId = getCellId(payload.cell);
    const message = `${payload.cell.gridTs}:${cellId}:${payload.amount}`;

    if (await this.authService.validateWssSignature(payload.userId, message, payload.userSignature, false)) {
      try {
        await this.orderService.placeOrder(payload.userId, {
          amount: payload.amount,
          cell: payload.cell,
          marketId: payload.marketId,
        });
      } catch (e) {
        this.logger.error(`Place bet failed: ${e.message}`);
        client.send(`Place bet failed: ${e.message}`);
      }
    } else {
      client.send('Invalid wss signature');
    }
  }
}

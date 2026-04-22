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
import { EventName, getGridRoom, getUserRoom, PlaceOrderPayload, SubscribeUserPayload } from './types';
import { AuthService } from '../auth/auth.service';
import { OrderService } from '../order/order.service';

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
  ) {

  }
  @WebSocketServer() server: Server;

  @SubscribeMessage(EventName.SubscribeGrid)
  handleSubscribeGrid(@ConnectedSocket() client: Socket) {
    const room = getGridRoom();
    client.join(room)

    client.emit('subscribed', { room, status: 'success' });

    this.logger.log(`User ${client.id} joined ${room}`);
  }

  @SubscribeMessage(EventName.SubscribeUser)
  handleSubscribeUser(@ConnectedSocket() client: Socket, @MessageBody() payload: SubscribeUserPayload) {
    const message = payload.userId
    const signature = payload.signature

    if (this.authService.validateWssSignature(payload.userId, message, signature, true)) {
      const room = getUserRoom(payload.userId);
      client.join(room)

      client.emit('subscribed', { room, status: 'success' });

      this.logger.log(`User ${client.id} joined ${room}`);
    } else {
      client.send('Invalid wss signature');
    }

  }

  @SubscribeMessage(EventName.PlaceBet)
  async handlePlaceBet(@ConnectedSocket() client: Socket, @MessageBody() payload: PlaceOrderPayload) {
    const cellId = payload.cell.id;
    const message = `${payload.cell.gridTs}:${cellId}:${payload.amount}`;

    if (this.authService.validateWssSignature(payload.userId, message, payload.userSignature, false)) {
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

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

@WebSocketGateway({
  cors: {
    origin: '*', // TODO: change to production domain
  },
})
export class SocketGateway {
  private readonly logger: Logger = new Logger(SocketGateway.name);

  constructor(
    private readonly authService: AuthService,
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
  handlePlaceBet(@ConnectedSocket() client: Socket, @MessageBody() payload: PlaceOrderPayload) {
    const message = payload.userId
    const signature = payload.signature

    if (this.authService.validateWssSignature(payload.userId, message, signature, false)) {
      // TODO: implement place bet logic
    } else {
      client.send('Invalid wss signature');
    }
  }
}

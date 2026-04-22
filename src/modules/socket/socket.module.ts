import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { SocketService } from './socket.service';

import { AuthModule } from '../auth/auth.module';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [AuthModule, OrderModule],
  providers: [SocketGateway, SocketService],
  controllers: [],
  exports: [SocketService]
})
export class SocketModule { }

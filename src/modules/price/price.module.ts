import { Module } from '@nestjs/common';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { SocketModule } from '../socket/socket.module';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [SocketModule, OrderModule],
  controllers: [PriceController],
  providers: [PriceService],
  exports: [PriceService],
})
export class PriceModule { }

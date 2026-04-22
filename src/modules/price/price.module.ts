import { Module } from '@nestjs/common';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { OhlcController } from './ohlc.controller';

import { SocketModule } from '../socket/socket.module';
import { OrderModule } from '../order/order.module';
import { OhlcService } from './ohlc.service';

@Module({
  imports: [SocketModule, OrderModule],
  controllers: [PriceController, OhlcController],
  providers: [PriceService, OhlcService],
  exports: [PriceService, OhlcService],
})
export class PriceModule {}

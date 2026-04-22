import { forwardRef, Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { AccountModule } from '../account/account.module';
import { OrderPriceTickChannel } from './price-tick.channel';
import { OrderWorker } from './order.worker';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { SocketModule } from '../socket/socket.module';

@Module({
    imports: [forwardRef(() => AccountModule), TypeOrmModule.forFeature([Order]), forwardRef(() => SocketModule)],
    controllers: [OrderController],
    providers: [OrderService, OrderWorker,
        {
            provide: OrderPriceTickChannel,
            useValue: new OrderPriceTickChannel(),
        },],
    exports: [OrderService, OrderWorker, OrderPriceTickChannel],
})
export class OrderModule { }

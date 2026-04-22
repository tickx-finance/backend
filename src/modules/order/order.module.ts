import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { AccountModule } from '../account/account.module';
import { OrderPriceTickChannel } from './price-tick.channel';
import { OrderWorker } from './order.worker';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { ORDER_EVENT_PUBLISHER } from './order.events';

@Module({
    imports: [AccountModule, TypeOrmModule.forFeature([Order]),],
    controllers: [OrderController],
    providers: [OrderService, OrderWorker,
        // 👇 declare the port
        {
            provide: ORDER_EVENT_PUBLISHER,
            useFactory: () => {
                throw new Error(
                    'ORDER_EVENT_PUBLISHER not provided. Did you forget to override it?',
                );
            },
        },
        {
            provide: OrderPriceTickChannel,
            useValue: new OrderPriceTickChannel(),
        },],
    exports: [OrderService, OrderWorker],
})
export class OrderModule { }

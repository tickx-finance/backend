import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { OrderService } from "./order.service";
import { OrderPriceTickChannel } from "./price-tick.channel";

@Injectable()
export class OrderWorker implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(OrderWorker.name);
    private running = true;

    constructor(
        private readonly priceTickChannel: OrderPriceTickChannel,
        private readonly orderService: OrderService,
    ) { }

    onModuleInit() {
        void this.run();
    }

    onModuleDestroy() {
        this.running = false;
        this.priceTickChannel.close();
    }

    private async run() {
        console.log('----------OrderWorker started');
        this.logger.log('OrderWorker started');

        while (this.running) {
            try {
                const priceTick = await this.priceTickChannel.receive();
                console.log('----------Received price tick', priceTick);
                await this.orderService.handleSinglePriceTick(priceTick);
            } catch (err) {
                this.logger.error('Worker loop error', err);
            }
        }
    }
}

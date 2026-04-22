import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import { env } from './config';
import dataSource from './libs/typeorm.config';
import { PaymentCoreModule } from './modules/payment/payment-core.module';
import { PaymentWorkerRunner } from './modules/payment/payment-worker-runner.service';
import { PaymentWorkerHealthController } from './payment-worker-health.controller';

@Module({
    imports: [
        ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
        TypeOrmModule.forRoot(dataSource.options),
        RedisModule.forRoot({
            type: 'single',
            url: env.redis.url,
            options: {},
        }),
        PaymentCoreModule,
    ],
    controllers: [PaymentWorkerHealthController],
    providers: [PaymentWorkerRunner],
})
export class PaymentWorkerModule { }

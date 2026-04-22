import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import { env } from './config';
import dataSource from './libs/typeorm.config';
import { PaymentModule } from './modules/payment/payment.module';
import { PaymentWorkerRunner } from './modules/payment/payment-worker-runner.service';

@Module({
    imports: [
        ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
        TypeOrmModule.forRoot(dataSource.options),
        RedisModule.forRoot({
            type: 'single',
            url: env.redis.url,
            options: {},
        }),
        PaymentModule,
    ],
    providers: [PaymentWorkerRunner],
})
export class PaymentWorkerModule { }

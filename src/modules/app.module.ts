import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectRedis, RedisModule } from '@nestjs-modules/ioredis';
import { env } from 'src/config';
import Redis from 'ioredis';
import dataSource from 'src/libs/typeorm.config';
import { HealthCheckModule } from './health-check/health-check.module';
import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { OrderModule } from './order/order.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
        TypeOrmModule.forRoot(dataSource.options),
        RedisModule.forRoot({
            type: 'single',
            url: env.redis.url,
            options: {},
        }),
        HealthCheckModule,
        AccountModule,
        AuthModule,
        OrderModule
    ],
})
export class AppModule implements OnModuleInit {
    constructor(@InjectRedis() private readonly redis: Redis) { }

    async onModuleInit() { }
}

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PaymentWorkerModule } from './payment-worker.module';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(PaymentWorkerModule, {
        logger: new Logger('[]'),
    });
    const logger = new Logger('PAYMENT_WORKER');

    app.useLogger(logger);
    app.enableShutdownHooks();

    logger.warn('Payment worker process started');
}

bootstrap();

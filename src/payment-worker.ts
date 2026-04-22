import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { env } from './config';
import { PaymentWorkerModule } from './payment-worker.module';

async function bootstrap() {
    const app = await NestFactory.create(PaymentWorkerModule, {
        logger: new Logger('[]'),
    });
    const logger = new Logger('PAYMENT_WORKER');

    app.useLogger(logger);
    app.enableShutdownHooks();

    await app.listen(env.workerPort, () => {
        logger.warn(`Payment worker process started on port ${env.workerPort}`);
    });
}

bootstrap();

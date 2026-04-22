import { Module } from '@nestjs/common';

import { PaymentController } from './payment.controller';
import { PaymentCoreModule } from './payment-core.module';

@Module({
    imports: [PaymentCoreModule],
    controllers: [PaymentController],
    exports: [PaymentCoreModule],
})
export class PaymentModule { }

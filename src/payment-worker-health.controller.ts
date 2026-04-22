import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class PaymentWorkerHealthController {
    @Get()
    health() {
        return {
            status: 'ok',
            service: 'payment-worker',
            timestamp: new Date().toISOString(),
        };
    }
}

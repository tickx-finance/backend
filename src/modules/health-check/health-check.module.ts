import { Module } from '@nestjs/common';
import { HealthCheckService } from './health-check.service';
import { HealthCheckController } from './health-check.controller';
import { PriceModule } from '../price/price.module';

@Module({
  imports: [PriceModule],
  controllers: [HealthCheckController],
  providers: [HealthCheckService],
})
export class HealthCheckModule {}

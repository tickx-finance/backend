import { Module } from '@nestjs/common';
import { DistributionController } from './distribution.controller';

@Module({
  controllers: [DistributionController],
  providers: [],
  exports: [],
})
export class DistributionModule {}

import { Module } from '@nestjs/common';
import { StrategyController } from './strategy.controller';

@Module({
  controllers: [StrategyController],
  providers: [],
  exports: [],
})
export class StrategyModule {}

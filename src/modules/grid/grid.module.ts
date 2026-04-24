import { Module } from '@nestjs/common';
import { GridService } from './grid.service';
import { GridController } from './grid.controller';
import { PriceModule } from '../price/price.module';
import { SocketModule } from '../socket/socket.module';
import { GridOracleStateService } from './fortress-engine/fortress-oracle-state.service';
import { FortressStateEngine } from './fortress-engine/fortress-state-engine';
import { FortressLiabilityModule } from './fortress-engine/fortress-liability.module';
import { SuggestedStrategyService } from './suggested-strategy.service';

@Module({
  imports: [SocketModule, PriceModule, FortressLiabilityModule],
  controllers: [GridController],
  providers: [GridService, GridOracleStateService, FortressStateEngine, SuggestedStrategyService],
})
export class GridModule {}

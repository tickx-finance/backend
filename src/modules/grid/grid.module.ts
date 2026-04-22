import { Module } from '@nestjs/common';
import { GridService } from './grid.service';
import { GridController } from './grid.controller';
import { PriceModule } from '../price/price.module';
import { SocketModule } from '../socket/socket.module';
import { GridOracleStateService } from './fortress-engine/fortress-oracle-state.service';
import { FortressStateEngine } from './fortress-engine/fortress-state-engine';

@Module({
  imports: [SocketModule, PriceModule],
  controllers: [GridController],
  providers: [GridService, GridOracleStateService, FortressStateEngine],
})
export class GridModule {}

import { Module } from '@nestjs/common';
import { GridService } from './grid.service';
import { GridController } from './grid.controller';
import { PriceModule } from '../price/price.module';
import { SocketModule } from '../socket/socket.module';

@Module({
  imports: [SocketModule, PriceModule],
  controllers: [GridController],
  providers: [GridService],
})
export class GridModule {}

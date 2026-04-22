import { Controller } from '@nestjs/common';
import { GridService } from './grid.service';

@Controller('grid')
export class GridController {
  constructor(private readonly gridService: GridService) {}
}

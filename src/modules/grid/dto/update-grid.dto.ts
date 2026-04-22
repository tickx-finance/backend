import { PartialType } from '@nestjs/mapped-types';
import { CreateGridDto } from './create-grid.dto';

export class UpdateGridDto extends PartialType(CreateGridDto) {}

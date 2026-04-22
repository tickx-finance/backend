import { Type } from 'class-transformer';
import { IsInt, Min, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class QueryEventsDto {
  @ApiProperty({
    description: 'From block timestamp (Unix timestamp in seconds)',
    example: 1704067200,
    type: Number,
  })
  @Type(() => Number)
  @IsInt({ message: 'fromTimestamp must be an integer' })
  @Min(0, { message: 'fromTimestamp must be >= 0' })
  fromTimestamp: number;

  @ApiProperty({
    description: 'To block timestamp (Unix timestamp in seconds)',
    example: 1704068100,
    type: Number,
  })
  @Type(() => Number)
  @IsInt({ message: 'toTimestamp must be an integer' })
  @Min(0, { message: 'toTimestamp must be >= 0' })
  toTimestamp: number;

  @ApiProperty({
    description: 'Page number (1-based)',
    example: 1,
    default: 1,
    type: Number,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be >= 1' })
  page?: number = 1;

  @ApiProperty({
    description: 'Page size (max 100)',
    example: 20,
    default: 20,
    type: Number,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize must be an integer' })
  @Min(1, { message: 'pageSize must be >= 1' })
  pageSize?: number = 20;

  @ApiProperty({
    description: 'Contract address to filter by',
    example: '0x60430364ebc71ac11720f012756cea2c294c50de',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  contractAddress?: string;

  @ApiProperty({
    description: 'Epoch ID to filter by',
    example: '12345',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  epochId?: string;
}

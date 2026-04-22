import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetSettlementBatchesDto {
  @ApiProperty({
    description: 'Unix timestamp (seconds) - window start',
    example: 1704067200,
    type: Number,
  })
  @Type(() => Number)
  @IsInt({ message: 'windowStart must be an integer' })
  @Min(0, { message: 'windowStart must be >= 0' })
  windowStart: number;

  @ApiProperty({
    description: 'Unix timestamp (seconds) - window end',
    example: 1704068100,
    type: Number,
  })
  @Type(() => Number)
  @IsInt({ message: 'windowEnd must be an integer' })
  @Min(0, { message: 'windowEnd must be >= 0' })
  windowEnd: number;
}

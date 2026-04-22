import { IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { Cell } from 'src/libs/cell';
import { ApiProperty } from '@nestjs/swagger';

export class PlaceOrderDto {
    @ApiProperty({ type: Cell })
    @Type(() => Cell)
    cell: Cell;

    @ApiProperty({ type: String })
    @IsNotEmpty()
    @IsString()
    marketId: string;

    @ApiProperty({ type: String })
    @IsNotEmpty()
    @IsString()
    amount: string;
}

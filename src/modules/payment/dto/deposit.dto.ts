import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class DepositDto {
    @ApiProperty({ type: String })
    @IsString()
    amount: string;

    @ApiProperty({ type: String, required: false })
    @IsOptional()
    @IsString()
    txHash?: string;

    @ApiProperty({ type: Number, required: false })
    @IsOptional()
    @IsNumber()
    logIndex?: number;
}

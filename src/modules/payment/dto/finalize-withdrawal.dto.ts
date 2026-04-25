import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

export class FinalizeWithdrawalDto {
    @ApiProperty({ type: String })
    @IsString()
    sessionId: string;

    @ApiProperty({ type: String })
    @IsString()
    txHash: string;

    @ApiProperty({ type: Number })
    @IsNumber()
    logIndex: number;
}

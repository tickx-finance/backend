import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class WithdrawRequestDto {
    @ApiProperty({ type: String })
    @IsString()
    amount: string;
}

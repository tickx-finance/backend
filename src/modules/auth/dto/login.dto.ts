import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    address: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    signature: string;
}

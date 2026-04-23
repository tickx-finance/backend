import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RegisterOrderFollowDto {
    @ApiProperty({ type: String })
    @IsString()
    @IsNotEmpty()
    targetUserId: string;
}

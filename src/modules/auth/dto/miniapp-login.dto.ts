import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString, ValidateNested } from 'class-validator';

export class MiniAppWalletAuthSuccessPayloadDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    status: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    message: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    signature: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    address: string;

    @IsNumber()
    @IsNotEmpty()
    @Type(() => Number)
    @ApiProperty({ type: Number })
    version: number;
}

export class MiniAppVerifyHumanPayloadDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    proof: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    merkle_root: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    nullifier_hash: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    verification_level: string;
}

export class MiniAppVerifyHumanDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    action: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    signal: string;

    @ValidateNested()
    @Type(() => MiniAppVerifyHumanPayloadDto)
    @ApiProperty({ type: MiniAppVerifyHumanPayloadDto })
    payload: MiniAppVerifyHumanPayloadDto;
}

export class MiniAppLoginDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    nonce: string;

    @ValidateNested()
    @Type(() => MiniAppWalletAuthSuccessPayloadDto)
    @ApiProperty({ type: MiniAppWalletAuthSuccessPayloadDto })
    payload: MiniAppWalletAuthSuccessPayloadDto;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ type: String })
    miniAppUserId: string;
}

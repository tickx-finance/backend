import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { WithdrawalStatus } from '../entities/withdrawal-session.entity';

export class GetWithdrawalsDto {
    @IsOptional()
    @IsEnum(WithdrawalStatus)
    status?: WithdrawalStatus;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    limit?: number = 20;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    offset?: number = 0;
}

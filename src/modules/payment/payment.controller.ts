import { Controller, Post, Body, Param, Get, Query, UseGuards } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GetDepositsDto } from './dto/get-deposits.dto';
import { GetWithdrawalsDto } from './dto/get-withdrawals.dto';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

class DepositDto {
    @ApiProperty({ type: String })
    @IsString()
    amount: string;
    @ApiProperty({ type: String })
    @IsString()
    txHash: string;
    @ApiProperty({ type: Number })
    @IsNumber()
    logIndex: number;
}

class WithdrawRequestDto {
    @ApiProperty({ type: String })
    @IsString()
    amount: string;
}

class FinalizeWithdrawalDto {
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

@ApiBearerAuth()
@ApiTags('payment')
@Controller('payment')
export class PaymentController {
    constructor(private readonly paymentService: PaymentService) { }

    @Post('withdraw')
    @UseGuards(JwtAuthGuard)
    async requestWithdrawal(@CurrentUser() user: { address: string }, @Body() dto: WithdrawRequestDto) {
        return this.paymentService.requestWithdrawal(user.address, dto.amount);
    }

    // --- Debug Endpoints ---

    @Post('debug/deposit')
    @UseGuards(JwtAuthGuard)
    async debugDeposit(@CurrentUser() user: { address: string }, @Body() dto: DepositDto) {
        return this.paymentService.handleDeposit(user.address, dto.amount, dto.txHash, dto.logIndex);
    }

    @Post('debug/finalize-withdrawal')
    @UseGuards(JwtAuthGuard)
    async debugFinalizeWithdrawal(@CurrentUser() user: { address: string }, @Body() dto: FinalizeWithdrawalDto) {
        return this.paymentService.finalizeWithdrawal(dto.sessionId, dto.txHash, dto.logIndex);
    }

    @Post('debug/expire-timeout')
    @UseGuards(JwtAuthGuard)
    async debugExpireTimeout(@CurrentUser() user: { address: string }, @Body() body: { sessionId: string }) {
        return this.paymentService.expireWithdrawal(body.sessionId);
    }

    @Get('deposits')
    @UseGuards(JwtAuthGuard)
    async getUserDeposits(
        @CurrentUser() user: { address: string },
        @Query() query: GetDepositsDto,
    ) {
        return this.paymentService.getUserDeposits(user.address, query.limit, query.offset);
    }

    @Get('withdrawal/session')
    @UseGuards(JwtAuthGuard)
    async getActiveWithdrawalSession(@CurrentUser() user: { address: string }) {
        return this.paymentService.getActiveWithdrawalSession(user.address);
    }

    @Get('withdrawals')
    @UseGuards(JwtAuthGuard)
    async getUserWithdrawals(
        @CurrentUser() user: { address: string },
        @Query() query: GetWithdrawalsDto,
    ) {
        return this.paymentService.getUserWithdrawals(user.address, query.status, query.limit, query.offset);
    }
}


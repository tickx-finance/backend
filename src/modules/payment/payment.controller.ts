import { Controller, Post, Body, Get, Query, UseGuards } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GetDepositsDto } from './dto/get-deposits.dto';
import { GetWithdrawalsDto } from './dto/get-withdrawals.dto';
import { ExpireTimeoutDto } from './dto/expire-timeout.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentChainSyncWorker } from './payment-chain-sync.worker';
import { DepositDto } from './dto/deposit.dto';
import { FinalizeWithdrawalDto } from './dto/finalize-withdrawal.dto';
import { WithdrawRequestDto } from './dto/withdraw-request.dto';

@ApiBearerAuth()
@ApiTags('payment')
@Controller('payment')
export class PaymentController {
    constructor(
        private readonly paymentService: PaymentService,
        private readonly paymentChainSyncWorker: PaymentChainSyncWorker,
    ) { }

    @Post('withdraw')
    @UseGuards(JwtAuthGuard)
    async requestWithdrawal(@CurrentUser() user: { address: string }, @Body() dto: WithdrawRequestDto) {
        return this.paymentService.requestWithdrawal(user.address, dto.amount);
    }

    // --- Debug Endpoints ---

    @Post('debug/deposit')
    @UseGuards(JwtAuthGuard)
    async debugDeposit(@CurrentUser() user: { address: string }, @Body() dto: DepositDto) {
        return this.paymentService.handleDeposit(
            user.address,
            dto.amount,
            dto.txHash ?? this.buildFaucetTxHash(user.address),
            dto.logIndex ?? 0,
        );
    }

    @Post('debug/finalize-withdrawal')
    @UseGuards(JwtAuthGuard)
    async debugFinalizeWithdrawal(@CurrentUser() user: { address: string }, @Body() dto: FinalizeWithdrawalDto) {
        return this.paymentService.finalizeWithdrawal(dto.sessionId, dto.txHash, dto.logIndex);
    }

    @Post('debug/expire-timeout')
    @UseGuards(JwtAuthGuard)
    async debugExpireTimeout(@CurrentUser() user: { address: string }, @Body() dto: ExpireTimeoutDto) {
        return this.paymentService.expireWithdrawal(dto.sessionId);
    }

    @Get('chain-sync/status')
    @UseGuards(ApiKeyGuard)
    async getChainSyncStatus() {
        return this.paymentChainSyncWorker.getStatus();
    }

    @Post('chain-sync/run-once')
    @UseGuards(ApiKeyGuard)
    async runChainSyncOnce() {
        return this.paymentChainSyncWorker.syncOnce();
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

    private buildFaucetTxHash(userId: string): string {
        return `faucet:${userId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    }
}

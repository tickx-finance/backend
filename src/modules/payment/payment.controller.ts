import { Controller, Post, Body, Param } from '@nestjs/common';
import { PaymentService } from './payment.service';

interface DepositDto {
    userId: string;
    amount: string;
    txHash: string;
    logIndex: number;
}

interface WithdrawRequestDto {
    userId: string;
    amount: string;
}

interface FinalizeWithdrawalDto {
    sessionId: string;
    txHash: string;
    logIndex: number;
}

@Controller('payment')
export class PaymentController {
    constructor(private readonly paymentService: PaymentService) { }

    @Post('withdraw')
    async requestWithdrawal(@Body() dto: WithdrawRequestDto) {
        return this.paymentService.requestWithdrawal(dto.userId, dto.amount);
    }

    // --- Debug Endpoints ---

    @Post('debug/deposit')
    async debugDeposit(@Body() dto: DepositDto) {
        return this.paymentService.handleDeposit(dto.userId, dto.amount, dto.txHash, dto.logIndex);
    }

    @Post('debug/finalize-withdrawal')
    async debugFinalizeWithdrawal(@Body() dto: FinalizeWithdrawalDto) {
        return this.paymentService.finalizeWithdrawal(dto.sessionId, dto.txHash, dto.logIndex);
    }

    @Post('debug/expire-timeout')
    async debugExpireTimeout(@Body() body: { sessionId: string }) {
        return this.paymentService.expireWithdrawal(body.sessionId);
    }
}

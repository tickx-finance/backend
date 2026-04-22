import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccountService } from './account.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BalanceState } from './types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiBearerAuth()
@ApiTags('account')
@Controller('account')
export class AccountController {
    constructor(private readonly accountService: AccountService) { }

    @Get('balance')
    @UseGuards(JwtAuthGuard)
    async getBalance(@CurrentUser() user: { address: string }): Promise<BalanceState> {
        return this.accountService.getBalance(user.address);
    }
}

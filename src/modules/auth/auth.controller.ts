import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { MiniAppLoginDto, MiniAppVerifyHumanDto } from './dto/miniapp-login.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Get('challenge')
    @ApiOperation({ summary: 'Get a challenge message to sign' })
    async getChallenge(@Query('address') address: string) {
        const challenge = await this.authService.generateChallenge(address);
        return { challenge };
    }

    @Post('login')
    @ApiOperation({ summary: 'Login with signed challenge' })
    async login(@Body() body: LoginDto) {
        return this.authService.login(body.address, body.signature);
    }

    @Post('miniapp/login')
    @ApiOperation({ summary: 'Login with Worldchain mini-app payload' })
    async miniAppLogin(@Body() body: MiniAppLoginDto) {
        return this.authService.loginMiniApp(body);
    }

    @Post('miniapp/verify-human')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Verify Worldchain mini-app human proof for the current user' })
    async verifyMiniAppHuman(
        @CurrentUser() user: { address: string },
        @Body() body: MiniAppVerifyHumanDto,
    ) {
        return this.authService.verifyMiniAppHuman(user.address, body);
    }

    @Get('miniapp/nonce')
    @ApiOperation({ summary: 'Get a one-time nonce for Worldchain mini-app login' })
    async getMiniAppNonce() {
        return { nonce: await this.authService.generateMiniAppNonce() };
    }

    @Get('wss-key')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get a new WSS key (requires JWT)' })
    async getWssKey(@CurrentUser() user: { address: string }) {
        return this.authService.generateWssKey(user.address);
    }
}

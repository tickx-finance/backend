import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';

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
    async login(@Body() body: { address: string; signature: string }) {
        return this.authService.login(body.address, body.signature);
    }

    @Get('wss-key')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get a new WSS key (requires JWT)' })
    async getWssKey(@CurrentUser() user: { address: string }) {
        return this.authService.generateWssKey(user.address);
    }
}

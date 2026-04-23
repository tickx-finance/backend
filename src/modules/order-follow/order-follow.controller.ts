import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RegisterOrderFollowDto } from './dto/register-order-follow.dto';
import { OrderFollowService } from './order-follow.service';

@ApiBearerAuth()
@ApiTags('order-follows')
@Controller('order-follows')
@UseGuards(JwtAuthGuard)
export class OrderFollowController {
    constructor(private readonly orderFollowService: OrderFollowService) { }

    @Post()
    async register(
        @CurrentUser() user: { address: string },
        @Body() dto: RegisterOrderFollowDto,
    ) {
        return this.orderFollowService.register(user.address, dto.targetUserId);
    }

    @Delete(':targetUserId')
    async unsubscribe(
        @CurrentUser() user: { address: string },
        @Param('targetUserId') targetUserId: string,
    ) {
        return this.orderFollowService.unsubscribe(user.address, targetUserId);
    }

    @Get('following')
    async listFollowing(@CurrentUser() user: { address: string }) {
        return this.orderFollowService.listFollowing(user.address);
    }

    @Get('followers')
    async listFollowers(@CurrentUser() user: { address: string }) {
        return this.orderFollowService.listFollowers(user.address);
    }
}

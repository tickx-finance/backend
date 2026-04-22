import { Body, Controller, Post, UseGuards, Request, Get, Query } from '@nestjs/common';
import { OrderService } from './order.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { GetOrdersDto } from './dto/get-orders.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders')
export class OrderController {
    constructor(private readonly orderService: OrderService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    async placeOrder(@Body() dto: PlaceOrderDto, @CurrentUser() user: { address: string }) {
        return this.orderService.placeOrder(user.address, dto);
    }

    @Get('user')
    @UseGuards(JwtAuthGuard)
    async getUserOrders(
        @CurrentUser() user: { address: string },
        @Query() query: GetOrdersDto,
    ) {
        return this.orderService.getUserOrders(user.address, query.status, query.limit, query.offset);
    }
}


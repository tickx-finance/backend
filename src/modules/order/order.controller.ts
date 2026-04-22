import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { OrderService } from './order.service';
import { PlaceOrderDto } from './dto/place-order.dto';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Assuming generic guard exists or will be added

@Controller('orders')
export class OrderController {
    constructor(private readonly orderService: OrderService) { }

    @Post()
    // @UseGuards(JwtAuthGuard)
    async placeOrder(@Body() dto: PlaceOrderDto, @Request() req) {
        // Mock user id for now until auth is fully integrated/mocked
        const userId = req.user?.id || 'test-user-id';
        return this.orderService.placeOrder(userId, dto);
    }
}

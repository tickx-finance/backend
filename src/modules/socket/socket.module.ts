import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrderModule } from "../order/order.module";
import { SocketGateway } from "./socket.gateway";
import { SocketService } from "./socket.service";
import { ORDER_EVENT_PUBLISHER } from "../order/order.events";

@Module({
  imports: [AuthModule, OrderModule],
  providers: [
    SocketGateway,
    SocketService,
    {
      provide: ORDER_EVENT_PUBLISHER,
      useExisting: SocketService,
    },
  ],
  exports: [ORDER_EVENT_PUBLISHER],
})
export class SocketModule { }

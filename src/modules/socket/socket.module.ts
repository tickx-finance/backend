import { forwardRef, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SocketGateway } from "./socket.gateway";
import { SocketService } from "./socket.service";
import { EVENT_PUBLISHER } from "./types";
import { OrderModule } from "../order/order.module";

@Module({
  imports: [AuthModule, forwardRef(() => OrderModule)],
  providers: [
    SocketGateway,
    SocketService,
    {
      provide: EVENT_PUBLISHER,
      useExisting: SocketService,
    },
  ],
  exports: [EVENT_PUBLISHER]
})
export class SocketModule { }

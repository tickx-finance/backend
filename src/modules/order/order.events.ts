import { OrderUpdateMessage } from "../socket/types";

export interface OrderEventPublisher {
    emitOrderUpdate(msg: OrderUpdateMessage): Promise<void>;
}

export const ORDER_EVENT_PUBLISHER = Symbol('ORDER_EVENT_PUBLISHER');

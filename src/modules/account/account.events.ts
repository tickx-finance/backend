import { BalanceUpdateMessage } from "../socket/types";

export interface AccountEventPublisher {
    emitBalanceUpdate(msg: BalanceUpdateMessage): Promise<void>;
}

export const ACCOUNT_EVENT_PUBLISHER = Symbol('ACCOUNT_EVENT_PUBLISHER');

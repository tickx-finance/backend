import { DepositSuccessMessage, WithdrawCancelledMessage, WithdrawQueuedMessage, WithdrawSuccessMessage } from "../socket/types";

export interface PaymentEventPublisher {
    emitDepositSuccess(msg: DepositSuccessMessage): Promise<void>;
    emitWithdrawQueued(msg: WithdrawQueuedMessage): Promise<void>;
    emitWithdrawCancelled(msg: WithdrawCancelledMessage): Promise<void>;
    emitWithdrawSuccess(msg: WithdrawSuccessMessage): Promise<void>;
}

export const PAYMENT_EVENT_PUBLISHER = Symbol('PAYMENT_EVENT_PUBLISHER');
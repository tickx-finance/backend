import { Global, Module } from "@nestjs/common";
import { BalanceUpdateMessage, DepositSuccessMessage, EVENT_PUBLISHER, EventPublisher, OrderUpdateMessage, WithdrawCancelledMessage, WithdrawQueuedMessage, WithdrawSuccessMessage } from "../modules/socket/types";
import { LatestPriceState } from "src/libs/price-tick";
import { Cell } from "src/libs/cell";

export class MockEventPublisher implements EventPublisher {
    async emitDepositSuccess(msg: DepositSuccessMessage): Promise<void> {
        console.log('[MockEventPublisher] emitDepositSuccess', JSON.stringify(msg));
    }
    async emitWithdrawQueued(msg: WithdrawQueuedMessage): Promise<void> {
        console.log('[MockEventPublisher] emitWithdrawQueued', JSON.stringify(msg));
    }
    async emitWithdrawCancelled(msg: WithdrawCancelledMessage): Promise<void> {
        console.log('[MockEventPublisher] emitWithdrawCancelled', JSON.stringify(msg));
    }
    async emitWithdrawSuccess(msg: WithdrawSuccessMessage): Promise<void> {
        console.log('[MockEventPublisher] emitWithdrawSuccess', JSON.stringify(msg));
    }
    async emitOrderUpdate(msg: OrderUpdateMessage): Promise<void> {
        console.log('[MockEventPublisher] emitOrderUpdate', JSON.stringify(msg));
    }
    async emitBalanceUpdate(msg: BalanceUpdateMessage): Promise<void> {
        console.log('[MockEventPublisher] emitBalanceUpdate', JSON.stringify(msg));
    }
    async emitNewPrice(price: LatestPriceState): Promise<void> {
        console.log('[MockEventPublisher] emitNewPrice', JSON.stringify(price));
    }
    async emitGridUpdate(grid: Cell[]): Promise<void> {
        console.log('[MockEventPublisher] emitGridUpdate', JSON.stringify(grid));
    }
}
@Module({
    providers: [
        MockEventPublisher,
        {
            provide: EVENT_PUBLISHER,
            useExisting: MockEventPublisher
        },
    ],
    exports: [EVENT_PUBLISHER]
})
export class MockEventPublisherModule { }
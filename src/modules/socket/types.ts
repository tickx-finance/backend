import { Cell } from "src/libs/cell";
import { OrderStatus } from "../order/types";
import { LatestPriceState } from "src/libs/price-tick";

export enum SocketEvents {
    // Market Data
    GRID_UPDATE = 'grid_update',

    // User Data
    BALANCE_UPDATE = 'balance_update',
    ORDER_UPDATE = 'order_update',
    DEPOSIT_SUCCESS = 'deposit_success',
    WITHDRAW_QUEUED = 'withdraw_queued',
    WITHDRAW_CANCELLED = 'withdraw_cancelled',
    WITHDRAW_SUCCESS = 'withdraw_success',

    // System
    ERROR = 'error',
}

export enum SocketChannel {
    GRID = 'grid',
    USER = 'user', // Requires auth in real app, simplified here
    ORDER_FOLLOW_TARGET = 'order_follow_target',
    SUGGESTED_STRATEGY = 'suggested_strategy',
}

export enum EventName {
    UnsubscribeGrid = 'unsubscribe_grid',
    SubscribeUser = 'subscribe_user',
    UnsubscribeUser = 'unsubscribe_user',
    SubscribeOrderFollows = 'subscribe_order_follows',
    UnsubscribeOrderFollows = 'unsubscribe_order_follows',
    SubscribeSuggestedStrategy = 'subscribe_suggested_strategy',
    UnsubscribeSuggestedStrategy = 'unsubscribe_suggested_strategy',
    PlaceBet = 'place_bet',
    GridUpdate = 'grid_update',
    BalanceUpdate = 'balance_update',
    OrderUpdate = 'order_update',
    FollowedOrderUpdate = 'followed_order_update',
    DepositSuccess = 'deposit_success',
    WithdrawQueued = 'withdraw_queued',
    WithdrawCancelled = 'withdraw_cancelled',
    WithdrawSuccess = 'withdraw_success',
    PriceNow = 'price_now',
    FortressMcDiagnostics = 'fortress_mc_diagnostics',
    SuggestedStrategyUpdate = 'suggested_strategy_update',
}

export interface BalanceUpdateMessage {
    userId: string;
    free: string;
    locked: string;
    freeTap: string;
    timestamp: number;
}

export interface OrderUpdateMessage {
    orderId: string;
    userId: string;
    marketId: string;
    amount: string;
    cell: any;

    status: OrderStatus;
    settledTimestamp?: number;
    settledWin?: boolean;
}

export interface FollowedOrderUpdateMessage {
    targetUserId: string;
    orderId: string;
    marketId: string;
    amount: string;
    cell: any;
    status: OrderStatus;
    settledTimestamp?: number;
    settledWin?: boolean;
}

export interface DepositSuccessMessage {
    txHash: string;
    logIndex: number;
    userId: string;
    amount: string;
    timestamp: number;
}

export interface WithdrawQueuedMessage {
    sessionId: string;
    userId: string;
    amount: string;
    timestamp: number;
}

export interface WithdrawCancelledMessage {
    sessionId: string;
    userId: string;
    amount: string;
    timestamp: number;
}

export interface WithdrawSuccessMessage {
    userId: string;
    amount: string;
    timestamp: number;
    txHash: string;
    logIndex: number;
}

export interface FortressMcDiagnosticsMessage {
    paths: number[][];
    pRaw: number[][];
}

export type SuggestedStrategyVolatilityRegime = 'low' | 'medium' | 'high';

export interface SuggestedStrategyMessage {
    cells: Cell[];
    volatilityRegime: SuggestedStrategyVolatilityRegime;
    sigma: number | null;
    atrMean: number | null;
    timestamp: number;
}

export interface SubscribeUserPayload {
    userId: string;
    signature: string;
}

export interface SubscribeOrderFollowsPayload {
    userId: string;
    targetUserId: string;
    signature: string;
}

export interface PlaceOrderPayload {
    userId: string;
    marketId: string;
    amount: string;
    cell: Cell;
    userSignature: string;
}

export function getUserRoom(userId: string): string {
    return `${SocketChannel.USER}:${userId}`;
}

export function getGridRoom(): string {
    return `${SocketChannel.GRID}`;
}

export function getOrderFollowTargetRoom(targetUserId: string): string {
    return `${SocketChannel.ORDER_FOLLOW_TARGET}:${targetUserId}`;
}

export function getSuggestedStrategyRoom(): string {
    return `${SocketChannel.SUGGESTED_STRATEGY}`;
}

export interface EventPublisher {
    emitDepositSuccess(msg: DepositSuccessMessage): Promise<void>;
    emitWithdrawQueued(msg: WithdrawQueuedMessage): Promise<void>;
    emitWithdrawCancelled(msg: WithdrawCancelledMessage): Promise<void>;
    emitWithdrawSuccess(msg: WithdrawSuccessMessage): Promise<void>;
    emitOrderUpdate(msg: OrderUpdateMessage): Promise<void>;
    emitBalanceUpdate(msg: BalanceUpdateMessage): Promise<void>;
    emitNewPrice(price: LatestPriceState): Promise<void>;
    emitGridUpdate(grid: Cell[]): Promise<void>;
    emitFortressMcDiagnostics(msg: FortressMcDiagnosticsMessage): Promise<void>;
    emitSuggestedStrategyUpdate(msg: SuggestedStrategyMessage): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

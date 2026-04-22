import { Column, Entity } from "typeorm";
import { OrderStatus } from "../types";

@Entity('orders')
export class Order {
    @Column({ primary: true })
    orderId: string;

    @Column()
    userId: string;

    @Column()
    marketId: string;

    @Column()
    cellTimeStart: number;

    @Column()
    cellTimeEnd: number;

    @Column()
    lowerPrice: string;

    @Column()
    upperPrice: string;

    @Column()
    amount: string;

    @Column()
    rewardRate: string;

    @Column()
    placedAt: number;

    @Column({ enum: OrderStatus })
    status: OrderStatus;

    @Column()
    settledAt?: number;

    @Column()
    settledWin?: boolean;
}
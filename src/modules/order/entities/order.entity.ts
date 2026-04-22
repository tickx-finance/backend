import { Column, Entity, PrimaryColumn } from 'typeorm';
import { OrderStatus } from '../types';
import { BigIntMsTransformer } from 'src/libs/transformers';

@Entity('orders')
export class Order {
    @PrimaryColumn()
    orderId: string;

    @Column()
    userId: string;

    @Column()
    marketId: string;

    @Column({
        type: 'bigint',
        transformer: BigIntMsTransformer,
    })
    cellTimeStart: number;

    @Column({
        type: 'bigint',
        transformer: BigIntMsTransformer,
    })
    cellTimeEnd: number;

    @Column({ type: 'numeric' })
    lowerPrice: string;

    @Column({ type: 'numeric' })
    upperPrice: string;

    @Column({ type: 'numeric' })
    amount: string;

    @Column({ type: 'numeric' })
    rewardRate: string;

    @Column({
        type: 'bigint',
        transformer: BigIntMsTransformer,
    })
    placedAt: number;

    @Column({ type: 'enum', enum: OrderStatus })
    status: OrderStatus;

    @Column({
        type: 'bigint',
        nullable: true,
        transformer: BigIntMsTransformer,
    })
    settledAt?: number;

    @Column({ nullable: true })
    settledWin?: boolean;
}

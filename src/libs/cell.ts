import * as crypto from 'crypto';
import { ApiProperty } from '@nestjs/swagger';
import { Order } from 'src/modules/order/entities/order.entity';

export class Cell {
    @ApiProperty({ type: Number })
    gridTs: number;
    @ApiProperty({ type: Number })
    startTs: number;
    @ApiProperty({ type: Number })
    endTs: number;
    @ApiProperty({ type: String })
    lowerPrice: string;
    @ApiProperty({ type: String })
    upperPrice: string;
    @ApiProperty({ type: String })
    rewardRate: string;
    @ApiProperty({ type: String })
    gridSignature: string;
}

export function getCellId(cell: Cell) {
    return `${cell.startTs}:${cell.endTs}:${cell.lowerPrice}:${cell.upperPrice}`;
}
export function signCell(cell: Cell, privateKey: string): string {
    // hmac signature (gridTs, startTs, endTs, lowerPrice, upperPrice, rewardRate)
    return crypto.createHmac('sha256', privateKey)
        .update(`${cell.gridTs}`)
        .update(`${cell.startTs}`)
        .update(`${cell.endTs}`)
        .update(`${cell.lowerPrice}`)
        .update(`${cell.upperPrice}`)
        .update(`${cell.rewardRate}`)
        .digest('hex');
}

export function buildCellFromOrder(order: Order): Cell {
    return {
        gridTs: order.placedAt,
        startTs: order.cellTimeStart,
        endTs: order.cellTimeEnd,
        lowerPrice: order.lowerPrice,
        upperPrice: order.upperPrice,
        rewardRate: order.rewardRate,
        gridSignature: ''
    }
}
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { PriceService } from '../price/price.service';
import { Cell, signCell } from 'src/libs/cell';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';
import { env } from 'src/config';
import { normalizePrice } from 'src/libs/market.config';

const TIME_CELL = 5.0 * 1000;
const PRICE_CELL = 25.0;
const ANCHOR_OFFSET_X = 2;
const NX = 10;
const NY = 9;
function snapTime(ts: number) {
  return Math.floor(ts / TIME_CELL) * TIME_CELL;
}
function snapPrice(price: number) {
  return Math.floor(price / PRICE_CELL) * PRICE_CELL;
}
const MODEL_PARAMS = {
  a: -11.987330359,
  b: 5.391973076,
  c: 4.284584913,
  d: 0.156374928,
  e: -0.004784164,
  f: -1.305643156,
  g: 0.012375259,
  h: 0.04388643,
  k: 1.3977969340228305,
  m: 13.869637195218683,
};

const gridVersionMap: Record<string, Record<string, Record<string, Cell>>> = {};

@Injectable()
export class GridService implements OnModuleInit {
  constructor(
    @Inject(EVENT_PUBLISHER)
    private readonly eventPublisher: EventPublisher,
    private readonly priceService: PriceService,
  ) {}

  onModuleInit() {
    this.startSnapshotLoop();
    this.deleteGridVersionLoop();
  }

  private model(dx: number, dy: number): number {
    const { a, b, c, d, e, f, g, h, k, m } = MODEL_PARAMS;

    const x = dx - 1.5;
    const y = dy - 0.5;

    const logTerm = Math.log(x + m);

    return (
      a +
      b * logTerm +
      c * y +
      d * y * y +
      e * y * y * y +
      f * y * logTerm +
      g * y * y * logTerm +
      h * Math.pow(y, 4) * Math.exp(-x / k)
    );
  }

  getCell(gridTs: number, startTs: number, lowerPrice: number) {
    return gridVersionMap[gridTs]?.[startTs]?.[lowerPrice] || null;
  }

  private deleteGridVersionLoop() {
    setInterval(() => {
      const now = Date.now();
      const expiredGridTsList = Object.keys(gridVersionMap).filter(
        (gridTsStr) => {
          const gridTs = Number(gridTsStr);
          return gridTs + 2 * NX * TIME_CELL < now;
        },
      );

      for (const gridTs of expiredGridTsList) {
        delete gridVersionMap[gridTs];
      }
    }, 60 * 1000);
  }

  private startSnapshotLoop() {
    setInterval(() => {
      const latestTrade = this.priceService.getLatestTrade();
      if (!latestTrade) return;

      const { price, ts } = latestTrade;

      const gridTs = snapTime(ts);
      const gridPrice = snapPrice(price);

      const xMin = gridTs - ANCHOR_OFFSET_X * TIME_CELL;
      const yMin = gridPrice - Math.floor(NY / 2) * PRICE_CELL;

      const cells: Cell[] = [];

      for (let i = 0; i < NX; i++) {
        for (let j = 0; j < NY; j++) {
          const startTs = xMin + i * TIME_CELL;
          const endTs = startTs + TIME_CELL;

          const lowerPrice = yMin + j * PRICE_CELL;
          const upperPrice = lowerPrice + PRICE_CELL;

          const centerTs = (startTs + endTs) / 2;
          const centerPrice = (lowerPrice + upperPrice) / 2;

          const dx = (centerTs - ts) / TIME_CELL;
          if (dx <= 0) continue;

          const dy = Math.abs((centerPrice - price) / PRICE_CELL);

          const rewardRate = this.model(dx, dy);

          const cell = {
            gridTs,
            startTs,
            endTs,
            lowerPrice: normalizePrice(lowerPrice),
            upperPrice: normalizePrice(upperPrice),
            rewardRate: rewardRate.toFixed(6),
            gridSignature: ``,
          };

          const gridSignature = signCell(cell, env.secret.cellSignerKey);
          cell.gridSignature = gridSignature;

          if (!gridVersionMap[gridTs]) gridVersionMap[gridTs] = {};
          if (!gridVersionMap[gridTs][startTs])
            gridVersionMap[gridTs][startTs] = {};
          gridVersionMap[cell.gridTs][cell.startTs][cell.lowerPrice] = cell;

          cells.push(cell);
        }
      }

      this.eventPublisher.emitGridUpdate(cells);
    }, 250);
  }
}

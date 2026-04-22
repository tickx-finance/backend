export class PriceTick {
  timestamp: number;
  price: number;
}

// export interface LatestPriceState {
//   bid: number;
//   ask: number;
//   mid: number;
//   updateId: number;
//   ts: number; // server timestamp
// }

export interface LatestPriceState {
  price: number;      // last trade price
  qty: number;        // last trade quantity
  tradeId: number;    // agg trade id
  isSell: boolean;    // m = true → sell market order
  ts: number;
}

export interface BookTickerPayload {
  u: number; // order book updateId
  s: string; // symbol
  b: string; // best bid price
  B: string; // best bid quantity
  a: string; // best ask price
  A: string; // best ask quantity
}

export interface AggTradePayload {
  e: 'aggTrade';
  E: number; // event time
  s: string; // symbol
  a: number; // aggregate trade id
  p: string; // price
  q: string; // quantity
  f: number; // first trade id
  l: number; // last trade id
  T: number; // trade time
  m: boolean; // buyer is maker
  M: boolean; // ignore
}



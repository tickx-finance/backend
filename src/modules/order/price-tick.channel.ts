import { PriceTick } from "src/libs/price-tick";
import { QueueChannel } from "src/libs/queue-channel";

export class OrderPriceTickChannel extends QueueChannel<PriceTick> { }
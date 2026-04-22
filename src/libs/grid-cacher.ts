import { Cell } from "./cell";

export const gridVersionMap: Record<string, Record<string, Record<string, Cell>>> = {};

export function getCachedCell(gridTs: number, startTs: number, lowerPrice: string) {
    return gridVersionMap[gridTs]?.[startTs]?.[lowerPrice] || null;
}

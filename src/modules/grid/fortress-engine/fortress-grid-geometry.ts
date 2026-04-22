import { FORTRESS_MAIN_MODE } from './fortress.config';
import {
    FortressGeometryCell,
    FortressGridGeometry,
    FortressModeConfig,
} from './fortress.types';

const FORTRESS_ANCHOR_STEP_SECONDS = 5;
const FORTRESS_MIN_BETTABLE_OFFSET_SECONDS = 10;

export interface FortressGridGeometryInput {
    oracleSecond: number;
    price: number;
    mode?: FortressModeConfig;
    bandWidth?: number;
}

export function buildFortressGridGeometry({
    oracleSecond,
    price,
    mode = FORTRESS_MAIN_MODE,
    bandWidth = mode.bandWidth,
}: FortressGridGeometryInput): FortressGridGeometry {
    assertFinite('oracleSecond', oracleSecond);
    assertFinite('price', price);
    assertFinite('bandWidth', bandWidth);
    if (bandWidth <= 0) {
        throw new Error(`Invalid Fortress band width: ${bandWidth}`);
    }

    const timeAnchorSecond = getFortressTimeAnchorSecond(oracleSecond);
    const centerRow = clampInteger(mode.centerRow, 0, mode.rowCount - 1);
    const anchorPrice = Math.floor(price / bandWidth) * bandWidth;
    const cells: FortressGeometryCell[] = [];

    for (let row = 0; row < mode.rowCount; row += 1) {
        const center = anchorPrice + (row - centerRow) * bandWidth;
        const lowerPrice = center - bandWidth / 2;
        const upperPrice = center + bandWidth / 2;

        mode.windows.forEach(([windowStart, windowEnd], windowIndex) => {
            const startSecond = timeAnchorSecond + windowStart;
            cells.push({
                cellId: encodeFortressCellId(row, windowIndex, mode.windows.length),
                modeId: mode.modeId,
                row,
                windowIndex,
                lowerPrice,
                upperPrice,
                startSecond,
                endSecond: timeAnchorSecond + windowEnd,
                betable: startSecond >= timeAnchorSecond + FORTRESS_MIN_BETTABLE_OFFSET_SECONDS,
            });
        });
    }

    return {
        modeId: mode.modeId,
        oracleSecond,
        timeAnchorSecond,
        anchorPrice,
        bandWidth,
        centerRow,
        cells,
    };
}

export function getFortressTimeAnchorSecond(oracleSecond: number): number {
    return FORTRESS_ANCHOR_STEP_SECONDS * Math.floor(oracleSecond / FORTRESS_ANCHOR_STEP_SECONDS);
}

export function encodeFortressCellId(
    row: number,
    windowIndex: number,
    windowCount: number = FORTRESS_MAIN_MODE.windows.length,
): number {
    return row * windowCount + windowIndex;
}

export function decodeFortressCellId(
    cellId: number,
    mode: FortressModeConfig = FORTRESS_MAIN_MODE,
): Pick<FortressGeometryCell, 'modeId' | 'row' | 'windowIndex'> {
    const row = Math.floor(cellId / mode.windows.length);
    const windowIndex = cellId % mode.windows.length;
    if (row < 0 || row >= mode.rowCount || windowIndex < 0 || windowIndex >= mode.windows.length) {
        throw new Error(`Invalid Fortress cell id: ${cellId}`);
    }

    return {
        modeId: mode.modeId,
        row,
        windowIndex,
    };
}

function clampInteger(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(high, Math.trunc(value)));
}

function assertFinite(name: string, value: number): void {
    if (!Number.isFinite(value)) {
        throw new Error(`Invalid Fortress ${name}: ${value}`);
    }
}

import { describe, expect, it } from 'vitest';
import { getCellId } from 'src/libs/cell';
import { buildFortressGridGeometry } from './fortress-grid-geometry';
import { FortressLiabilityService, computeOrderLiability } from './fortress-liability.service';

describe('FortressLiabilityService', () => {
    it('tracks order payout liability and maps it to fortress cell ids', () => {
        const service = new FortressLiabilityService();
        const geometry = buildFortressGridGeometry({
            oracleSecond: 1710000007,
            price: 100092,
        });
        const cell = geometry.cells[0];
        const orderCell = {
            gridTs: 1710000007000,
            startTs: cell.startSecond * 1000,
            endTs: cell.endSecond * 1000,
            lowerPrice: cell.lowerPrice.toFixed(4),
            upperPrice: cell.upperPrice.toFixed(4),
            rewardRate: '2.5',
            gridSignature: '',
        };

        service.recordOrderPlaced(orderCell, '10', orderCell.rewardRate);

        expect(getCellId(orderCell)).toBe(`${orderCell.startTs}:${orderCell.endTs}:${orderCell.lowerPrice}:${orderCell.upperPrice}`);
        expect(service.getCellLiability(orderCell)).toBe('25');
        expect(service.getLiabilitiesByFortressCellId(geometry.cells)).toMatchObject({
            [cell.cellId]: 25,
        });

        service.recordOrderSettled(orderCell, '4', orderCell.rewardRate);
        expect(service.getCellLiability(orderCell)).toBe('15');

        service.recordOrderSettled(orderCell, '6', orderCell.rewardRate);
        expect(service.getCellLiability(orderCell)).toBe('0');
        expect(service.getLiabilitiesByFortressCellId(geometry.cells)).toEqual({});
    });

    it('computes order liability as stake times locked multiplier', () => {
        expect(computeOrderLiability('12.5', '1.75').toFixed()).toBe('21.875');
    });
});

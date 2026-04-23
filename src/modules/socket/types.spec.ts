import { describe, expect, it } from 'vitest';
import { getOrderFollowTargetRoom, SocketChannel } from './types';

describe('socket order follow rooms', () => {
    it('uses a target broadcast room for followed order updates', () => {
        expect(getOrderFollowTargetRoom('user-b')).toBe(`${SocketChannel.ORDER_FOLLOW_TARGET}:user-b`);
    });
});

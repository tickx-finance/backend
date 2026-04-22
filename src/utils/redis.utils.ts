import Redis from 'ioredis';

/**
 * Redis Lock Utility - Distributed locking mechanism
 */
export class RedisLock {
  /**
   * Set a lock key with NX (only if not exists) and EX (expire time)
   * Returns true if lock was acquired, false otherwise
   */
  static async setLock(
    redis: Redis,
    key: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await redis.set(
      `flag:${key}`,
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /**
   * Release a lock by deleting the key
   */
  static async releaseLock(redis: Redis, key: string): Promise<void> {
    await redis.del(`flag:${key}`);
  }
}

/**
 * Redis Checkpoint Utility - Track sync progress
 */
export class RedisCheckpoint {
  /**
   * Get the last synced block number
   */
  static async getCheckPoint(
    redis: Redis,
    key: string,
  ): Promise<number | null> {
    const value = await redis.get(key);
    return value ? parseInt(value, 10) : null;
  }

  /**
   * Set the checkpoint to a specific block number
   */
  static async setCheckPoint(
    redis: Redis,
    key: string,
    blockNumber: number,
  ): Promise<void> {
    await redis.set(key, blockNumber.toString());
  }

  /**
   * Calculate the toBlock number with a maximum gap limit
   * This prevents querying too many blocks at once (RPC timeout protection)
   */
  static calculateToBlock(
    currentBlock: number,
    fromBlock: number,
    maxGap: number,
  ): number {
    return Math.min(currentBlock, fromBlock + maxGap);
  }
}

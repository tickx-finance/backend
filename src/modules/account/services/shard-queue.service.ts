import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { env } from 'src/config';

interface QueueItem {
    userId: string;
    action: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
}

@Injectable()
export class ShardQueueService implements OnModuleInit {
    private readonly logger = new Logger(ShardQueueService.name);
    private readonly shardCount: number;
    private queues: Map<number, QueueItem[]> = new Map();
    private processing: Map<number, boolean> = new Map();

    constructor() {
        this.shardCount = env.account.shardCount;
    }

    onModuleInit() {
        this.logger.log(`Initializing ShardQueue with ${this.shardCount} shards`);
        for (let i = 0; i < this.shardCount; i++) {
            this.queues.set(i, []);
            this.processing.set(i, false);
        }
    }

    getShardId(userId: string): number {
        const hash = crypto.createHash('sha256').update(userId).digest('hex');
        const intVal = parseInt(hash.substring(0, 8), 16);
        return intVal % this.shardCount;
    }

    /**
     * Enqueue an action to be executed sequentially for the user's shard.
     * This guarantees that all actions for the same user (and other users on the same shard)
     * are executed one by one.
     */
    async enqueue<T>(userId: string, action: () => Promise<T>): Promise<T> {
        const shardId = this.getShardId(userId);

        return new Promise<T>((resolve, reject) => {
            const queue = this.queues.get(shardId);
            if (!queue) {
                return reject(new Error('Invalid shard ID'));
            }

            queue.push({ userId, action, resolve, reject });

            this.processQueue(shardId);
        });
    }

    private async processQueue(shardId: number) {
        if (this.processing.get(shardId)) {
            return;
        }

        this.processing.set(shardId, true);
        const queue = this.queues.get(shardId);

        while (queue && queue.length > 0) {
            const item = queue.shift(); // FIFO
            if (item) {
                try {
                    const result = await item.action();
                    item.resolve(result);
                } catch (error) {
                    this.logger.error(`Error processing action for user ${item.userId}: ${error.message}`, error.stack);
                    item.reject(error);
                }
            }
        }

        this.processing.set(shardId, false);
    }
}

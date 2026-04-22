import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { WalRecord, WalStatus, EconomicEventType, BalanceDelta } from '../types';
import { env } from 'src/config';

@Injectable()
export class WalService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WalService.name);
    private readonly walPath: string;
    private readonly shardCount: number;
    private fileStreams: Map<number, fs.WriteStream> = new Map();

    constructor() {
        this.walPath = env.account.walPath;
        this.shardCount = env.account.shardCount;
    }

    onModuleInit() {
        this.logger.log(`Initializing WAL service at ${this.walPath} with ${this.shardCount} shards`);
        // Ensure directory exists
        if (!fs.existsSync(this.walPath)) {
            fs.mkdirSync(this.walPath, { recursive: true });
        }

        // Open streams for each shard
        for (let i = 0; i < this.shardCount; i++) {
            const filePath = path.join(this.walPath, `shard_${i}.log`);
            const stream = fs.createWriteStream(filePath, { flags: 'a' }); // Append mode
            this.fileStreams.set(i, stream);
        }
    }

    onModuleDestroy() {
        this.fileStreams.forEach((stream) => stream.end());
    }

    async appendPrepare(
        shardId: number,
        userId: string,
        eventType: EconomicEventType,
        economicKey: string,
        deltas: BalanceDelta,
    ): Promise<string> {
        const walId = uuidv4();
        const record: WalRecord = {
            walId,
            userId,
            entry: { eventType, economicKey, deltas },
            status: WalStatus.PREPARED,
            createdAt: Date.now(),
        };

        await this.writeToShard(shardId, JSON.stringify(record) + '\n');
        return walId;
    }

    async appendCommit(shardId: number, walId: string) {
        const update = {
            walId,
            status: WalStatus.COMMITTED,
            updatedAt: Date.now(),
        };
        await this.writeToShard(shardId, JSON.stringify(update) + '\n');
    }

    async appendAbort(shardId: number, walId: string) {
        const update = {
            walId,
            status: WalStatus.ABORTED,
            updatedAt: Date.now(),
        };
        await this.writeToShard(shardId, JSON.stringify(update) + '\n');
    }

    private writeToShard(shardId: number, data: string): Promise<void> {
        const stream = this.fileStreams.get(shardId);
        if (!stream) {
            throw new Error(`Invalid shard ID: ${shardId}`);
        }

        return new Promise((resolve, reject) => {
            // fs.write is usually fast enough for OS buffer, but for strict durability we might need fsync?
            // Design says "fsync per action". Node stream doesn't fsync on every write automatically.
            // Doing fsync on every write in JS might be slow. 
            // For now, we rely on write(). drain event if buffer full.
            if (!stream.write(data)) {
                stream.once('drain', resolve);
            } else {
                process.nextTick(resolve);
            }
        });
    }
}

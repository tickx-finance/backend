import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { MiniAppNonce } from './entities/miniapp-nonce.entity';

const MINIAPP_NONCE_TTL_SECONDS = 300;

@Injectable()
export class MiniAppNonceService {
    constructor(
        @InjectRepository(MiniAppNonce)
        private readonly miniAppNonceRepo: Repository<MiniAppNonce>,
        @InjectRedis()
        private readonly redis: Redis,
    ) { }

    async createNonce(): Promise<string> {
        const nonce = randomUUID().replace(/-/g, '');
        await this.redis.set(this.getRedisKey(nonce), '1', 'EX', MINIAPP_NONCE_TTL_SECONDS);
        return nonce;
    }

    async consumeNonce(nonce: string): Promise<boolean> {
        const used = await this.miniAppNonceRepo.findOne({
            where: { nonce },
            select: ['id'],
        });
        if (used) {
            return false;
        }

        const exists = await this.redis.get(this.getRedisKey(nonce));
        if (!exists) {
            return false;
        }

        try {
            await this.miniAppNonceRepo.save(
                this.miniAppNonceRepo.create({ nonce }),
            );
        } catch (error: any) {
            if (error?.code === '23505') {
                return false;
            }
            throw error;
        }

        await this.redis.del(this.getRedisKey(nonce));
        return true;
    }

    private getRedisKey(nonce: string): string {
        return `auth:miniapp:nonce:${nonce}`;
    }
}

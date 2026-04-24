import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { AuthType, UserAuthProfile } from './entities/user-auth-profile.entity';

export interface UpsertUserAuthProfileInput {
    address: string;
    lastAuthType?: AuthType;
    miniAppUserId?: string | null;
    humanVerified?: boolean;
    humanVerifiedAt?: Date | null;
    humanVerificationSource?: string | null;
    nullifierHash?: string | null;
}

const USER_AUTH_PROFILE_CACHE_TTL_SECONDS = 60 * 60 * 24;

@Injectable()
export class UserAuthProfileService {
    constructor(
        @InjectRepository(UserAuthProfile)
        private readonly userAuthProfileRepo: Repository<UserAuthProfile>,
        @InjectRedis()
        private readonly redis: Redis,
    ) { }

    async getByAddress(address: string): Promise<UserAuthProfile | null> {
        return this.userAuthProfileRepo.findOne({ where: { address } });
    }

    async getByNullifierHash(nullifierHash: string): Promise<UserAuthProfile | null> {
        return this.userAuthProfileRepo.findOne({ where: { nullifierHash } });
    }

    async getCachedByAddress(address: string): Promise<UserAuthProfile | null> {
        const cacheKey = this.getCacheKey(address);
        const cached = await this.redis.get(cacheKey);
        if (cached) {
            return this.deserialize(cached);
        }

        const profile = await this.getByAddress(address);
        if (!profile) {
            return null;
        }

        await this.setCache(profile);
        return profile;
    }

    async upsert(input: UpsertUserAuthProfileInput): Promise<UserAuthProfile> {
        const existing = await this.userAuthProfileRepo.findOne({
            where: { address: input.address },
        });

        if (existing) {
            existing.lastAuthType = input.lastAuthType ?? existing.lastAuthType;
            if (input.miniAppUserId !== undefined) {
                existing.miniAppUserId = input.miniAppUserId;
            }
            if (input.humanVerified !== undefined) {
                existing.humanVerified = input.humanVerified;
            }
            if (input.humanVerifiedAt !== undefined) {
                existing.humanVerifiedAt = input.humanVerifiedAt;
            }
            if (input.humanVerificationSource !== undefined) {
                existing.humanVerificationSource = input.humanVerificationSource;
            }
            if (input.nullifierHash !== undefined) {
                existing.nullifierHash = input.nullifierHash;
            }
            const saved = await this.userAuthProfileRepo.save(existing);
            await this.setCache(saved);
            return saved;
        }

        try {
            const profile = this.userAuthProfileRepo.create({
                address: input.address,
                lastAuthType: input.lastAuthType ?? AuthType.WALLET,
                miniAppUserId: input.miniAppUserId ?? null,
                humanVerified: input.humanVerified ?? false,
                humanVerifiedAt: input.humanVerifiedAt ?? null,
                humanVerificationSource: input.humanVerificationSource ?? null,
                nullifierHash: input.nullifierHash ?? null,
            });
            const saved = await this.userAuthProfileRepo.save(profile);
            await this.setCache(saved);
            return saved;
        } catch (error: any) {
            if (error.code !== '23505') {
                throw error;
            }

            const raced = await this.userAuthProfileRepo.findOneOrFail({
                where: { address: input.address },
            });
            raced.lastAuthType = input.lastAuthType ?? raced.lastAuthType;
            if (input.miniAppUserId !== undefined) {
                raced.miniAppUserId = input.miniAppUserId;
            }
            if (input.humanVerified !== undefined) {
                raced.humanVerified = input.humanVerified;
            }
            if (input.humanVerifiedAt !== undefined) {
                raced.humanVerifiedAt = input.humanVerifiedAt;
            }
            if (input.humanVerificationSource !== undefined) {
                raced.humanVerificationSource = input.humanVerificationSource;
            }
            if (input.nullifierHash !== undefined) {
                raced.nullifierHash = input.nullifierHash;
            }
            const saved = await this.userAuthProfileRepo.save(raced);
            await this.setCache(saved);
            return saved;
        }
    }

    private getCacheKey(address: string): string {
        return `auth-profile:${address}`;
    }

    private async setCache(profile: UserAuthProfile): Promise<void> {
        await this.redis.set(
            this.getCacheKey(profile.address),
            this.serialize(profile),
            'EX',
            USER_AUTH_PROFILE_CACHE_TTL_SECONDS,
        );
    }

    private serialize(profile: UserAuthProfile): string {
        return JSON.stringify({
            ...profile,
            humanVerifiedAt: profile.humanVerifiedAt?.toISOString() ?? null,
            createdAt: profile.createdAt?.toISOString?.() ?? null,
            updatedAt: profile.updatedAt?.toISOString?.() ?? null,
        });
    }

    private deserialize(payload: string): UserAuthProfile {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        return {
            id: String(parsed.id),
            address: String(parsed.address),
            lastAuthType: parsed.lastAuthType as AuthType,
            miniAppUserId: parsed.miniAppUserId ? String(parsed.miniAppUserId) : null,
            humanVerified: parsed.humanVerified === true,
            humanVerifiedAt: parsed.humanVerifiedAt ? new Date(String(parsed.humanVerifiedAt)) : null,
            humanVerificationSource: parsed.humanVerificationSource
                ? String(parsed.humanVerificationSource)
                : null,
            nullifierHash: parsed.nullifierHash ? String(parsed.nullifierHash) : null,
            createdAt: parsed.createdAt ? new Date(String(parsed.createdAt)) : undefined,
            updatedAt: parsed.updatedAt ? new Date(String(parsed.updatedAt)) : undefined,
        } as UserAuthProfile;
    }
}

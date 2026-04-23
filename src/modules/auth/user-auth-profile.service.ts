import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthType, UserAuthProfile } from './entities/user-auth-profile.entity';

export interface UpsertUserAuthProfileInput {
    address: string;
    lastAuthType?: AuthType;
    miniAppUserId?: string | null;
    humanVerified?: boolean;
    humanVerifiedAt?: Date | null;
    humanVerificationSource?: string | null;
}

@Injectable()
export class UserAuthProfileService {
    constructor(
        @InjectRepository(UserAuthProfile)
        private readonly userAuthProfileRepo: Repository<UserAuthProfile>,
    ) { }

    async getByAddress(address: string): Promise<UserAuthProfile | null> {
        return this.userAuthProfileRepo.findOne({ where: { address } });
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
            return this.userAuthProfileRepo.save(existing);
        }

        try {
            const profile = this.userAuthProfileRepo.create({
                address: input.address,
                lastAuthType: input.lastAuthType ?? AuthType.WALLET,
                miniAppUserId: input.miniAppUserId ?? null,
                humanVerified: input.humanVerified ?? false,
                humanVerifiedAt: input.humanVerifiedAt ?? null,
                humanVerificationSource: input.humanVerificationSource ?? null,
            });
            return await this.userAuthProfileRepo.save(profile);
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
            return this.userAuthProfileRepo.save(raced);
        }
    }
}

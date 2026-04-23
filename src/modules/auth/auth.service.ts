import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ethers } from 'ethers';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../../config';
import * as crypto from 'crypto';
import { AuthType } from './entities/user-auth-profile.entity';
import { AuthJwtPayload } from './types';
import { UserAuthProfileService } from './user-auth-profile.service';
import { MiniAppLoginDto } from './dto/miniapp-login.dto';
import { MiniAppAuthVerifier } from './miniapp-auth.verifier';

@Injectable()
export class AuthService {
    private readonly wssKeyCache = new Map<string, { key: string, expiresAt: number }>();

    constructor(
        @InjectRedis() private readonly redis: Redis,
        private readonly userAuthProfileService: UserAuthProfileService,
        private readonly miniAppAuthVerifier: MiniAppAuthVerifier,
    ) { }

    async generateChallenge(address: string): Promise<string> {
        const challenge = `Sign this message to login to Tapl: ${uuidv4()}`;
        // Store challenge with 5 minutes TTL
        await this.redis.set(`auth:challenge:${ethers.getAddress(address)}`, challenge, 'EX', 300);
        return challenge;
    }

    async login(address: string, signature: string) {
        const normalizedAddress = ethers.getAddress(address);
        const challenge = await this.redis.get(`auth:challenge:${normalizedAddress}`);

        if (!challenge) {
            throw new BadRequestException('Challenge not found or expired. Please request a new challenge.');
        }

        try {
            const recoveredAddress = ethers.verifyMessage(challenge, signature);
            if (recoveredAddress !== normalizedAddress) {
                throw new UnauthorizedException('Invalid signature');
            }
        } catch (error) {
            throw new UnauthorizedException('Invalid signature format');
        }

        // Clean up challenge
        await this.redis.del(`auth:challenge:${normalizedAddress}`);

        const profile = await this.userAuthProfileService.upsert({
            address: normalizedAddress,
            lastAuthType: AuthType.WALLET,
        });

        // Generate Credentials
        const jwtToken = this.generateJwt(normalizedAddress, {
            authType: AuthType.WALLET,
            humanVerified: profile.humanVerified,
            miniAppUserId: profile.miniAppUserId,
        });
        const wssKey = await this.generateWssKey(normalizedAddress);

        return {
            accessToken: jwtToken,
            wssKey: wssKey.key,
            wssKeyExpiresAt: wssKey.expiresAt,
        };
    }

    async loginMiniApp(dto: MiniAppLoginDto) {
        const verified = this.miniAppAuthVerifier.verify(dto);
        const profile = await this.userAuthProfileService.upsert({
            address: verified.address,
            lastAuthType: AuthType.MINIAPP,
            miniAppUserId: dto.miniAppUserId,
            humanVerified: verified.humanVerified,
            humanVerifiedAt: verified.humanVerified ? verified.verifiedAt : null,
            humanVerificationSource: verified.humanVerified ? verified.verificationSource : null,
        });

        const jwtToken = this.generateJwt(verified.address, {
            authType: AuthType.MINIAPP,
            humanVerified: profile.humanVerified,
            miniAppUserId: profile.miniAppUserId,
        });
        const wssKey = await this.generateWssKey(verified.address);

        return {
            accessToken: jwtToken,
            wssKey: wssKey.key,
            wssKeyExpiresAt: wssKey.expiresAt,
        };
    }

    private generateJwt(
        address: string,
        claims: Partial<Omit<AuthJwtPayload, 'sub'>> = {},
    ): string {
        const payload: AuthJwtPayload = {
            sub: address,
            authType: claims.authType ?? AuthType.WALLET,
            humanVerified: claims.humanVerified ?? false,
            miniAppUserId: claims.miniAppUserId ?? null,
        };
        return jwt.sign(payload, env.secret.jwtSecret, { expiresIn: '1d' });
    }

    async generateWssKey(address: string) {
        // Recommended key length for HMAC-SHA256 is 32 bytes (256 bits)
        const keyLength = 32;

        // Generate a cryptographically secure random key
        const secretKey: Buffer = crypto.randomBytes(keyLength);

        // You can convert it to a hex or base64 string for storage or transmission
        const secretKeyHex: string = secretKey.toString('hex');

        // WSS key valid for 60 minutes (short lived for realtime authorization)
        const ttl = 3600;
        const normalizedAddress = ethers.getAddress(address);
        const expiresAt = Date.now() + ttl * 1000;

        this.wssKeyCache.set(normalizedAddress, {
            key: secretKeyHex,
            expiresAt
        });

        // Set a timeout to clean up memory
        setTimeout(() => {
            const cached = this.wssKeyCache.get(normalizedAddress);
            if (cached && cached.expiresAt <= Date.now()) {
                this.wssKeyCache.delete(normalizedAddress);
            }
        }, ttl * 1000);

        return {
            key: secretKeyHex,
            expiresAt,
        };
    }

    async validateWssSignature(address: string, message: string, signature: string, withChallenge?: boolean): Promise<boolean> {
        let normalizedAddress: string;
        try {
            normalizedAddress = ethers.getAddress(address);
        } catch {
            return false;
        }

        try {
            const cached = this.wssKeyCache.get(normalizedAddress);

            if (!cached) {
                return false;
            }

            if (cached.expiresAt < Date.now()) {
                this.wssKeyCache.delete(normalizedAddress);
                return false;
            }

            const storedKey = cached.key;
            const keyBuffer = Buffer.from(storedKey, 'hex');

            const hmac = crypto.createHmac('sha256', keyBuffer)
                .update(message)

            if (withChallenge) {
                const challenge = await this.redis.get(`auth:challenge:${normalizedAddress}`);
                if (!challenge) {
                    return false;
                }
                hmac.update(challenge);
            }

            return hmac.digest('hex') === signature;
        } catch {
            return false;
        }
    }
}

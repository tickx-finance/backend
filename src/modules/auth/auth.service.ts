import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ethers } from 'ethers';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../../config';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
    private readonly wssKeyCache = new Map<string, { key: string, expiresAt: number }>();

    constructor(@InjectRedis() private readonly redis: Redis) { }

    async generateChallenge(address: string): Promise<string> {
        const challenge = `Sign this message to login to TapFun: ${uuidv4()}`;
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

        // Generate Credentials
        const jwtToken = this.generateJwt(normalizedAddress);
        const wssKey = await this.generateWssKey(normalizedAddress);

        return {
            accessToken: jwtToken,
            wssKey: wssKey.key,
            wssKeyExpiresAt: wssKey.expiresAt,
        };
    }

    private generateJwt(address: string): string {
        return jwt.sign({ sub: address }, env.secret.jwtSecret, { expiresIn: '1d' });
    }

    async generateWssKey(address: string) {
        // Recommended key length for HMAC-SHA256 is 32 bytes (256 bits)
        const keyLength = 32;

        // Generate a cryptographically secure random key
        const secretKey: Buffer = crypto.randomBytes(keyLength);

        // You can convert it to a hex or base64 string for storage or transmission
        const secretKeyHex: string = secretKey.toString('hex');

        // WSS key valid for 2 minutes (short lived for realtime authorization)
        const ttl = 120;
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
        const normalizedAddress = ethers.getAddress(address);
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
    }
}

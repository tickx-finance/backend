import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { env } from '../../config';
import { AuthModule } from './auth.module';
import { MiniAppNonce } from './entities/miniapp-nonce.entity';
import { AuthType, UserAuthProfile } from './entities/user-auth-profile.entity';
import { MiniAppAuthVerifier } from './miniapp-auth.verifier';

const postgresTestUrl = process.env.POSTGRES_TEST_URL;
const redisTestUrl = process.env.REDIS_TEST_URL;
const hasTestEnv =
    process.env.RUN_AUTH_E2E === 'true'
    && Boolean(postgresTestUrl?.trim())
    && Boolean(redisTestUrl?.trim());

describe('AuthModule integration', () => {
    if (!hasTestEnv) {
        it.skip('requires RUN_AUTH_E2E=true, POSTGRES_TEST_URL and REDIS_TEST_URL', () => undefined);
        return;
    }

    let app: INestApplication;
    let dataSource: DataSource;
    let redis: Redis;

    const verifier = {
        verifyLogin: async (_nonce: string, payload: { address: string }) => ({
            address: payload.address,
        }),
        verifyHuman: async () => ({
            humanVerified: true,
            verificationSource: 'worldchain-miniapp',
            verifiedAt: new Date('2026-04-24T00:00:00.000Z'),
        }),
    };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ envFilePath: '.env.test', isGlobal: true }),
                RedisModule.forRoot({
                    type: 'single',
                    url: redisTestUrl as string,
                    options: {},
                }),
                TypeOrmModule.forRoot({
                    type: 'postgres',
                    url: postgresTestUrl as string,
                    entities: [UserAuthProfile, MiniAppNonce],
                    synchronize: true,
                    dropSchema: true,
                }),
                AuthModule,
            ],
        })
            .overrideProvider(MiniAppAuthVerifier)
            .useValue(verifier)
            .compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        dataSource = app.get(DataSource);
        redis = new Redis(redisTestUrl as string);
    });

    beforeEach(async () => {
        await cleanup();
    });

    afterEach(async () => {
        await cleanup();
    });

    afterAll(async () => {
        if (redis) {
            await redis.quit();
        }
        if (app) {
            await app.close();
        }
    });

    async function cleanup() {
        if (redis) {
            await redis.flushdb();
        }

        if (dataSource) {
            await dataSource.getRepository(UserAuthProfile).clear();
            await dataSource.getRepository(MiniAppNonce).clear();
        }
    }

    it('logs in first, then verifies human later, and refreshes JWT snapshot', async () => {
        const address = '0x1111111111111111111111111111111111111111';

        const nonceResponse = await request(app.getHttpServer())
            .get('/auth/miniapp/nonce')
            .expect(200);
        const nonce = nonceResponse.body.nonce as string;

        const loginResponse = await request(app.getHttpServer())
            .post('/auth/miniapp/login')
            .send({
                nonce,
                miniAppUserId: 'world-user-1',
                miniAppUsername: 'mini-user-1',
                payload: {
                    status: 'success',
                    message: 'unused-in-test',
                    signature: 'unused-in-test',
                    address,
                    version: 2,
                },
            })
            .expect(201);

        expect(loginResponse.body).toMatchObject({
            authType: AuthType.MINIAPP,
            humanVerified: false,
            miniAppUserId: 'world-user-1',
            miniAppUsername: 'mini-user-1',
        });

        const loginJwt = jwt.verify(loginResponse.body.accessToken, env.secret.jwtSecret) as any;
        expect(loginJwt).toMatchObject({
            sub: address,
            authType: AuthType.MINIAPP,
            humanVerified: false,
            miniAppUserId: 'world-user-1',
        });

        const verifyHumanResponse = await request(app.getHttpServer())
            .post('/auth/miniapp/verify-human')
            .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
            .send({
                action: 'verify-human',
                signal: address,
                payload: {
                    proof: 'proof',
                    merkle_root: 'root',
                    nullifier_hash: 'nullifier-1',
                    verification_level: 'orb',
                },
            })
            .expect(201);

        expect(verifyHumanResponse.body).toMatchObject({
            authType: AuthType.MINIAPP,
            humanVerified: true,
            miniAppUserId: 'world-user-1',
            miniAppUsername: 'mini-user-1',
        });

        const verifiedJwt = jwt.verify(verifyHumanResponse.body.accessToken, env.secret.jwtSecret) as any;
        expect(verifiedJwt).toMatchObject({
            sub: address,
            authType: AuthType.MINIAPP,
            humanVerified: true,
            miniAppUserId: 'world-user-1',
        });

        const profile = await dataSource.getRepository(UserAuthProfile).findOneByOrFail({ address });
        expect(profile).toMatchObject({
            address,
            lastAuthType: AuthType.MINIAPP,
            humanVerified: true,
            miniAppUserId: 'world-user-1',
            miniAppUsername: 'mini-user-1',
            nullifierHash: 'nullifier-1',
        });
    });

    it('rejects replayed mini-app nonce in the login endpoint', async () => {
        const address = '0x2222222222222222222222222222222222222222';

        const nonceResponse = await request(app.getHttpServer())
            .get('/auth/miniapp/nonce')
            .expect(200);
        const nonce = nonceResponse.body.nonce as string;

        const body = {
            nonce,
            miniAppUserId: 'world-user-2',
            miniAppUsername: 'mini-user-2',
            payload: {
                status: 'success',
                message: 'unused-in-test',
                signature: 'unused-in-test',
                address,
                version: 2,
            },
        };

        await request(app.getHttpServer())
            .post('/auth/miniapp/login')
            .send(body)
            .expect(201);

        await request(app.getHttpServer())
            .post('/auth/miniapp/login')
            .send(body)
            .expect(400);
    });
});

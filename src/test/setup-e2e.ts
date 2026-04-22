import * as path from 'path';
import * as dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env.test');

dotenv.config({
    path: envPath,
    override: true,
});

const postgresTestUrl = process.env.POSTGRES_TEST_URL ?? process.env.POSTGRES_URL;
const redisTestUrl = process.env.REDIS_TEST_URL ?? process.env.REDIS_URL;

if (!postgresTestUrl) {
    throw new Error(`POSTGRES_TEST_URL or POSTGRES_URL must be set in ${envPath}`);
}

if (!redisTestUrl) {
    throw new Error(`REDIS_TEST_URL or REDIS_URL must be set in ${envPath}`);
}

process.env.POSTGRES_TEST_URL = postgresTestUrl;
process.env.REDIS_TEST_URL = redisTestUrl;

// App modules read POSTGRES_URL/REDIS_URL from the shared config object.
// In e2e tests, force those shared URLs to the isolated test services.
process.env.POSTGRES_URL = postgresTestUrl;
process.env.REDIS_URL = redisTestUrl;

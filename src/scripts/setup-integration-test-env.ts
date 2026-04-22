import * as fs from 'fs';
import * as path from 'path';
import Redis from 'ioredis';
import { Client } from 'pg';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DOCKER_ENV_PATH = path.join(ROOT_DIR, 'docker.env');
const APP_ENV_PATH = path.join(ROOT_DIR, '.env');
const TEST_ENV_PATH = path.join(ROOT_DIR, '.env.test');

const TEST_DB_NAME = process.env.TEST_POSTGRES_DB ?? 'tapl-test';
const TEST_REDIS_DB = process.env.TEST_REDIS_DB ?? '7';

function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing env file: ${filePath}`);
  }

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce<Record<string, string>>((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return acc;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        return acc;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      acc[key] = value;
      return acc;
    }, {});
}

function readOptionalEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return readEnvFile(filePath);
}

function required(env: Record<string, string>, key: string): string {
  const value = process.env[key] ?? env[key];
  if (!value) {
    throw new Error(`Missing required env var ${key} in ${DOCKER_ENV_PATH}`);
  }
  return value;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

async function ensurePostgresDatabase(env: Record<string, string>) {
  const user = required(env, 'POSTGRES_USER');
  const password = required(env, 'POSTGRES_PASSWORD');
  const port = required(env, 'POSTGRES_PORT');
  const maintenanceDb = env.POSTGRES_DB || 'postgres';

  const client = new Client({
    host: 'localhost',
    port: Number(port),
    user,
    password,
    database: maintenanceDb,
  });

  await client.connect();
  try {
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB_NAME],
    );

    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(TEST_DB_NAME)}`);
      console.log(`Created Postgres database ${TEST_DB_NAME}`);
    } else {
      console.log(`Postgres database ${TEST_DB_NAME} already exists`);
    }
  } finally {
    await client.end();
  }

  return `postgres://${encode(user)}:${encode(password)}@localhost:${port}/${encode(TEST_DB_NAME)}`;
}

async function prepareRedis(env: Record<string, string>) {
  const password = required(env, 'REDIS_PASSWORD');
  const port = required(env, 'REDIS_PORT');
  const redis = new Redis({
    host: 'localhost',
    port: Number(port),
    username: 'default',
    password,
    db: Number(TEST_REDIS_DB),
    lazyConnect: true,
  });

  await redis.connect();
  try {
    await redis.ping();
    await redis.flushdb();
    console.log(`Redis db ${TEST_REDIS_DB} is reachable and flushed`);
  } finally {
    await redis.quit();
  }

  return `redis://default:${encode(password)}@localhost:${port}/${TEST_REDIS_DB}`;
}

async function main() {
  const dockerEnv = readEnvFile(DOCKER_ENV_PATH);
  const appEnv = readOptionalEnvFile(APP_ENV_PATH);
  const postgresUrl = await ensurePostgresDatabase(dockerEnv);
  const redisUrl = await prepareRedis(dockerEnv);
  const mergedEnv = {
    ...appEnv,
    NODE_ENV: 'test',
    POSTGRES_URL: postgresUrl,
    REDIS_URL: redisUrl,
    POSTGRES_TEST_DB: TEST_DB_NAME,
    REDIS_TEST_DB: TEST_REDIS_DB,
  };

  const testEnv = Object.entries(mergedEnv)
    .map(([key, value]) => `${key}=${value}`)
    .concat('')
    .join('\n');

  fs.writeFileSync(TEST_ENV_PATH, testEnv);
  console.log(`Wrote ${path.relative(ROOT_DIR, TEST_ENV_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

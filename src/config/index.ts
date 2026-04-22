import * as dotenv from 'dotenv';
import * as Joi from 'joi';
dotenv.config();

export const isLocal = process.env.NODE_ENV === 'local';

const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string()
      .valid('production', 'development', 'test', 'local', 'staging')
      .required(),
    PORT: Joi.number().default(3000),
    NETWORK: Joi.string()
      .default('mainnet')
      .valid('mainnet', 'testnet', 'devnet'),
    WORKER_PORT: Joi.number().default(3001),

    WAL_PATH: Joi.string().default('wal'),
    ACCOUNT_SHARD_COUNT: Joi.number().default(16),

    POSTGRES_URL: Joi.string().required(),

    CLICKHOUSE_URL: Joi.string().required(),

    REDIS_URL: Joi.string().required(),

    BUCKET_NAME: Joi.string().required(),
    MINIO_ACCESS_KEY: Joi.string().required(),
    MINIO_HOST: Joi.string().required(),
    MINIO_PORT: Joi.number().required(),
    MINIO_SECRET_KEY: Joi.string().required(),

    RPC: Joi.string().required(),

    KAFKA_BROKER: Joi.string().default('localhost:39092'),
    KAFKA_TOPIC_PREFIX: Joi.string().required(),

    KAFKA_RUNNING_FLAG: Joi.boolean().default(true),

    JWT_SECRET: Joi.string().required(),

    ADMIN_PRIVATE_KEY: Joi.string().required(),

    CELL_SIGNER_KEY: Joi.string().required(),

    RUN_PRICE_TICK: Joi.boolean().required(),
    RUN_SETTLEMENT: Joi.boolean().default(false),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: 'key' } })
  .validate(process.env);

if (error != null) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const env = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  workerPort: envVars.WORKER_PORT,
  network: envVars.NETWORK,
  account: {
    walPath: envVars.WAL_PATH,
    shardCount: envVars.ACCOUNT_SHARD_COUNT,
  },
  postgres: {
    url: envVars.POSTGRES_URL,
  },
  redis: {
    url: envVars.REDIS_URL,
  },
  minio: {
    accessKey: envVars.MINIO_ACCESS_KEY,
    bucket: envVars.BUCKET_NAME,
    host: envVars.MINIO_HOST,
    port: envVars.MINIO_PORT,
    secretKey: envVars.MINIO_SECRET_KEY,
  },
  clickhouse: {
    url: envVars.CLICKHOUSE_URL,
  },
  web3: {
    rpc: envVars.RPC,
  },
  kafka: {
    broker: envVars.KAFKA_BROKER,
    topicPrefix: envVars.KAFKA_TOPIC_PREFIX,
  },
  flag: {
    isRunningKafka:
      envVars.KAFKA_RUNNING_FLAG === true ||
      envVars.KAFKA_RUNNING_FLAG === 'true',
    runPriceTick:
      envVars.RUN_PRICE_TICK === true ||
      envVars.RUN_PRICE_TICK === 'true',
    runSettlement:
      envVars.RUN_SETTLEMENT === true ||
      envVars.RUN_SETTLEMENT === 'true',
  },
  secret: {
    jwtSecret: envVars.JWT_SECRET,
    adminPrivateKey: envVars.ADMIN_PRIVATE_KEY,
    cellSignerKey: envVars.CELL_SIGNER_KEY,
  }
};

export const isMainnet = env.network === 'mainnet';
export const isTestnet = env.network === 'testnet';

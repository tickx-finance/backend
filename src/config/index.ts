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
    RPCS: Joi.string().default(''),
    QUOTE_ASSET_ADDRESS: Joi.string().default(''),
    RESERVE_POOL_ADDRESS: Joi.string().default(''),
    CLAIM_SIGNER_PRIVATE_KEY: Joi.string().default(''),
    PAYMENT_CHAIN_SYNC_ENABLED: Joi.boolean().default(false),
    PAYMENT_CHAIN_SYNC_START_BLOCK: Joi.number().integer().min(0).default(0),
    PAYMENT_CHAIN_SYNC_CONFIRMATIONS: Joi.number().integer().min(0).default(3),
    PAYMENT_CHAIN_SYNC_CHUNK_SIZE: Joi.number().integer().min(1).default(2000),
    PAYMENT_CHAIN_SYNC_POLL_MS: Joi.number().integer().min(1000).default(10000),
    PAYMENT_WITHDRAWAL_EXPIRY_ENABLED: Joi.boolean().default(true),
    PAYMENT_WITHDRAWAL_EXPIRY_POLL_MS: Joi.number().integer().min(1000).default(30000),
    PAYMENT_WITHDRAWAL_EXPIRY_BATCH_SIZE: Joi.number().integer().min(1).default(100),

    KAFKA_BROKER: Joi.string().default('localhost:39092'),
    KAFKA_TOPIC_PREFIX: Joi.string().required(),

    KAFKA_RUNNING_FLAG: Joi.boolean().default(true),

    JWT_SECRET: Joi.string().required(),
    APP_API_KEY: Joi.string().required(),

    ADMIN_PRIVATE_KEY: Joi.string().required(),

    CELL_SIGNER_KEY: Joi.string().required(),

    RUN_PRICE_TICK: Joi.boolean().required(),
    RUN_SETTLEMENT: Joi.boolean().required(),
    FORTRESS_STREAM_MC_DIAGNOSTICS: Joi.boolean().default(true),
    GRID_ENGINE: Joi.string().valid('legacy', 'fortress').default('fortress'),
    FORTRESS_BANDWIDTH_WARMUP_TICKS: Joi.number().integer().min(0).default(100),
    FORTRESS_BANDWIDTH_REFRESH_TICKS: Joi.number().integer().min(1).default(3600),
    HUMAN_VERIFIED_WIN_BONUS_BPS: Joi.number().integer().min(0).default(200),
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
    rpcs: (envVars.RPCS || envVars.RPC)
      .split(',')
      .map((rpc: string) => rpc.trim())
      .filter(Boolean),
  },
  payment: {
    quoteAssetAddress: envVars.QUOTE_ASSET_ADDRESS,
    reservePoolAddress: envVars.RESERVE_POOL_ADDRESS,
    claimSignerPrivateKey: envVars.CLAIM_SIGNER_PRIVATE_KEY,
    chainSyncEnabled:
      envVars.PAYMENT_CHAIN_SYNC_ENABLED === true ||
      envVars.PAYMENT_CHAIN_SYNC_ENABLED === 'true',
    chainSyncStartBlock: envVars.PAYMENT_CHAIN_SYNC_START_BLOCK,
    chainSyncConfirmations: envVars.PAYMENT_CHAIN_SYNC_CONFIRMATIONS,
    chainSyncChunkSize: envVars.PAYMENT_CHAIN_SYNC_CHUNK_SIZE,
    chainSyncPollMs: envVars.PAYMENT_CHAIN_SYNC_POLL_MS,
    withdrawalExpiryEnabled:
      envVars.PAYMENT_WITHDRAWAL_EXPIRY_ENABLED === true ||
      envVars.PAYMENT_WITHDRAWAL_EXPIRY_ENABLED === 'true',
    withdrawalExpiryPollMs: envVars.PAYMENT_WITHDRAWAL_EXPIRY_POLL_MS,
    withdrawalExpiryBatchSize: envVars.PAYMENT_WITHDRAWAL_EXPIRY_BATCH_SIZE,
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
    streamFortressMcDiagnostics:
      envVars.FORTRESS_STREAM_MC_DIAGNOSTICS === true ||
      envVars.FORTRESS_STREAM_MC_DIAGNOSTICS === 'true',
  },
  grid: {
    engine: envVars.GRID_ENGINE as 'legacy' | 'fortress',
  },
  fortress: {
    bandwidthWarmupTicks: envVars.FORTRESS_BANDWIDTH_WARMUP_TICKS,
    bandwidthRefreshTicks: envVars.FORTRESS_BANDWIDTH_REFRESH_TICKS,
  },
  order: {
    humanVerifiedWinBonusBps: envVars.HUMAN_VERIFIED_WIN_BONUS_BPS,
  },
  secret: {
    jwtSecret: envVars.JWT_SECRET,
    appApiKey: envVars.APP_API_KEY,
    adminPrivateKey: envVars.ADMIN_PRIVATE_KEY,
    cellSignerKey: envVars.CELL_SIGNER_KEY,
  }
};

export const isMainnet = env.network === 'mainnet';
export const isTestnet = env.network === 'testnet';

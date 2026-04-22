# Project Setup

This project is an EVM-based application utilizing Ether.js and integrating with BASE infrastructure. Below are the necessary steps to set up and run the project.

## Prerequisites

Before setting up the project, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (Version 23.7.0 or later recommended)
- [Yarn](https://yarnpkg.com/) (Package manager for dependencies)
- [Docker](https://www.docker.com/) and Docker Compose
- [TypeScript](https://www.typescriptlang.org/) (Installed globally)

## Environment Variables

Ensure you have the following environment files in place:

### `.env` File
```env
NODE_ENV=production # local development production
PORT='3001' # app port
WORKER_PORT='3002' # listener port
NETWORK=mainnet # testnet mainnet

# postgres config
POSTGRES_URL=postgres://root:1@localhost:5432/rwa

# redis config
REDIS_URL=redis://default:foobared@localhost:6379/0

# minio config
MINIO_ACCESS_KEY=development
MINIO_SECRET_KEY=123456789
BUCKET_NAME=development
MINIO_HOST=localhost
MINIO_PORT=32126

# kafka config
KAFKA_BROKER=localhost:39092
KAFKA_TOPIC_PREFIX='local-rwa' # optional
KAFKA_RUNNING_FLAG=true # true enable kafka and socket

# rpc config
RPC=

JWT_SECRET=1

APIFY_KEY=

PRIVY_APP_ID=
PRIVY_APP_SECRET=

# admin private key
ADMIN_PRIVATE_KEY=
```

### `docker.env` File
```env
POSTGRES_USER=root
POSTGRES_PASSWORD=1
POSTGRES_DB=viral_bot
POSTGRES_PORT=5432

REDIS_PASSWORD=foobared
REDIS_PORT=6379

MINIO_ROOT_USER=development
MINIO_ROOT_PASSWORD=123456789
MINIO_PORT=32126
MINIO_CONSOLE_PORT=9001

ZOOKEEPER_PORT=2181

KAFKA_PORT=39092
KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:39092

CLICKHOUSE_DB=viral_bot
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=1
CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1
CLICKHOUSE_PORT_HTTP=8123
CLICKHOUSE_PORT_TCP=9000
```
## Running the Project

### Step 1: Start Required Services with Docker Compose
Ensure you have [Docker](https://www.docker.com/) installed. Run the following command to start the required services:
```sh
docker compose --env-file docker.env up -d
```

### Step 2: Install Dependencies
Run the following command to install project dependencies:
```sh
yarn install
```

### Step 3: Generate TypeScript Bindings for Smart Contracts
```sh
yarn typechain:gen
```

### Step 4: Generate Migrations
Run this command to generate database migrations:
```sh
yarn migration:generate
```

### Step 5: Apply Migrations
Run the following command to apply database migrations:
```sh
yarn migration:up
```

### Step 6: Start the Application
To start the main application, run:
```sh
yarn dev
```

### Step 7: Start the Worker Service
To start the worker service, run:
```sh
yarn dev:worker
```

## Notes

- Ensure all environment variables are correctly configured before starting the services.
- `MINIO_ROOT_PASSWORD` must be at least 8 characters.
- `RPC` must be set to a valid RPC endpoint.
- If you encounter any issues with Docker services, try restarting them using:
  ```sh
  docker compose down && docker compose --env-file docker.env up -d
  ```
- If database migrations fail, check database connectivity and retry migration commands.

# ----------------------
# 1. BUILD STAGE
# ----------------------
FROM node:23-slim AS builder

WORKDIR /usr/src/app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn typechain:gen
RUN yarn build

# ----------------------
# 2. RUN STAGE
# ----------------------
FROM node:23-slim AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

# Chromium runtime + dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxcb1 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH="/usr/bin/chromium"

COPY --from=builder /usr/src/app ./

EXPOSE 5050
CMD ["yarn", "start"]

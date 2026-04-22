# Hướng Dẫn Viết Adapter và Sync Service

Tài liệu này hướng dẫn cách viết một adapter từ file ABI JSON (ví dụ: `Meme.json`) và sync service với đầy đủ locking, checkpoint (tham khảo `worker-sync-meme.service.ts`).

## Mục Lục

1. [Cấu Trúc Thư Mục](#cấu-trúc-thư-mục)
2. [Bước 1: Tạo ABI Interface](#bước-1-tạo-abi-interface)
3. [Bước 2: Viết Schema](#bước-2-viết-schema)
4. [Bước 3: Viết Adapter](#bước-3-viết-adapter)
5. [Bước 4: Viết Sync Service](#bước-4-viết-sync-service)
6. [Bước 5: Đăng Ký Service](#bước-5-đăng-ký-service)
7. [Lưu Ý Quan Trọng](#lưu-ý-quan-trọng)

---

## Cấu Trúc Thư Mục

```
src/
├── abis/
│   └── YourContract.json          # File ABI từ smart contract
├── adapters/
│   └── your-adapter/
│       ├── your.adapter.ts        # Adapter class
│       └── your.schema.ts         # Types và DTOs
├── modules/
│   └── worker/
│       └── worker-sync-your.service.ts  # Sync service với cron job
├── utils/
│   ├── Abis.ts                    # Khai báo ABI interfaces
│   ├── RedisKey.ts               # Redis keys
│   ├── redis.utils.ts            # RedisLock & RedisCheckpoint
│   └── base/
│       └── base-parsed-event.ts  # Base class cho parsed events
└── libs/web3/
    └── provider.ts               # Web3 provider
```

---

## Bước 1: Tạo ABI Interface

### 1.1 Thêm ABI vào `src/utils/Abis.ts`

Từ file `YourContract.json`, trích xuất các event signatures:

```typescript
// src/utils/Abis.ts

// Format: event EventName(type1,type2,...)
export const yourAbiInterface = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];

export enum YourAbi {
  Transfer = 'Transfer(address,address,uint256)',
  Approval = 'Approval(address,address,uint256)',
}
```

### 1.2 Thêm Constants

```typescript
// src/utils/constant.ts
export const YOUR_CONTRACT_ADDRESS = '0x...';
export const YOUR_CONTRACT_BLOCKNUMBER = 12345678; // Block deploy
```

---

## Bước 2: Viết Schema

Tạo file `src/adapters/your-adapter/your.schema.ts`:

```typescript
import { BaseParsedEvent } from 'src/utils/base/base-parsed-event';

// ==================== ENUMS ====================
export enum YourEvent {
  Transfer = 'Transfer',
  Approval = 'Approval',
}

// ==================== DTOs ====================
export class TransferDto {
  from: string;
  to: string;
  value: string;
}

export class ApprovalDto {
  owner: string;
  spender: string;
  value: string;
}

// ==================== Parsed Events ====================
export class ParsedTransferEvent extends BaseParsedEvent {
  type: YourEvent.Transfer;
  args: TransferDto;
}

export class ParsedApprovalEvent extends BaseParsedEvent {
  type: YourEvent.Approval;
  args: ApprovalDto;
}

// ==================== Response ====================
export class YourEventResponse {
  transferEvents: ParsedTransferEvent[];
  approvalEvents: ParsedApprovalEvent[];
}
```

---

## Bước 3: Viết Adapter

Tạo file `src/adapters/your-adapter/your.adapter.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { ethers, keccak256, toUtf8Bytes } from 'ethers';
import { provider } from 'src/libs/web3/provider';
import { YourAbi, yourAbiInterface } from 'src/utils/Abis';
import { BaseParsedEvent } from 'src/utils/base/base-parsed-event';
import { YOUR_CONTRACT_ADDRESS } from 'src/utils/constant';
import {
  YourEvent,
  YourEventResponse,
  ParsedTransferEvent,
  ParsedApprovalEvent,
} from './your.schema';

export class YourAdapter {
  private readonly logger = new Logger(YourAdapter.name);
  private readonly iface = new ethers.Interface(yourAbiInterface);

  constructor() {}

  /**
   * Crawl events từ blockchain trong khoảng block numbers
   */
  async crawlEvents(fromBlockNumber: number, toBlockNumber: number) {
    const logs = await provider.getLogs({
      fromBlock: fromBlockNumber,
      toBlock: toBlockNumber,
      address: YOUR_CONTRACT_ADDRESS,
      topics: [
        // Lấy tất cả event signatures đã định nghĩa
        Object.values(YourAbi).map((item) => keccak256(toUtf8Bytes(item))),
      ],
    });

    if (!logs.length) {
      return {
        transferEvents: [],
        approvalEvents: [],
      } as YourEventResponse;
    }

    return await this.parseLogs(logs);
  }

  /**
   * Parse logs thành structured events
   */
  async parseLogs(logs: ethers.Log[]) {
    // Lấy timestamp cho tất cả blocks
    const timestampMap = await this.getTimestamp(logs);

    const response: YourEventResponse = {
      transferEvents: [],
      approvalEvents: [],
    };

    for (const log of logs) {
      try {
        const event = this.iface.parseLog(log);
        const { transactionHash, blockNumber, address, index } = log;
        const timestamp = timestampMap[blockNumber];
        const type = event.name;

        // Base parsed event - common fields
        const baseParsedEvent = {
          hash: transactionHash,
          address,
          blockNumber,
          timestamp,
          logIndex: index,
        } as BaseParsedEvent;

        // Parse theo từng event type
        switch (type) {
          case YourEvent.Transfer:
            response.transferEvents.push({
              ...baseParsedEvent,
              type,
              args: {
                from: event.args[0].toString(),
                to: event.args[1].toString(),
                value: event.args[2].toString(),
              },
            } as ParsedTransferEvent);
            break;

          case YourEvent.Approval:
            response.approvalEvents.push({
              ...baseParsedEvent,
              type,
              args: {
                owner: event.args[0].toString(),
                spender: event.args[1].toString(),
                value: event.args[2].toString(),
              },
            } as ParsedApprovalEvent);
            break;
        }
      } catch (error) {
        this.logger.error(`Failed to parse log: ${error.message}`, error);
      }
    }

    return response;
  }

  /**
   * Lấy timestamp cho tất cả blocks (batch query)
   */
  async getTimestamp(logs: ethers.Log[]) {
    const blockNumbers = Array.from(
      new Set(logs.map((item) => item.blockNumber)),
    );

    const response: Record<string, number> = {};
    
    // Query từng block để lấy timestamp
    for (const blockNumber of blockNumbers) {
      try {
        const block = await provider.getBlock(blockNumber);
        response[blockNumber] = block.timestamp;
      } catch (error) {
        this.logger.error(
          `Failed to get block ${blockNumber}: ${error.message}`,
        );
        response[blockNumber] = 0;
      }
    }

    return response;
  }
}

// Export singleton instance
export const yourAdapter = new YourAdapter();
```

---

## Bước 4: Viết Sync Service

Tạo file `src/modules/worker/worker-sync-your.service.ts`:

```typescript
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { yourAdapter } from 'src/adapters/your-adapter/your.adapter';
import { provider } from 'src/libs/web3/provider';
import { YOUR_CONTRACT_BLOCKNUMBER } from 'src/utils/constant';
import { RedisCheckpoint, RedisLock } from 'src/utils/redis.utils';
import { RedisKey } from 'src/utils/RedisKey';
import { createNewLog } from 'src/utils/helpers';

@Injectable()
export class WorkerServiceSyncYour implements OnModuleInit {
  provider = provider;
  private logger: Logger = new Logger(WorkerServiceSyncYour.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    // Inject các service xử lý business logic
    // private readonly yourService: YourService,
  ) {}

  /**
   * Release lock khi module khởi động (tránh lock stuck khi restart)
   */
  async onModuleInit() {
    await RedisLock.releaseLock(this.redis, RedisKey.is_syncing_your);
  }

  /**
   * Cron job chạy mỗi 5 giây để sync events
   * Pattern: seconds minutes hours day month day_of_week
   */
  @Cron('*/5 * * * * *')
  async syncAllEvents() {
    // 1. SET LOCK - Chỉ 1 instance chạy tại 1 thời điểm
    const isSetLockSuccessful = await RedisLock.setLock(
      this.redis,
      RedisKey.is_syncing_your,
      60, // TTL: 60 giây (tự động expire nếu process crash)
    );

    if (!isSetLockSuccessful) {
      // Đang có instance khác chạy
      return;
    }

    try {
      // 2. LẤY BLOCK NUMBERS
      const blockNumberNow = await this.provider.getBlockNumber();

      // Lấy checkpoint từ Redis hoặc dùng block number mặc định
      const fromBlockNumber =
        (await RedisCheckpoint.getCheckPoint(
          this.redis,
          RedisKey.your_event_block_number,
        )) ?? YOUR_CONTRACT_BLOCKNUMBER;

      // Tính toán block kết thúc (giới hạn range để tránh timeout)
      const toBlockNumber = RedisCheckpoint.calculateToBlock(
        blockNumberNow,
        fromBlockNumber,
        500, // Max 500 blocks mỗi lần query
      );

      // 3. SYNC NẾU CÓ BLOCK MỚI
      if (fromBlockNumber <= toBlockNumber) {
        await this.syncEventsInRange(fromBlockNumber, toBlockNumber);
      }
    } catch (err) {
      createNewLog(
        this.logger,
        'job',
        'SyncAllEvents',
        'error',
        err.message,
        err,
      );
    } finally {
      // 4. RELEASE LOCK - Luôn release dù thành công hay thất bại
      await RedisLock.releaseLock(this.redis, RedisKey.is_syncing_your);
    }
  }

  /**
   * Sync events trong 1 range và cập nhật checkpoint
   */
  async syncEventsInRange(fromBlockNumber: number, toBlockNumber: number) {
    this.logger.log(
      `Syncing events from block ${fromBlockNumber} to ${toBlockNumber}`,
    );

    // Crawl events từ adapter
    const eventsResponse = await yourAdapter.crawlEvents(
      fromBlockNumber,
      toBlockNumber,
    );

    // Xử lý events (gọi service khác)
    // await this.yourService.handleEvents(eventsResponse);

    // 5. CẬP NHẬT CHECKPOINT - Block tiếp theo sẽ bắt đầu từ đây
    await RedisCheckpoint.setCheckPoint(
      this.redis,
      RedisKey.your_event_block_number,
      toBlockNumber + 1, // +1 để không sync lại block cuối
    );

    this.logger.log(
      `Synced ${eventsResponse.transferEvents.length} transfers, ` +
        `${eventsResponse.approvalEvents.length} approvals`,
    );
  }
}
```

---

## Bước 5: Đăng Ký Service

### 5.1 Thêm Redis Key

```typescript
// src/utils/RedisKey.ts
export enum RedisKey {
  // ... existing keys
  
  // Your sync
  your_event_block_number = 'your_event_block_number',
  is_syncing_your = 'is_syncing_your',
}
```

### 5.2 Thêm vào Worker Module

```typescript
// src/modules/worker/worker.module.ts
import { Module } from '@nestjs/common';
import { WorkerServiceSyncYour } from './worker-sync-your.service';

@Module({
  providers: [
    // ... existing services
    WorkerServiceSyncYour,
  ],
})
export class WorkerModule {}
```

---

## Lưu Ý Quan Trọng

### 1. **Locking Mechanism**

```typescript
// Luôn dùng pattern: SET -> TRY -> FINALLY RELEASE
const isSetLockSuccessful = await RedisLock.setLock(redis, key, ttl);
if (!isSetLockSuccessful) return;

try {
  // Business logic
} finally {
  await RedisLock.releaseLock(redis, key);
}
```

**Tại sao cần lock?**
- Tránh multiple instances sync cùng lúc (gây duplicate data)
- TTL để tự động unlock nếu process crash

### 2. **Checkpoint Pattern**

```typescript
// Lấy checkpoint
checkpoint = await RedisCheckpoint.getCheckPoint(redis, key) ?? defaultBlock;

// Sync...

// Cập nhật checkpoint (block tiếp theo)
await RedisCheckpoint.setCheckPoint(redis, key, toBlockNumber + 1);
```

**Tại sao +1?**
- Để tránh re-sync block cuối đã xử lý
- Đảm bảo không miss block nào

### 3. **Error Handling**

```typescript
// Luôn wrap trong try-catch với finally release lock
try {
  // Logic
} catch (err) {
  // Log error nhưng không throw để release lock
  createNewLog(logger, 'job', 'TaskName', 'error', err.message, err);
} finally {
  await RedisLock.releaseLock(redis, key);
}
```

### 4. **Block Range Limit**

```typescript
const toBlockNumber = RedisCheckpoint.calculateToBlock(
  blockNumberNow,
  fromBlockNumber,
  500, // Giới hạn max blocks mỗi lần
);
```

**Tại sao cần giới hạn?**
- Tránh RPC timeout với range quá lớn
- Dễ retry nếu thất bại

### 5. **Timestamp Caching**

```typescript
// Batch query timestamp cho unique blocks
const blockNumbers = Array.from(new Set(logs.map((l) => l.blockNumber)));
```

**Tại sao cần caching?**
- Nhiều events có thể cùng block number
- Giảm số lần gọi RPC

### 6. **Idempotency**

```typescript
// Trong handler, luôn check trước khi insert
async handleTransferEvents(events: ParsedTransferEvent[]) {
  // Lọc events đã tồn tại
  const existingHashes = await this.getExistingHashes(
    events.map((e) => e.hash)
  );
  const newEvents = events.filter((e) => !existingHashes.has(e.hash));
  
  // Chỉ insert events mới
  if (newEvents.length) {
    await this.repo.save(newEvents);
  }
}
```

---

## Ví Dụ Hoàn Chỉnh: Meme Adapter

### Flow Diagram

```
┌─────────────────┐
│   Cron Job      │  Mỗi 5 giây
│  (@Cron)        │
└────────┬────────┘
         ▼
┌─────────────────┐
│   Set Lock      │  RedisLock.setLock()
│   (10 min TTL)  │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Get Checkpoint  │  RedisCheckpoint.getCheckPoint()
│ or Default Block│
└────────┬────────┘
         ▼
┌─────────────────┐
│ Calculate Range │  Max 500 blocks
└────────┬────────┘
         ▼
┌─────────────────┐
│  provider.      │  Lấy logs từ blockchain
│  getLogs()      │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Parse Logs     │  iface.parseLog()
│  + Timestamps   │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Handle Events   │  Business logic
└────────┬────────┘
         ▼
┌─────────────────┐
│ Update Checkpoint│ RedisCheckpoint.setCheckPoint()
│ (toBlock + 1)   │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Release Lock   │  RedisLock.releaseLock()
│  (finally)      │
└─────────────────┘
```

### Cấu Trúc Files

```
meme-adapter/
├── meme.adapter.ts      # Query logs + parse
└── meme.schema.ts       # Types

worker/
├── worker-sync-meme.service.ts  # Cron + lock + checkpoint
└── worker-meme.service.ts       # Business logic handler
```

---

## Troubleshooting

### 1. **Lock Stuck**

```bash
# Kiểm tra lock trong Redis
redis-cli GET "flag:is_syncing_meme"

# Xóa lock thủ công
redis-cli DEL "flag:is_syncing_meme"
```

### 2. **Missed Blocks**

```bash
# Kiểm tra checkpoint
redis-cli GET "meme_event_block_number"

# Reset về block cụ thể
redis-cli SET "meme_event_block_number" 12345678
```

### 3. **Duplicate Events**

- Đảm bảo `toBlockNumber + 1` khi set checkpoint
- Thêm unique constraint trên database (hash + logIndex)

### 4. **RPC Timeout**

- Giảm `GAP` trong `calculateToBlock()` (500 -> 200)
- Thêm retry logic với exponential backoff

---

## References

- [Ethers.js v6 Documentation](https://docs.ethers.org/v6/)
- [Redis SET NX EX Pattern](https://redis.io/commands/set/)
- [NestJS Schedule](https://docs.nestjs.com/techniques/task-scheduling)

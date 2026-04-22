import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountService } from './account.service';
import { LedgerService } from './services/ledger.service';
import { WalService } from './services/wal.service';
import { BalanceStoreService } from './services/balance-store.service';
import { ShardQueueService } from './services/shard-queue.service';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerSnapshot } from './entities/ledger-snapshot.entity';
import { ACCOUNT_EVENT_PUBLISHER } from './account.events';

@Module({
    imports: [
        TypeOrmModule.forFeature([LedgerEntry, LedgerSnapshot]),
    ],
    controllers: [],
    providers: [
        AccountService,
        LedgerService,
        WalService,
        BalanceStoreService,
        ShardQueueService,
        // 👇 declare the port
        {
            provide: ACCOUNT_EVENT_PUBLISHER,
            useFactory: () => {
                throw new Error(
                    'ACCOUNT_EVENT_PUBLISHER not provided. Did you forget to override it?',
                );
            },
        },
    ],
    exports: [AccountService],
})
export class AccountModule { }

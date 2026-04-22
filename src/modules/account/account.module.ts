import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { LedgerService } from './services/ledger.service';
import { WalService } from './services/wal.service';
import { BalanceStoreService } from './services/balance-store.service';
import { ShardQueueService } from './services/shard-queue.service';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerSnapshot } from './entities/ledger-snapshot.entity';
import { SocketModule } from '../socket/socket.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([LedgerEntry, LedgerSnapshot]),
        SocketModule
    ],
    controllers: [AccountController],
    providers: [
        AccountService,
        LedgerService,
        WalService,
        BalanceStoreService,
        ShardQueueService,
    ],
    exports: [AccountService],
})
export class AccountModule { }

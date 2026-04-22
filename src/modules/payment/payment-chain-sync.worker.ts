import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { env } from 'src/config';
import { PaymentChainClient, PaymentChainDecodedLog } from './payment-chain.client';
import { PaymentChainCursor } from './entities/payment-chain-cursor.entity';
import { PaymentChainEvent } from './entities/payment-chain-event.entity';
import { PaymentChainEventProcessor, PaymentChainEventProcessResult } from './payment-chain-event-processor.service';

export interface PaymentChainSyncResult {
    chainId: string;
    contractAddress: string;
    fromBlock: number;
    toBlock: number;
    processedLogs: number;
    processedLedgerEvents: PaymentChainEventProcessResult;
    finalCursorBlock: number;
}

export interface PaymentChainSyncStatus {
    enabled: boolean;
    running: boolean;
    pollMs: number;
    confirmations: number;
    chunkSize: number;
    startBlock: number;
    cursors: Array<{
        chainId: string;
        contractAddress: string;
        lastProcessedBlock: string;
        updatedAt: Date;
    }>;
    eventCounts: Array<{
        eventName: string;
        ledgerStatus: string;
        count: number;
    }>;
    latestBlock: number | null;
    latestBlockError: string | null;
}

@Injectable()
export class PaymentChainSyncWorker {
    private readonly logger = new Logger(PaymentChainSyncWorker.name);
    private timer?: NodeJS.Timeout;
    private running = false;

    constructor(
        private readonly chainClient: PaymentChainClient,
        @InjectRepository(PaymentChainCursor)
        private readonly cursorRepo: Repository<PaymentChainCursor>,
        @InjectRepository(PaymentChainEvent)
        private readonly eventRepo: Repository<PaymentChainEvent>,
        private readonly eventProcessor: PaymentChainEventProcessor,
    ) { }

    startPolling() {
        if (!env.payment.chainSyncEnabled || env.env === 'test') {
            return;
        }
        if (this.timer) {
            return;
        }

        this.timer = setInterval(() => {
            this.syncOnce().catch((error) => {
                this.logger.error(`Payment chain sync failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }, env.payment.chainSyncPollMs);

        this.syncOnce().catch((error) => {
            this.logger.error(`Initial payment chain sync failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    stopPolling() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    async syncOnce(): Promise<PaymentChainSyncResult | null> {
        if (this.running) {
            return null;
        }

        this.running = true;
        try {
            const chainId = await this.chainClient.getChainId();
            const contractAddress = ethers.getAddress(env.payment.reservePoolAddress);
            const cursor = await this.getOrCreateCursor(chainId, contractAddress);
            const latestBlock = await this.chainClient.getLatestBlockNumber();
            const targetBlock = latestBlock - env.payment.chainSyncConfirmations;

            if (targetBlock <= Number(cursor.lastProcessedBlock)) {
                const processedLedgerEvents = await this.eventProcessor.processPending();
                return {
                    chainId,
                    contractAddress,
                    fromBlock: Number(cursor.lastProcessedBlock) + 1,
                    toBlock: targetBlock,
                    processedLogs: 0,
                    processedLedgerEvents,
                    finalCursorBlock: Number(cursor.lastProcessedBlock),
                };
            }

            let processedLogs = 0;
            let fromBlock = Number(cursor.lastProcessedBlock) + 1;
            const firstBlock = fromBlock;

            while (fromBlock <= targetBlock) {
                const toBlock = Math.min(
                    targetBlock,
                    fromBlock + env.payment.chainSyncChunkSize - 1,
                );
                const logs = await this.chainClient.getPaymentLogs({
                    chainId,
                    fromBlock,
                    toBlock,
                });
                await this.persistLogs(logs);
                await this.eventProcessor.processPending();
                processedLogs += logs.length;

                cursor.lastProcessedBlock = String(toBlock);
                await this.cursorRepo.save(cursor);
                fromBlock = toBlock + 1;
            }

            return {
                chainId,
                contractAddress,
                fromBlock: firstBlock,
                toBlock: targetBlock,
                processedLogs,
                processedLedgerEvents: await this.eventProcessor.processPending(),
                finalCursorBlock: targetBlock,
            };
        } finally {
            this.running = false;
        }
    }

    async getStatus(): Promise<PaymentChainSyncStatus> {
        const [cursors, eventCounts, latestBlockResult] = await Promise.all([
            this.cursorRepo.find({ order: { updatedAt: 'DESC' } }),
            this.eventRepo
                .createQueryBuilder('event')
                .select('event.eventName', 'eventName')
                .addSelect('event.ledgerStatus', 'ledgerStatus')
                .addSelect('COUNT(*)', 'count')
                .groupBy('event.eventName')
                .addGroupBy('event.ledgerStatus')
                .getRawMany<{ eventName: string; ledgerStatus: string; count: string }>(),
            this.chainClient.getLatestBlockNumber()
                .then((latestBlock) => ({ latestBlock, error: null as string | null }))
                .catch((error) => ({
                    latestBlock: null as number | null,
                    error: error instanceof Error ? error.message : String(error),
                })),
        ]);

        return {
            enabled: env.payment.chainSyncEnabled,
            running: this.running,
            pollMs: env.payment.chainSyncPollMs,
            confirmations: env.payment.chainSyncConfirmations,
            chunkSize: env.payment.chainSyncChunkSize,
            startBlock: env.payment.chainSyncStartBlock,
            cursors: cursors.map((cursor) => ({
                chainId: cursor.chainId,
                contractAddress: cursor.contractAddress,
                lastProcessedBlock: cursor.lastProcessedBlock,
                updatedAt: cursor.updatedAt,
            })),
            eventCounts: eventCounts.map((count) => ({
                eventName: count.eventName,
                ledgerStatus: count.ledgerStatus,
                count: Number(count.count),
            })),
            latestBlock: latestBlockResult.latestBlock,
            latestBlockError: latestBlockResult.error,
        };
    }

    private async getOrCreateCursor(
        chainId: string,
        contractAddress: string,
    ): Promise<PaymentChainCursor> {
        const existing = await this.cursorRepo.findOne({
            where: { chainId, contractAddress },
        });
        if (existing) {
            return existing;
        }

        const cursor = this.cursorRepo.create({
            chainId,
            contractAddress,
            lastProcessedBlock: String(Math.max(0, env.payment.chainSyncStartBlock) - 1),
        });
        return this.cursorRepo.save(cursor);
    }

    private async persistLogs(logs: PaymentChainDecodedLog[]): Promise<void> {
        if (logs.length === 0) {
            return;
        }

        await this.eventRepo
            .createQueryBuilder()
            .insert()
            .into(PaymentChainEvent)
            .values(logs.map((log) => ({
                chainId: log.chainId,
                contractAddress: log.contractAddress,
                eventName: log.eventName,
                trader: log.trader,
                amount: log.amount,
                txHash: log.txHash,
                logIndex: log.logIndex,
                blockNumber: log.blockNumber,
                blockHash: log.blockHash,
                rawArgs: log.rawArgs,
            })))
            .orIgnore()
            .execute();
    }
}

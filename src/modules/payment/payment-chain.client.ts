import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ethers } from 'ethers';
import { env, isLocal } from 'src/config';
import { WORLDCHAIN_POOL_RESERVE_ABI } from './worldchain-pool-reserve.abi';
import { PaymentChainEventName } from './entities/payment-chain-event.entity';

export interface PaymentChainReader {
    asset(): Promise<string>;
    claimSigner(): Promise<string>;
    nonces(trader: string): Promise<bigint>;
    getClaimDigest(trader: string, amount: bigint, nonce: bigint, deadline: bigint): Promise<string>;
}

export const PAYMENT_CHAIN_READER = Symbol('PAYMENT_CHAIN_READER');

export interface PaymentChainDecodedLog {
    chainId: string;
    contractAddress: string;
    eventName: PaymentChainEventName;
    trader: string;
    amount: string;
    txHash: string;
    logIndex: number;
    blockNumber: string;
    blockHash: string;
    rawArgs: Record<string, string>;
}

@Injectable()
export class PaymentChainClient implements OnModuleInit {
    private readonly logger = new Logger(PaymentChainClient.name);
    private readonly providers: ethers.JsonRpcProvider[];
    private readonly contract: PaymentChainReader;
    private readonly iface = new ethers.Interface(WORLDCHAIN_POOL_RESERVE_ABI);

    constructor(
        @Optional()
        @Inject(PAYMENT_CHAIN_READER)
        contract?: PaymentChainReader,
    ) {
        this.providers = env.web3.rpcs.map((rpc) => new ethers.JsonRpcProvider(rpc));
        const provider = this.providers[0];
        this.contract = contract ?? new ethers.Contract(
            env.payment.reservePoolAddress || ethers.ZeroAddress,
            WORLDCHAIN_POOL_RESERVE_ABI,
            provider,
        ) as unknown as PaymentChainReader;
    }

    async onModuleInit() {
        if (env.env === 'test' || isLocal) {
            return;
        }
        await this.verifyConfiguration();
    }

    async verifyConfiguration(): Promise<void> {
        this.assertPaymentEnv();

        const [asset, chainClaimSigner] = await Promise.all([
            this.contract.asset(),
            this.contract.claimSigner(),
        ]);
        const expectedClaimSigner = new ethers.Wallet(env.payment.claimSignerPrivateKey).address;

        if (ethers.getAddress(asset) !== ethers.getAddress(env.payment.quoteAssetAddress)) {
            throw new Error(`Payment asset mismatch: contract=${asset}, env=${env.payment.quoteAssetAddress}`);
        }
        if (ethers.getAddress(chainClaimSigner) !== ethers.getAddress(expectedClaimSigner)) {
            throw new Error(`Payment claim signer mismatch: contract=${chainClaimSigner}, env=${expectedClaimSigner}`);
        }

        this.logger.log(`Payment chain config verified for reserve ${env.payment.reservePoolAddress}`);
    }

    async getTraderNonce(trader: string): Promise<bigint> {
        return this.contract.nonces(ethers.getAddress(trader));
    }

    async getClaimDigest(
        trader: string,
        amount: bigint,
        nonce: bigint,
        deadline: bigint,
    ): Promise<string> {
        return this.contract.getClaimDigest(
            ethers.getAddress(trader),
            amount,
            nonce,
            deadline,
        );
    }

    async getChainId(): Promise<string> {
        const network = await this.withProviderFallback((provider) => provider.getNetwork());
        return network.chainId.toString();
    }

    async getLatestBlockNumber(): Promise<number> {
        return this.withProviderFallback((provider) => provider.getBlockNumber());
    }

    async getPaymentLogs(input: {
        fromBlock: number;
        toBlock: number;
        chainId: string;
    }): Promise<PaymentChainDecodedLog[]> {
        const logs = await this.withProviderFallback((provider) => provider.getLogs({
            address: ethers.getAddress(env.payment.reservePoolAddress),
            fromBlock: input.fromBlock,
            toBlock: input.toBlock,
            topics: [this.paymentEventTopics()],
        }));

        return logs.map((log) => this.decodePaymentLog(log, input.chainId));
    }

    private decodePaymentLog(log: ethers.Log, chainId: string): PaymentChainDecodedLog {
        const decoded = this.iface.parseLog({
            topics: [...log.topics],
            data: log.data,
        });
        if (!decoded || !isPaymentChainEventName(decoded.name)) {
            throw new Error(`Unsupported payment chain event: ${decoded?.name ?? log.topics[0]}`);
        }

        const trader = ethers.getAddress(decoded.args.trader as string);
        const amount = (decoded.args.amount as bigint).toString();
        const logIndex = (log as unknown as { index?: number; logIndex?: number }).index
            ?? (log as unknown as { index?: number; logIndex?: number }).logIndex
            ?? 0;

        return {
            chainId,
            contractAddress: ethers.getAddress(log.address),
            eventName: decoded.name,
            trader,
            amount,
            txHash: log.transactionHash,
            logIndex,
            blockNumber: log.blockNumber.toString(),
            blockHash: log.blockHash,
            rawArgs: {
                trader,
                amount,
            },
        };
    }

    private paymentEventTopics(): string[] {
        return [
            PaymentChainEventName.TRADER_DEPOSITED,
            PaymentChainEventName.TRADER_WITHDRAWN,
            PaymentChainEventName.TRADER_CLAIMED,
        ].map((eventName) => {
            const event = this.iface.getEvent(eventName);
            if (!event) {
                throw new Error(`Missing ABI event ${eventName}`);
            }
            return event.topicHash;
        });
    }

    private async withProviderFallback<T>(
        operation: (provider: ethers.JsonRpcProvider) => Promise<T>,
    ): Promise<T> {
        let lastError: unknown;
        for (const provider of this.providers) {
            try {
                return await operation(provider);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }

    private assertPaymentEnv(): void {
        if (!env.payment.quoteAssetAddress) {
            throw new Error('QUOTE_ASSET_ADDRESS is required for payment chain integration');
        }
        if (!env.payment.reservePoolAddress) {
            throw new Error('RESERVE_POOL_ADDRESS is required for payment chain integration');
        }
        if (!env.payment.claimSignerPrivateKey) {
            throw new Error('CLAIM_SIGNER_PRIVATE_KEY is required for payment chain integration');
        }
        ethers.getAddress(env.payment.quoteAssetAddress);
        ethers.getAddress(env.payment.reservePoolAddress);
        new ethers.Wallet(env.payment.claimSignerPrivateKey);
    }
}

function isPaymentChainEventName(name: string): name is PaymentChainEventName {
    return Object.values(PaymentChainEventName).includes(name as PaymentChainEventName);
}

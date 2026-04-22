import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class MockOnChainService {
    private readonly logger = new Logger(MockOnChainService.name);

    constructor() { }

    /**
     * Simulates verifying a deposit transaction on-chain.
     * In a real implementation, this would query the blockchain provider.
     */
    async verifyDeposit(txHash: string, logIndex: number, amount: string, userId: string): Promise<boolean> {
        this.logger.log(`[MockOnChain] Verifying deposit: ${txHash}:${logIndex} for user ${userId} amount ${amount}`);
        // For mock purposes, we assume all provided deposits are valid.
        return true;
    }

    /**
     * Generates a mock signature for withdrawal approval.
     */
    async signWithdrawalApproval(sessionId: string, userId: string, amount: string): Promise<string> {
        this.logger.log(`[MockOnChain] Signing withdrawal: ${sessionId} for user ${userId} amount ${amount}`);
        // Simple mock signature
        return crypto.createHmac('sha256', 'mock-secret')
            .update(`${sessionId}:${userId}:${amount}`)
            .digest('hex');
    }

    /**
     * Simulates checking if a withdrawal transaction was successful on-chain.
     */
    async checkWithdrawalStatus(txHash: string): Promise<'CONFIRMED' | 'PENDING' | 'FAILED'> {
        this.logger.log(`[MockOnChain] Checking withdrawal tx: ${txHash}`);
        // Mock: Assume confirmed
        return 'CONFIRMED';
    }
}

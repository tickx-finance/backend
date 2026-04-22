import { Logger } from '@nestjs/common';
import { ethers, keccak256, toUtf8Bytes } from 'ethers';
import { provider } from 'src/libs/web3/provider';
import {
  WorkflowIdUpdatedAbi,
  workflowIdUpdatedAbiInterface,
  PriceIntegrityAbi,
  priceIntegrityAbiInterface,
  SettlementAbi,
  settlementAbiInterface,
  PoolReserveAbi,
  poolReserveAbiInterface,
  LPDistributorAbi,
  lpDistributorAbiInterface,
  StrategyManagerAbi,
  strategyManagerAbiInterface,
} from 'src/utils/Abis';
import { BaseParsedEvent } from 'src/utils/base/base-parsed-event';
import {
  PriceIntegrity,
  PoolReserve,
  Settlement,
  LPDistributor,
  StrategyManager,
} from 'src/utils/constant';
import {
  WorkflowIdEvent,
  PriceIntegrityEvent,
  SettlementEvent,
  PoolReserveEvent,
  LPDistributorEvent,
  StrategyManagerEvent,
  WorkflowIdEventResponse,
  ParsedExpectedWorkflowIdUpdatedEvent,
  ParsedPriceIntegrityBatchReportedEvent,
  ParsedBatchSubmittedEvent,
  ParsedSettlementBatchCommittedEvent,
  ParsedSolvencyReportedEvent,
  ParsedCCIPDistributionRequestedEvent,
  ParsedReserveAllocatedToDistributorEvent,
  ParsedVolatilityRegimeChangedEvent,
} from './workflow-id.schema';

export class WorkflowIdAdapter {
  private readonly logger = new Logger(WorkflowIdAdapter.name);
  
  // Interfaces for parsing events
  private readonly workflowIdIface = new ethers.Interface(workflowIdUpdatedAbiInterface);
  private readonly priceIntegrityIface = new ethers.Interface(priceIntegrityAbiInterface);
  private readonly settlementIface = new ethers.Interface(settlementAbiInterface);
  private readonly poolReserveIface = new ethers.Interface(poolReserveAbiInterface);
  private readonly lpDistributorIface = new ethers.Interface(lpDistributorAbiInterface);
  private readonly strategyManagerIface = new ethers.Interface(strategyManagerAbiInterface);

  // Contract address to interface mapping
  private readonly contractInterfaceMap = new Map<string, ethers.Interface>([
    [PriceIntegrity.toLowerCase(), this.priceIntegrityIface],
    [Settlement.toLowerCase(), this.settlementIface],
    [PoolReserve.toLowerCase(), this.poolReserveIface],
    [LPDistributor.toLowerCase(), this.lpDistributorIface],
    [StrategyManager.toLowerCase(), this.strategyManagerIface],
  ]);

  // All contract addresses
  private readonly allContractAddresses = [
    PriceIntegrity,
    PoolReserve,
    Settlement,
    LPDistributor,
    StrategyManager,
  ];

  constructor() {}

  /**
   * Get all event signature hashes for querying
   */
  private getAllEventSignatureHashes(): string[] {
    return [
      keccak256(toUtf8Bytes(WorkflowIdUpdatedAbi.ExpectedWorkflowIdUpdated)),
      keccak256(toUtf8Bytes(PriceIntegrityAbi.PriceIntegrityBatchReported)),
      keccak256(toUtf8Bytes(PriceIntegrityAbi.BatchSubmitted)),
      keccak256(toUtf8Bytes(SettlementAbi.SettlementBatchCommitted)),
      keccak256(toUtf8Bytes(PoolReserveAbi.SolvencyReported)),
      keccak256(toUtf8Bytes(LPDistributorAbi.CCIPDistributionRequested)),
      keccak256(toUtf8Bytes(LPDistributorAbi.ReserveAllocatedToDistributor)),
      keccak256(toUtf8Bytes(StrategyManagerAbi.VolatilityRegimeChanged)),
    ];
  }

  /**
   * Crawl events from all contract addresses within a block range
   */
  async crawlEvents(
    fromBlockNumber: number,
    toBlockNumber: number,
  ): Promise<WorkflowIdEventResponse> {
    // Query logs from all addresses with all event signatures
    const logs = await provider.getLogs({
      fromBlock: fromBlockNumber,
      toBlock: toBlockNumber,
      address: this.allContractAddresses,
      topics: [this.getAllEventSignatureHashes()],
    });

    if (!logs.length) {
      return {
        expectedWorkflowIdUpdatedEvents: [],
        priceIntegrityBatchReportedEvents: [],
        batchSubmittedEvents: [],
        settlementBatchCommittedEvents: [],
        solvencyReportedEvents: [],
        ccipDistributionRequestedEvents: [],
        reserveAllocatedToDistributorEvents: [],
        volatilityRegimeChangedEvents: [],
      } as WorkflowIdEventResponse;
    }

    return await this.parseLogs(logs);
  }

  /**
   * Parse logs into structured events
   */
  async parseLogs(logs: ethers.Log[]): Promise<WorkflowIdEventResponse> {
    // Get timestamps for all unique blocks
    const timestampMap = await this.getTimestamp(logs);

    const response: WorkflowIdEventResponse = {
      expectedWorkflowIdUpdatedEvents: [],
      priceIntegrityBatchReportedEvents: [],
      batchSubmittedEvents: [],
      settlementBatchCommittedEvents: [],
      solvencyReportedEvents: [],
      ccipDistributionRequestedEvents: [],
      reserveAllocatedToDistributorEvents: [],
      volatilityRegimeChangedEvents: [],
    };

    for (const log of logs) {
      try {
        const { transactionHash, blockNumber, address, index } = log;
        const timestamp = timestampMap[blockNumber] || 0;

        // Get the appropriate interface based on contract address
        const iface = this.getInterfaceForAddress(address);
        if (!iface) {
          this.logger.warn(`No interface found for address: ${address}`);
          continue;
        }

        const event = iface.parseLog(log);
        if (!event) {
          this.logger.warn(`Failed to parse log: ${log.transactionHash}`);
          continue;
        }

        const type = event.name;

        // Base parsed event - common fields
        const baseParsedEvent = {
          hash: transactionHash,
          address,
          blockNumber,
          timestamp,
          logIndex: index,
        } as BaseParsedEvent;

        // Parse based on event type
        this.parseEventByType(type, event, baseParsedEvent, response);
      } catch (error) {
        this.logger.error(
          `Failed to parse log: ${error.message}`,
          error,
        );
      }
    }

    return response;
  }

  /**
   * Get interface for a contract address
   */
  private getInterfaceForAddress(address: string): ethers.Interface | null {
    return this.contractInterfaceMap.get(address.toLowerCase()) || null;
  }

  /**
   * Parse event based on its type and add to response
   */
  private parseEventByType(
    type: string,
    event: ethers.LogDescription,
    baseParsedEvent: BaseParsedEvent,
    response: WorkflowIdEventResponse,
  ): void {
    switch (type) {
      // WorkflowId events
      case WorkflowIdEvent.ExpectedWorkflowIdUpdated:
        response.expectedWorkflowIdUpdatedEvents.push({
          ...baseParsedEvent,
          type,
          args: {
            previousId: event.args[0].toString(),
            newId: event.args[1].toString(),
          },
        } as ParsedExpectedWorkflowIdUpdatedEvent);
        break;

      // PriceIntegrity events
      case PriceIntegrityEvent.PriceIntegrityBatchReported:
        response.priceIntegrityBatchReportedEvents.push({
          ...baseParsedEvent,
          type,
          args: {
            epochId: event.args[0].toString(),
            windowStart: event.args[1].toString(),
            candleCount: event.args[2].toString(),
            internalCandlesHash: event.args[3].toString(),
            chainlinkCandlesHash: event.args[4].toString(),
            ohlcMaeBps: event.args[5].toString(),
            ohlcP95Bps: event.args[6].toString(),
            ohlcMaxBps: event.args[7].toString(),
            directionMatchBps: event.args[8].toString(),
            outlierCount: event.args[9].toString(),
            scoreBps: event.args[10].toString(),
            diffMerkleRoot: event.args[11].toString(),
          },
        } as ParsedPriceIntegrityBatchReportedEvent);
        break;

      case PriceIntegrityEvent.BatchSubmitted:
        response.batchSubmittedEvents.push({
          ...baseParsedEvent,
          type,
          args: {
            epochId: event.args[0].toString(),
            scoreBps: event.args[1].toString(),
            ohlcP95Bps: event.args[2].toString(),
            isPassed: event.args[3],
            failureFlags: Number(event.args[4]),
          },
        } as ParsedBatchSubmittedEvent);
        break;

      // Settlement events
      case SettlementEvent.SettlementBatchCommitted:
        response.settlementBatchCommittedEvents.push({
          ...baseParsedEvent,
          type,
          args: {
            batchId: event.args[0].toString(),
            merkleRoot: event.args[1].toString(),
            totalPayout: event.args[2].toString(),
            withdrawableCap: event.args[3].toString(),
            windowStart: event.args[4].toString(),
            windowEnd: event.args[5].toString(),
          },
        } as ParsedSettlementBatchCommittedEvent);
        break;

      // PoolReserve events
      case PoolReserveEvent.SolvencyReported:
        response.solvencyReportedEvents.push({
          ...baseParsedEvent,
          type,
          args: {
            epochId: event.args[0].toString(),
            poolBalance: event.args[1].toString(),
            totalLiability: event.args[2].toString(),
            utilizationBps: event.args[3].toString(),
            maxSingleBetExposure: event.args[4].toString(),
          },
        } as ParsedSolvencyReportedEvent);
        break;

      // LPDistributor events
      case LPDistributorEvent.CCIPDistributionRequested:
        response.ccipDistributionRequestedEvents.push({
          ...baseParsedEvent,
          type,
          args: {
            epochId: event.args[0].toString(),
            amount: event.args[1].toString(),
            dstChainSelector: event.args[2].toString(),
            receiver: event.args[3].toString(),
          },
        } as ParsedCCIPDistributionRequestedEvent);
        break;

      case LPDistributorEvent.ReserveAllocatedToDistributor:
        response.reserveAllocatedToDistributorEvents.push({
          ...baseParsedEvent,
          type,
          args: {
            amount: event.args[0].toString(),
            receiver: event.args[1].toString(),
          },
        } as ParsedReserveAllocatedToDistributorEvent);
        break;

      // StrategyManager events
      case StrategyManagerEvent.VolatilityRegimeChanged:
        response.volatilityRegimeChangedEvents.push({
          ...baseParsedEvent,
          type,
          args: {
            regimeId: event.args[0].toString(),
            fortressSpreadBps: event.args[1].toString(),
            maxMultiplier: event.args[2].toString(),
          },
        } as ParsedVolatilityRegimeChangedEvent);
        break;

      default:
        this.logger.warn(`Unknown event type: ${type}`);
    }
  }

  /**
   * Get timestamps for all unique blocks (batch query with caching)
   */
  async getTimestamp(
    logs: ethers.Log[],
  ): Promise<Record<number, number>> {
    const blockNumbers = Array.from(
      new Set(logs.map((item) => item.blockNumber)),
    );

    const response: Record<number, number> = {};

    // Query each block to get timestamp
    for (const blockNumber of blockNumbers) {
      try {
        const block = await provider.getBlock(blockNumber);
        response[blockNumber] = block?.timestamp || 0;
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
export const workflowIdAdapter = new WorkflowIdAdapter();

import { Logger } from '@nestjs/common';
import { ethers, keccak256, toUtf8Bytes } from 'ethers';
import { provider } from 'src/libs/web3/provider';
import {
  WorkflowIdUpdatedAbi,
  workflowIdUpdatedAbiInterface,
} from 'src/utils/Abis';
import { BaseParsedEvent } from 'src/utils/base/base-parsed-event';
import {
  PriceIntegrity,
  PoolReserve,
  Settlement,
  StrategyManager,
} from 'src/utils/constant';
import {
  WorkflowIdEvent,
  WorkflowIdEventResponse,
  ParsedExpectedWorkflowIdUpdatedEvent,
} from './workflow-id.schema';

export class WorkflowIdAdapter {
  private readonly logger = new Logger(WorkflowIdAdapter.name);
  private readonly iface = new ethers.Interface(workflowIdUpdatedAbiInterface);

  // List of all contract addresses that emit ExpectedWorkflowIdUpdated event
  private readonly contractAddresses = [
    PriceIntegrity,
    PoolReserve,
    Settlement,
    StrategyManager,
  ];

  constructor() {}

  /**
   * Crawl events from all contract addresses within a block range
   */
  async crawlEvents(
    fromBlockNumber: number,
    toBlockNumber: number,
  ): Promise<WorkflowIdEventResponse> {
    // Get event signature hash
    const eventSignatureHash = keccak256(
      toUtf8Bytes(WorkflowIdUpdatedAbi.ExpectedWorkflowIdUpdated),
    );

    // Query logs from all addresses
    const logs = await provider.getLogs({
      fromBlock: fromBlockNumber,
      toBlock: toBlockNumber,
      address: this.contractAddresses,
      topics: [eventSignatureHash],
    });

    if (!logs.length) {
      return {
        expectedWorkflowIdUpdatedEvents: [],
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
    };

    for (const log of logs) {
      try {
        const event = this.iface.parseLog(log);
        if (!event) {
          this.logger.warn(`Failed to parse log: ${log.transactionHash}`);
          continue;
        }

        const { transactionHash, blockNumber, address, index } = log;
        const timestamp = timestampMap[blockNumber] || 0;
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
        switch (type) {
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
        }
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

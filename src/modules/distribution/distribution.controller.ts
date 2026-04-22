import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ethers } from 'ethers';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

export interface LpShare {
  lp: string;
  shares: string;
}

export interface Destination {
  chainSelector: number;
  receiver: string;
  amount: string;
}

export interface DistributionBatch {
  epochId: number;
  totalRewards: string;
  snapshotBlock: number;
  lpShares: LpShare[];
  destinations: Destination[];
}

export interface DistributionBatchesResponse {
  batches: DistributionBatch[];
}

@ApiTags('LP Distribution - Pending Batches')
@Controller('v1/distribution/batches')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
export class DistributionController {
  private readonly logger = new Logger(DistributionController.name);

  @Get('pending')
  @ApiOperation({
    summary: 'Get LP distribution pending batches',
    description:
      'Returns pending LP distribution batches with rewards, shares, and destinations. Header: Authorization: Bearer {APP_API_KEY}',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved distribution batches',
    schema: {
      type: 'object',
      properties: {
        batches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              epochId: { type: 'number', example: 1 },
              totalRewards: {
                type: 'string',
                example: '10000000000000000000000',
              },
              snapshotBlock: { type: 'number', example: 12345678 },
              lpShares: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    lp: { type: 'string', example: '0x1234...' },
                    shares: { type: 'string', example: '1000000000000000000000' },
                  },
                },
              },
              destinations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    chainSelector: { type: 'number', example: 16015286601757825753 },
                    receiver: { type: 'string', example: '0xabcd...' },
                    amount: { type: 'string', example: '5000000000000000000000' },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
  })
  async getPendingBatches(): Promise<DistributionBatchesResponse> {
    try {
      this.logger.debug('Fetching LP distribution pending batches');

      const randomReceiver = () => ethers.Wallet.createRandom().address;
      const weiMultiplier = 10n ** 18n;
      const toWeiString = (wholeTokens: bigint) => (wholeTokens * weiMultiplier).toString();
      const randomWholeTokens = (min: number, max: number): bigint =>
        BigInt(Math.floor(Math.random() * (max - min + 1)) + min);
      const randomSplit = (total: bigint, parts: number): bigint[] => {
        let remaining = Number(total);
        const split: bigint[] = [];

        for (let index = 0; index < parts - 1; index++) {
          const minRemaining = parts - index - 1;
          const currentPart = Math.floor(Math.random() * (remaining - minRemaining)) + 1;
          split.push(BigInt(currentPart));
          remaining -= currentPart;
        }

        split.push(BigInt(remaining));
        return split;
      };

      const batch1TotalRewardsTokens = randomWholeTokens(9000, 14000);
      const batch2TotalRewardsTokens = randomWholeTokens(6000, 10000);
      const batch1LpShares = randomSplit(randomWholeTokens(9000, 14000), 4);
      const batch2LpShares = randomSplit(randomWholeTokens(6000, 10000), 2);
      const batch1DestinationAmounts = randomSplit(batch1TotalRewardsTokens, 2);

      // Mocked response as per spec
      const response: DistributionBatchesResponse = {
        batches: [
          {
            epochId: Date.now(),
            totalRewards: toWeiString(batch1TotalRewardsTokens),
            snapshotBlock: 12345678,
            lpShares: [
              {
                lp: '0x1111111111111111111111111111111111111111',
                shares: toWeiString(batch1LpShares[0]),
              },
              {
                lp: '0x2222222222222222222222222222222222222222',
                shares: toWeiString(batch1LpShares[1]),
              },
              {
                lp: '0x3333333333333333333333333333333333333333',
                shares: toWeiString(batch1LpShares[2]),
              },
              {
                lp: '0x4444444444444444444444444444444444444444',
                shares: toWeiString(batch1LpShares[3]),
              },
            ],
            destinations: [
              {
                chainSelector: 16015286601757825753, // Ethereum mainnet
                receiver: randomReceiver(),
                amount: toWeiString(batch1DestinationAmounts[0]),
              },
              {
                chainSelector: 14767482510784806043, // Polygon
                receiver: randomReceiver(),
                amount: toWeiString(batch1DestinationAmounts[1]),
              },
            ],
          },
          {
            epochId: Date.now() + 1,
            totalRewards: toWeiString(batch2TotalRewardsTokens),
            snapshotBlock: 12345800,
            lpShares: [
              {
                lp: '0x5555555555555555555555555555555555555555',
                shares: toWeiString(batch2LpShares[0]),
              },
              {
                lp: '0x6666666666666666666666666666666666666666',
                shares: toWeiString(batch2LpShares[1]),
              },
            ],
            destinations: [
              {
                chainSelector: 16015286601757825753,
                receiver: randomReceiver(),
                amount: toWeiString(batch2TotalRewardsTokens),
              },
            ],
          },
        ],
      };

      this.logger.debug(`Returning ${response.batches.length} distribution batches`);

      return response;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to get distribution batches: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new HttpException(
        {
          error: 'internal_error',
          message: 'Failed to fetch distribution batches',
          retryable: true,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

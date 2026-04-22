import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
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
  ApiParam,
} from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { GetSettlementBatchesDto } from './dto/get-settlement-batches.dto';
import { CommitBatchDto } from './dto/commit-batch.dto';
import { GetCommittedBatchesDto } from './dto/get-committed-batches.dto';
import {
  SettlementBatchesResponse,
  SettlementErrorResponse,
} from './types/settlement.types';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@ApiTags('Settlement - Batches')
@Controller('v1/settlement/batches')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
export class SettlementController {
  private readonly logger = new Logger(SettlementController.name);

  constructor(private readonly settlementService: SettlementService) {}

  // ========== API 2: Get Pending Batches ==========
  @Get('pending')
  @ApiOperation({
    summary: 'Get pending settlement batches',
    description:
      'Returns settlement batches for the specified time window. Each batch contains deposits, withdrawals, and bet settlements grouped in 15-minute windows. Header: Authorization: Bearer {APP_API_KEY}',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved settlement batches',
    schema: {
      type: 'object',
      properties: {
        batches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              batchId: {
                type: 'string',
                example: 'batch_2024_01_01_00_00',
              },
              windowStart: { type: 'number', example: 1704067200 },
              windowEnd: { type: 'number', example: 1704068100 },
              deposits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    account: { type: 'string', example: '0x1234...' },
                    amount: { type: 'string', example: '1000000000000000000' },
                  },
                },
              },
              withdrawals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    account: { type: 'string', example: '0x5678...' },
                    amount: { type: 'string', example: '500000000000000000' },
                  },
                },
              },
              settlements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    account: { type: 'string', example: '0xabcd...' },
                    betId: { type: 'string', example: 'order_123' },
                    outcome: { type: 'string', enum: ['WIN', 'LOSS'] },
                    payout: { type: 'string', example: '2000000000000000000' },
                    originalStake: { type: 'string', example: '1000000000000000000' },
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
    status: 400,
    description: 'Bad Request - Invalid parameters',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'bad_request' },
        message: { type: 'string', example: 'windowEnd must be > windowStart' },
        retryable: { type: 'boolean', example: false },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  async getPendingBatches(
    @Query() query: GetSettlementBatchesDto,
  ): Promise<SettlementBatchesResponse> {
    try {
      const { windowStart, windowEnd } = query;

      // Validate window
      if (windowEnd <= windowStart) {
        const errorResponse: SettlementErrorResponse = {
          error: 'bad_request',
          message: 'windowEnd must be greater than windowStart',
          retryable: false,
        };
        throw new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
      }

      // Validate window size (max 24 hours)
      const maxWindowSize = 24 * 60 * 60; // 24 hours in seconds
      if (windowEnd - windowStart > maxWindowSize) {
        const errorResponse: SettlementErrorResponse = {
          error: 'bad_request',
          message: 'Window size exceeds maximum of 24 hours',
          retryable: false,
        };
        throw new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
      }

      this.logger.debug(
        `Settlement batches request: windowStart=${windowStart}, windowEnd=${windowEnd}`,
      );

      const response = await this.settlementService.getPendingBatches(
        windowStart,
        windowEnd,
      );

      this.logger.debug(`Returning ${response.batches.length} batches`);

      return response;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to get settlement batches: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      const errorResponse: SettlementErrorResponse = {
        error: 'internal_error',
        message: 'Failed to fetch settlement data',
        retryable: true,
      };
      throw new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ========== API 3: Commit Batch ==========
  @Post(':batchId/committed')
  @ApiOperation({
    summary: 'Mark a settlement batch as committed',
    description:
      'Stores the commit information for a settlement batch including transaction hash and merkle root. Header: Authorization: Bearer {APP_API_KEY}',
  })
  @ApiParam({
    name: 'batchId',
    description: 'Batch ID (format: batch_YYYY_MM_DD_HH_MM)',
    example: 'batch_2024_01_01_00_00',
  })
  @ApiResponse({
    status: 200,
    description: 'Batch committed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        batchId: { type: 'string', example: 'batch_2024_01_01_00_00' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid batchId format or parameters',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
  })
  async commitBatch(
    @Param('batchId') batchId: string,
    @Body() dto: CommitBatchDto,
  ): Promise<{ success: boolean; batchId: string }> {
    try {
      this.logger.debug(
        `Commit batch request: ${batchId}, txHash: ${dto.txHash}`,
      );

      const result = await this.settlementService.commitBatch(
        batchId,
        dto.txHash,
        dto.merkleRoot,
        dto.committedAt,
      );

      this.logger.log(`Batch ${batchId} committed successfully`);

      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to commit batch: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      const errorResponse: SettlementErrorResponse = {
        error: 'internal_error',
        message: 'Failed to commit batch',
        retryable: true,
      };
      throw new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ========== API Query Committed Batches by Window ==========
  @Get('committed')
  @ApiOperation({
    summary: 'Get committed batches by committedAt time window',
    description:
      'Returns all committed settlement batches where committedAt is between windowStart and windowEnd. Query params: windowStart, windowEnd. Header: Authorization: Bearer {APP_API_KEY}',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved committed batches',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          batchId: { type: 'string', example: 'batch_2024_01_01_00_00' },
          txHash: { type: 'string', example: '0xabc123...' },
          merkleRoot: { type: 'string', example: '0xmerkle...' },
          committedAt: { type: 'number', example: 1704068200 },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid parameters',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  async getCommittedBatches(
    @Query() query: GetCommittedBatchesDto,
  ) {
    try {
      const { windowStart, windowEnd } = query;

      if (windowEnd <= windowStart) {
        const errorResponse: SettlementErrorResponse = {
          error: 'bad_request',
          message: 'windowEnd must be greater than windowStart',
          retryable: false,
        };
        throw new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
      }

      this.logger.debug(
        `Get committed batches: windowStart=${windowStart}, windowEnd=${windowEnd}`,
      );

      const commits = await this.settlementService.getCommittedBatches(
        windowStart,
        windowEnd,
      );

      this.logger.debug(`Found ${commits.length} committed batches`);

      return commits;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to get committed batches: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      const errorResponse: SettlementErrorResponse = {
        error: 'internal_error',
        message: 'Failed to fetch committed batches',
        retryable: true,
      };
      throw new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

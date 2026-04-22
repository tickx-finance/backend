import {
  Controller,
  Get,
  Query,
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

import { GetSettlementBatchesDto } from './dto/get-settlement-batches.dto';
import {
  SettlementBatchesResponse,
  SettlementErrorResponse,
} from './types/settlement.types';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { SettlementService } from './settlement.service';

@ApiTags('Settlement')
@Controller('settlement')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
export class SettlementController {
  private readonly logger = new Logger(SettlementController.name);

  constructor(private readonly settlementService: SettlementService) {}

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
                    originalStake: {
                      type: 'string',
                      example: '1000000000000000000',
                    },
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
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'unauthorized' },
        message: { type: 'string', example: 'Invalid API key' },
        retryable: { type: 'boolean', example: false },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'internal_error' },
        message: { type: 'string', example: 'Failed to fetch settlement data' },
        retryable: { type: 'boolean', example: true },
      },
    },
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
      // If it's already an HttpException, re-throw it
      if (error instanceof HttpException) {
        throw error;
      }

      // Log unexpected errors
      this.logger.error(
        `Failed to get settlement batches: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Return generic error
      const errorResponse: SettlementErrorResponse = {
        error: 'internal_error',
        message: 'Failed to fetch settlement data',
        retryable: true,
      };
      throw new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

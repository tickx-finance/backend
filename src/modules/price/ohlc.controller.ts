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

import { GetOhlcDto, OhlcSource } from './dto/get-ohlc.dto';
import { OhlcResponse, OhlcErrorResponse } from './types/ohlc.types';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { OhlcService } from './ohlc.service';

@ApiTags('Price Integrity - OHLC Candles')
@Controller('v1/ohlc')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
export class OhlcController {
  private readonly logger = new Logger(OhlcController.name);

  constructor(private readonly ohlcService: OhlcService) {}

  @Get()
  @ApiOperation({
    summary: 'Get OHLC candles for a time window',
    description:
      'Returns 1-second OHLC candles for price integrity verification. Supports both real-time (last 30 minutes from cache) and historical mock data. Header: Authorization: Bearer {APP_API_KEY}',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved OHLC candles',
    schema: {
      type: 'object',
      properties: {
        windowStart: { type: 'number', example: 1704067200 },
        windowEnd: { type: 'number', example: 1704068100 },
        count: { type: 'number', example: 900 },
        hash: { type: 'string', example: '0xabc123def456...' },
        candles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'number', example: 1704067200 },
              open: { type: 'string', example: '96240.50' },
              high: { type: 'string', example: '96280.00' },
              low: { type: 'string', example: '96230.00' },
              close: { type: 'string', example: '96260.00' },
            },
          },
        },
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
    status: 503,
    description:
      'Service Unavailable - Candles not available for requested window',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'data_unavailable' },
        message: {
          type: 'string',
          example: 'Candles not available for requested window',
        },
        retryable: { type: 'boolean', example: true },
      },
    },
  })
  async getOhlc(@Query() query: GetOhlcDto): Promise<OhlcResponse> {
    try {
      const { windowStart, windowEnd, source } = query;

      this.logger.debug(
        `OHLC request: windowStart=${windowStart}, windowEnd=${windowEnd}, source=${source}`,
      );

      // Check if we have data for this window
      if (!this.ohlcService.hasDataForWindow(windowStart, windowEnd)) {
        const errorResponse: OhlcErrorResponse = {
          error: 'data_unavailable',
          message: 'Candles not available for requested window',
          retryable: true,
        };
        throw new HttpException(errorResponse, HttpStatus.SERVICE_UNAVAILABLE);
      }

      // Get OHLC data
      const response = this.ohlcService.getOhlcData(
        windowStart,
        windowEnd,
        source,
      );

      this.logger.debug(
        `OHLC response: ${response.count} candles, hash=${response.hash}`,
      );

      return response;
    } catch (error) {
      // If it's already an HttpException, re-throw it
      if (error instanceof HttpException) {
        throw error;
      }

      // Log unexpected errors
      this.logger.error(
        `Failed to get OHLC data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Return generic error
      const errorResponse: OhlcErrorResponse = {
        error: 'internal_error',
        message: 'Failed to retrieve OHLC data',
        retryable: true,
      };
      throw new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

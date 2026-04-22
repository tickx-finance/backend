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
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

export interface StrategyRegimeResponse {
  regimeId: number;
  fortressSpreadBps: number;
  maxMultiplier: number;
  effectiveTs: number;
  volatilityIndex: string;
  regimeName: string;
}

@ApiTags('Strategy - Current Regime')
@Controller('v1/strategy')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
export class StrategyController {
  private readonly logger = new Logger(StrategyController.name);

  @Get('current')
  @ApiOperation({
    summary: 'Get current strategy regime',
    description:
      'Returns current strategy regime parameters including spread, multiplier, and volatility index. Header: Authorization: Bearer {APP_API_KEY}',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved current strategy regime',
    schema: {
      type: 'object',
      properties: {
        regimeId: { type: 'number', example: 2 },
        fortressSpreadBps: { type: 'number', example: 150 },
        maxMultiplier: { type: 'number', example: 100 },
        effectiveTs: { type: 'number', example: 1704067200 },
        volatilityIndex: { type: 'string', example: '0.45' },
        regimeName: { type: 'string', example: 'NORMAL' },
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
  async getCurrentRegime(): Promise<StrategyRegimeResponse> {
    try {
      this.logger.debug('Fetching current strategy regime');

      // effectiveTs is the newest/current timestamp
      const now = Math.floor(Date.now() / 1000);

      // Hardcoded response - NORMAL regime as per spec
      const response: StrategyRegimeResponse = {
        regimeId: Date.now(),                    // NORMAL = 2
        fortressSpreadBps: 150,         // 1.5% spread
        maxMultiplier: 100,             // 100x max multiplier
        effectiveTs: now,               // Current timestamp (newest)
        volatilityIndex: '0.45',        // Moderate volatility
        regimeName: 'NORMAL',           // Regime name
      };

      this.logger.debug(`Current regime: ${response.regimeName} (ID: ${response.regimeId})`);

      return response;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to get current regime: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new HttpException(
        {
          error: 'internal_error',
          message: 'Failed to fetch strategy regime',
          retryable: true,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

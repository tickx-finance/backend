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
import { RiskService } from './risk.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

export interface LiabilityResponse {
  timestamp: number;
  totalLiability: string;
  utilizationBps: number;
  maxSingleBetExposure: string;
  outstandingBets: number;
  breakdown: {
    byBand: any[];
    byTimeWindow: any[];
  };
}

@ApiTags('Pool Solvency - Liability Data')
@Controller('v1/risk')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
export class RiskController {
  private readonly logger = new Logger(RiskController.name);

  constructor(private readonly riskService: RiskService) {}

  @Get('liability')
  @ApiOperation({
    summary: 'Get pool solvency liability data',
    description:
      'Returns liability data including total liability, utilization, max exposure, and breakdown. Header: Authorization: Bearer {APP_API_KEY}',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved liability data',
    schema: {
      type: 'object',
      properties: {
        timestamp: { type: 'number', example: 1704067200 },
        totalLiability: {
          type: 'string',
          example: '50000000000000000000000',
          description: 'Total balance of all users (free + locked) in wei',
        },
        utilizationBps: { type: 'number', example: 500 },
        maxSingleBetExposure: { type: 'string', example: '1000000000000000000000' },
        outstandingBets: { type: 'number', example: 150 },
        breakdown: {
          type: 'object',
          properties: {
            byBand: { type: 'array', items: {} },
            byTimeWindow: { type: 'array', items: {} },
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
  async getLiability(): Promise<LiabilityResponse> {
    try {
      this.logger.debug('Fetching liability data');

      const result = await this.riskService.getLiabilityData();

      this.logger.debug(`Liability data: total=${result.totalLiability}`);

      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to get liability data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new HttpException(
        {
          error: 'internal_error',
          message: 'Failed to fetch liability data',
          retryable: true,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

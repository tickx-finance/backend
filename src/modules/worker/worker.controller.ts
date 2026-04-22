import {
  Controller,
  Get,
  Query,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WorkerService, PaginatedResponse } from './worker.service';
import { QueryEventsDto } from './dto/query-events.dto';
import { WorkflowIdUpdate } from './entities/workflow-id-update.entity';
import { PriceIntegrityBatch } from './entities/price-integrity-batch.entity';
import { BatchSubmitted } from './entities/batch-submitted.entity';
import { SettlementBatch } from './entities/settlement-batch.entity';
import { SolvencyReport } from './entities/solvency-report.entity';
import { LPDistributionRequest } from './entities/lp-distribution-request.entity';
import { ReserveAllocated } from './entities/reserve-allocated.entity';
import { VolatilityRegime } from './entities/volatility-regime.entity';

@ApiTags('Worker - On-chain Events')
@Controller('v1/worker/events')
@ApiBearerAuth('bearer')
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);

  constructor(private readonly workerService: WorkerService) {}

  private validateTimestampRange(fromTimestamp: number, toTimestamp: number): void {
    if (toTimestamp <= fromTimestamp) {
      throw new HttpException(
        {
          error: 'bad_request',
          message: 'toTimestamp must be greater than fromTimestamp',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const maxWindowSize = 30 * 24 * 60 * 60; // 30 days in seconds
    if (toTimestamp - fromTimestamp > maxWindowSize) {
      throw new HttpException(
        {
          error: 'bad_request',
          message: 'Time range exceeds maximum of 30 days',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ==================== WorkflowIdUpdate ====================
  @Get('workflow-id-updates')
  @ApiOperation({
    summary: 'Query ExpectedWorkflowIdUpdated events',
    description: 'Returns paginated ExpectedWorkflowIdUpdated events by block timestamp range',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved events',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        page: { type: 'number', example: 1 },
        pageSize: { type: 'number', example: 20 },
        total: { type: 'number', example: 100 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters' })
  async getWorkflowIdUpdates(
    @Query() query: QueryEventsDto,
  ): Promise<PaginatedResponse<WorkflowIdUpdate>> {
    try {
      this.validateTimestampRange(query.fromTimestamp, query.toTimestamp);

      this.logger.debug(
        `Query workflowIdUpdates: from=${query.fromTimestamp}, to=${query.toTimestamp}, page=${query.page}, pageSize=${query.pageSize}`,
      );

      return await this.workerService.queryWorkflowIdUpdates(
        query.fromTimestamp,
        query.toTimestamp,
        query.page,
        query.pageSize,
        query.contractAddress,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to query workflowIdUpdates: ${error.message}`);
      throw new HttpException(
        { error: 'internal_error', message: 'Failed to query events' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== PriceIntegrityBatch ====================
  @Get('price-integrity-batches')
  @ApiOperation({
    summary: 'Query PriceIntegrityBatchReported events',
    description: 'Returns paginated PriceIntegrityBatchReported events by block timestamp range',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved events',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        page: { type: 'number', example: 1 },
        pageSize: { type: 'number', example: 20 },
        total: { type: 'number', example: 100 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters' })
  async getPriceIntegrityBatches(
    @Query() query: QueryEventsDto,
  ): Promise<PaginatedResponse<PriceIntegrityBatch>> {
    try {
      this.validateTimestampRange(query.fromTimestamp, query.toTimestamp);

      this.logger.debug(
        `Query priceIntegrityBatches: from=${query.fromTimestamp}, to=${query.toTimestamp}`,
      );

      return await this.workerService.queryPriceIntegrityBatches(
        query.fromTimestamp,
        query.toTimestamp,
        query.page,
        query.pageSize,
        query.contractAddress,
        query.epochId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to query priceIntegrityBatches: ${error.message}`);
      throw new HttpException(
        { error: 'internal_error', message: 'Failed to query events' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== BatchSubmitted ====================
  @Get('batch-submitted')
  @ApiOperation({
    summary: 'Query BatchSubmitted events',
    description: 'Returns paginated BatchSubmitted events by block timestamp range',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved events',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        page: { type: 'number', example: 1 },
        pageSize: { type: 'number', example: 20 },
        total: { type: 'number', example: 100 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters' })
  async getBatchSubmitted(
    @Query() query: QueryEventsDto,
  ): Promise<PaginatedResponse<BatchSubmitted>> {
    try {
      this.validateTimestampRange(query.fromTimestamp, query.toTimestamp);

      return await this.workerService.queryBatchSubmitted(
        query.fromTimestamp,
        query.toTimestamp,
        query.page,
        query.pageSize,
        query.contractAddress,
        query.epochId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to query batchSubmitted: ${error.message}`);
      throw new HttpException(
        { error: 'internal_error', message: 'Failed to query events' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== SettlementBatch ====================
  @Get('settlement-batches')
  @ApiOperation({
    summary: 'Query SettlementBatchCommitted events',
    description: 'Returns paginated SettlementBatchCommitted events by block timestamp range',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved events',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        page: { type: 'number', example: 1 },
        pageSize: { type: 'number', example: 20 },
        total: { type: 'number', example: 100 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters' })
  async getSettlementBatches(
    @Query() query: QueryEventsDto,
  ): Promise<PaginatedResponse<SettlementBatch>> {
    try {
      this.validateTimestampRange(query.fromTimestamp, query.toTimestamp);

      return await this.workerService.querySettlementBatches(
        query.fromTimestamp,
        query.toTimestamp,
        query.page,
        query.pageSize,
        query.contractAddress,
        query.epochId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to query settlementBatches: ${error.message}`);
      throw new HttpException(
        { error: 'internal_error', message: 'Failed to query events' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== SolvencyReport ====================
  @Get('solvency-reports')
  @ApiOperation({
    summary: 'Query SolvencyReported events',
    description: 'Returns paginated SolvencyReported events by block timestamp range',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved events',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        page: { type: 'number', example: 1 },
        pageSize: { type: 'number', example: 20 },
        total: { type: 'number', example: 100 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters' })
  async getSolvencyReports(
    @Query() query: QueryEventsDto,
  ): Promise<PaginatedResponse<SolvencyReport>> {
    try {
      this.validateTimestampRange(query.fromTimestamp, query.toTimestamp);

      return await this.workerService.querySolvencyReports(
        query.fromTimestamp,
        query.toTimestamp,
        query.page,
        query.pageSize,
        query.contractAddress,
        query.epochId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to query solvencyReports: ${error.message}`);
      throw new HttpException(
        { error: 'internal_error', message: 'Failed to query events' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== LPDistributionRequest ====================
  @Get('lp-distribution-requests')
  @ApiOperation({
    summary: 'Query CCIPDistributionRequested events',
    description: 'Returns paginated CCIPDistributionRequested events by block timestamp range',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved events',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        page: { type: 'number', example: 1 },
        pageSize: { type: 'number', example: 20 },
        total: { type: 'number', example: 100 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters' })
  async getLPDistributionRequests(
    @Query() query: QueryEventsDto,
  ): Promise<PaginatedResponse<LPDistributionRequest>> {
    try {
      this.validateTimestampRange(query.fromTimestamp, query.toTimestamp);

      return await this.workerService.queryLPDistributionRequests(
        query.fromTimestamp,
        query.toTimestamp,
        query.page,
        query.pageSize,
        query.contractAddress,
        query.epochId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to query lpDistributionRequests: ${error.message}`);
      throw new HttpException(
        { error: 'internal_error', message: 'Failed to query events' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== ReserveAllocated ====================
  @Get('reserve-allocated')
  @ApiOperation({
    summary: 'Query ReserveAllocatedToDistributor events',
    description: 'Returns paginated ReserveAllocatedToDistributor events by block timestamp range',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved events',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        page: { type: 'number', example: 1 },
        pageSize: { type: 'number', example: 20 },
        total: { type: 'number', example: 100 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters' })
  async getReserveAllocated(
    @Query() query: QueryEventsDto,
  ): Promise<PaginatedResponse<ReserveAllocated>> {
    try {
      this.validateTimestampRange(query.fromTimestamp, query.toTimestamp);

      return await this.workerService.queryReserveAllocated(
        query.fromTimestamp,
        query.toTimestamp,
        query.page,
        query.pageSize,
        query.contractAddress,
        query.epochId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to query reserveAllocated: ${error.message}`);
      throw new HttpException(
        { error: 'internal_error', message: 'Failed to query events' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== VolatilityRegime ====================
  @Get('volatility-regimes')
  @ApiOperation({
    summary: 'Query VolatilityRegimeChanged events',
    description: 'Returns paginated VolatilityRegimeChanged events by block timestamp range',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved events',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        page: { type: 'number', example: 1 },
        pageSize: { type: 'number', example: 20 },
        total: { type: 'number', example: 100 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters' })
  async getVolatilityRegimes(
    @Query() query: QueryEventsDto,
  ): Promise<PaginatedResponse<VolatilityRegime>> {
    try {
      this.validateTimestampRange(query.fromTimestamp, query.toTimestamp);

      return await this.workerService.queryVolatilityRegimes(
        query.fromTimestamp,
        query.toTimestamp,
        query.page,
        query.pageSize,
        query.contractAddress,
        query.epochId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to query volatilityRegimes: ${error.message}`);
      throw new HttpException(
        { error: 'internal_error', message: 'Failed to query events' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

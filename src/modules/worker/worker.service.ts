import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { WorkflowIdUpdate } from './entities/workflow-id-update.entity';
import { PriceIntegrityBatch } from './entities/price-integrity-batch.entity';
import { BatchSubmitted } from './entities/batch-submitted.entity';
import { SettlementBatch } from './entities/settlement-batch.entity';
import { SolvencyReport } from './entities/solvency-report.entity';
import { LPDistributionRequest } from './entities/lp-distribution-request.entity';
import { ReserveAllocated } from './entities/reserve-allocated.entity';
import { VolatilityRegime } from './entities/volatility-regime.entity';

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    @InjectRepository(WorkflowIdUpdate)
    private readonly workflowIdUpdateRepo: Repository<WorkflowIdUpdate>,
    @InjectRepository(PriceIntegrityBatch)
    private readonly priceIntegrityBatchRepo: Repository<PriceIntegrityBatch>,
    @InjectRepository(BatchSubmitted)
    private readonly batchSubmittedRepo: Repository<BatchSubmitted>,
    @InjectRepository(SettlementBatch)
    private readonly settlementBatchRepo: Repository<SettlementBatch>,
    @InjectRepository(SolvencyReport)
    private readonly solvencyReportRepo: Repository<SolvencyReport>,
    @InjectRepository(LPDistributionRequest)
    private readonly lpDistributionRequestRepo: Repository<LPDistributionRequest>,
    @InjectRepository(ReserveAllocated)
    private readonly reserveAllocatedRepo: Repository<ReserveAllocated>,
    @InjectRepository(VolatilityRegime)
    private readonly volatilityRegimeRepo: Repository<VolatilityRegime>,
  ) {}

  private async queryWithPagination<T>(
    repo: Repository<T>,
    where: FindOptionsWhere<T>,
    page: number,
    pageSize: number,
    orderBy: string = 'blockTimestamp',
  ): Promise<PaginatedResponse<T>> {
    const skip = (page - 1) * pageSize;
    const take = Math.min(pageSize, 100);

    const [data, total] = await repo.findAndCount({
      where,
      order: { [orderBy]: 'DESC' } as any,
      skip,
      take,
    });

    return {
      data,
      page,
      pageSize: take,
      total,
    };
  }

  private buildBaseWhere(
    fromTimestamp: number,
    toTimestamp: number,
    contractAddress?: string,
  ): FindOptionsWhere<any> {
    const where: FindOptionsWhere<any> = {
      blockTimestamp: Between(fromTimestamp, toTimestamp),
    };

    if (contractAddress) {
      where.contractAddress = contractAddress.toLowerCase();
    }

    return where;
  }

  // ==================== WorkflowIdUpdate ====================
  async queryWorkflowIdUpdates(
    fromTimestamp: number,
    toTimestamp: number,
    page: number,
    pageSize: number,
    contractAddress?: string,
  ): Promise<PaginatedResponse<WorkflowIdUpdate>> {
    const where = this.buildBaseWhere(fromTimestamp, toTimestamp, contractAddress);
    return this.queryWithPagination(this.workflowIdUpdateRepo, where, page, pageSize);
  }

  // ==================== PriceIntegrityBatch ====================
  async queryPriceIntegrityBatches(
    fromTimestamp: number,
    toTimestamp: number,
    page: number,
    pageSize: number,
    contractAddress?: string,
    epochId?: string,
  ): Promise<PaginatedResponse<PriceIntegrityBatch>> {
    const where = this.buildBaseWhere(fromTimestamp, toTimestamp, contractAddress);
    if (epochId) {
      where.epochId = epochId;
    }
    return this.queryWithPagination(this.priceIntegrityBatchRepo, where, page, pageSize);
  }

  // ==================== BatchSubmitted ====================
  async queryBatchSubmitted(
    fromTimestamp: number,
    toTimestamp: number,
    page: number,
    pageSize: number,
    contractAddress?: string,
    epochId?: string,
  ): Promise<PaginatedResponse<BatchSubmitted>> {
    const where = this.buildBaseWhere(fromTimestamp, toTimestamp, contractAddress);
    if (epochId) {
      where.epochId = epochId;
    }
    return this.queryWithPagination(this.batchSubmittedRepo, where, page, pageSize);
  }

  // ==================== SettlementBatch ====================
  async querySettlementBatches(
    fromTimestamp: number,
    toTimestamp: number,
    page: number,
    pageSize: number,
    contractAddress?: string,
    batchId?: string,
  ): Promise<PaginatedResponse<SettlementBatch>> {
    const where = this.buildBaseWhere(fromTimestamp, toTimestamp, contractAddress);
    if (batchId) {
      where.batchId = batchId;
    }
    return this.queryWithPagination(this.settlementBatchRepo, where, page, pageSize);
  }

  // ==================== SolvencyReport ====================
  async querySolvencyReports(
    fromTimestamp: number,
    toTimestamp: number,
    page: number,
    pageSize: number,
    contractAddress?: string,
    epochId?: string,
  ): Promise<PaginatedResponse<SolvencyReport>> {
    const where = this.buildBaseWhere(fromTimestamp, toTimestamp, contractAddress);
    if (epochId) {
      where.epochId = epochId;
    }
    return this.queryWithPagination(this.solvencyReportRepo, where, page, pageSize);
  }

  // ==================== LPDistributionRequest ====================
  async queryLPDistributionRequests(
    fromTimestamp: number,
    toTimestamp: number,
    page: number,
    pageSize: number,
    contractAddress?: string,
    epochId?: string,
  ): Promise<PaginatedResponse<LPDistributionRequest>> {
    const where = this.buildBaseWhere(fromTimestamp, toTimestamp, contractAddress);
    if (epochId) {
      where.epochId = epochId;
    }
    return this.queryWithPagination(this.lpDistributionRequestRepo, where, page, pageSize);
  }

  // ==================== ReserveAllocated ====================
  async queryReserveAllocated(
    fromTimestamp: number,
    toTimestamp: number,
    page: number,
    pageSize: number,
    contractAddress?: string,
    receiver?: string,
  ): Promise<PaginatedResponse<ReserveAllocated>> {
    const where = this.buildBaseWhere(fromTimestamp, toTimestamp, contractAddress);
    if (receiver) {
      where.receiver = receiver.toLowerCase();
    }
    return this.queryWithPagination(this.reserveAllocatedRepo, where, page, pageSize);
  }

  // ==================== VolatilityRegime ====================
  async queryVolatilityRegimes(
    fromTimestamp: number,
    toTimestamp: number,
    page: number,
    pageSize: number,
    contractAddress?: string,
    regimeId?: string,
  ): Promise<PaginatedResponse<VolatilityRegime>> {
    const where = this.buildBaseWhere(fromTimestamp, toTimestamp, contractAddress);
    if (regimeId) {
      where.regimeId = regimeId;
    }
    return this.queryWithPagination(this.volatilityRegimeRepo, where, page, pageSize);
  }
}

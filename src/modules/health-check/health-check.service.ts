import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PriceService } from '../price/price.service';

@Injectable()
export class HealthCheckService {
  constructor(private readonly priceService: PriceService) {}

  public async healthCheck() {
    const priceStream = this.priceService.getStreamHealth();
    const payload = {
      code: priceStream.healthy ? 200 : 503,
      message: priceStream.healthy
        ? 'Server is running'
        : 'Server is running but price stream is degraded',
      priceStream,
    };

    if (!priceStream.healthy) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }
}

import { Module } from '@nestjs/common';
import { FortressLiabilityService } from './fortress-liability.service';

@Module({
    providers: [FortressLiabilityService],
    exports: [FortressLiabilityService],
})
export class FortressLiabilityModule { }

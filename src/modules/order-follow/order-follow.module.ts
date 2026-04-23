import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderFollowSubscription } from './entities/order-follow-subscription.entity';
import { OrderFollowController } from './order-follow.controller';
import { OrderFollowEligibilityService } from './order-follow-eligibility.service';
import { OrderFollowService } from './order-follow.service';

@Module({
    imports: [TypeOrmModule.forFeature([OrderFollowSubscription])],
    controllers: [OrderFollowController],
    providers: [OrderFollowService, OrderFollowEligibilityService],
    exports: [OrderFollowService, OrderFollowEligibilityService],
})
export class OrderFollowModule { }

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserAuthProfile } from './entities/user-auth-profile.entity';
import { UserAuthProfileService } from './user-auth-profile.service';

@Module({
    imports: [TypeOrmModule.forFeature([UserAuthProfile])],
    controllers: [AuthController],
    providers: [AuthService, UserAuthProfileService],
    exports: [AuthService, UserAuthProfileService],
})
export class AuthModule { }

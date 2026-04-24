import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MiniAppNonce } from './entities/miniapp-nonce.entity';
import { UserAuthProfile } from './entities/user-auth-profile.entity';
import { UserAuthProfileService } from './user-auth-profile.service';
import { MiniAppAuthVerifier } from './miniapp-auth.verifier';
import { MiniAppNonceService } from './miniapp-nonce.service';

@Module({
    imports: [TypeOrmModule.forFeature([UserAuthProfile, MiniAppNonce])],
    controllers: [AuthController],
    providers: [AuthService, UserAuthProfileService, MiniAppAuthVerifier, MiniAppNonceService],
    exports: [AuthService, UserAuthProfileService, MiniAppNonceService],
})
export class AuthModule { }

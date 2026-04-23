import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { env } from '../../../config';
import { AuthType } from '../entities/user-auth-profile.entity';
import { AuthJwtPayload, toAuthenticatedUser } from '../types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            throw new UnauthorizedException('No token provided');
        }

        const [type, token] = authHeader.split(' ');

        if (type !== 'Bearer' || !token) {
            throw new UnauthorizedException('Invalid token format');
        }

        try {
            const payload = jwt.verify(token, env.secret.jwtSecret) as Partial<AuthJwtPayload>;
            if (typeof payload.sub !== 'string' || !payload.sub) {
                throw new UnauthorizedException('Invalid token payload');
            }

            request.user = toAuthenticatedUser({
                sub: payload.sub,
                authType: payload.authType ?? AuthType.WALLET,
                humanVerified: payload.humanVerified === true,
                miniAppUserId: payload.miniAppUserId ?? null,
            });
            return true;
        } catch (error) {
            if (error instanceof UnauthorizedException) {
                throw error;
            }
            throw new UnauthorizedException('Invalid token');
        }
    }
}

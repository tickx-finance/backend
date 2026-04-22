import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { env } from '../../../config';

/**
 * Guard to protect CRE API endpoints with API Key authentication
 * 
 * Expected header format:
 * Authorization: Bearer {APP_API_KEY}
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            throw new UnauthorizedException({
                error: 'unauthorized',
                message: 'No API key provided',
                retryable: false,
            });
        }

        const [type, token] = authHeader.split(' ');

        if (type !== 'Bearer' || !token) {
            throw new UnauthorizedException({
                error: 'unauthorized',
                message: 'Invalid authorization format. Expected: Bearer {APP_API_KEY}',
                retryable: false,
            });
        }

        // Validate API Key
        if (token !== env.secret.appApiKey) {
            throw new UnauthorizedException({
                error: 'unauthorized',
                message: 'Invalid API key',
                retryable: false,
            });
        }

        return true;
    }
}

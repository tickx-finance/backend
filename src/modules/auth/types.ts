import { AuthType } from './entities/user-auth-profile.entity';

export interface AuthJwtPayload {
    sub: string;
    authType: AuthType;
    humanVerified: boolean;
    miniAppUserId?: string | null;
}

export interface AuthenticatedUser {
    address: string;
    authType: AuthType;
    humanVerified: boolean;
    miniAppUserId: string | null;
}

export function toAuthenticatedUser(payload: AuthJwtPayload): AuthenticatedUser {
    return {
        address: payload.sub,
        authType: payload.authType,
        humanVerified: payload.humanVerified === true,
        miniAppUserId: payload.miniAppUserId ?? null,
    };
}

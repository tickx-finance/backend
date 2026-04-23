import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ethers } from 'ethers';
import {
    MiniAppLoginDto,
    MiniAppVerifyHumanDto,
    MiniAppWalletAuthSuccessPayloadDto,
} from './dto/miniapp-login.dto';

export interface MiniAppLoginVerificationResult {
    address: string;
}

export interface MiniAppHumanVerificationResult {
    humanVerified: boolean;
    verificationSource: string | null;
    verifiedAt: Date | null;
}

@Injectable()
export class MiniAppAuthVerifier {
    verifyLogin(nonce: string, payload: MiniAppWalletAuthSuccessPayloadDto): MiniAppLoginVerificationResult {
        if (payload.status.toLowerCase() !== 'success') {
            throw new UnauthorizedException('Invalid mini-app auth status');
        }

        const normalizedAddress = ethers.getAddress(payload.address);
        if (!payload.message.includes(nonce)) {
            throw new BadRequestException('Mini-app auth message does not include nonce');
        }

        const recoveredAddress = ethers.verifyMessage(payload.message, payload.signature);
        if (recoveredAddress !== normalizedAddress) {
            throw new UnauthorizedException('Invalid mini-app signature');
        }

        return { address: normalizedAddress };
    }

    verifyHuman(address: string, humanProof?: MiniAppVerifyHumanDto): MiniAppHumanVerificationResult {
        if (!humanProof) {
            return {
                humanVerified: false,
                verificationSource: null,
                verifiedAt: null,
            };
        }

        const normalizedAddress = ethers.getAddress(address);
        const normalizedSignal = ethers.getAddress(humanProof.signal);
        if (normalizedSignal !== normalizedAddress) {
            throw new BadRequestException('Mini-app human proof signal mismatch');
        }

        return {
            humanVerified: true,
            verificationSource: 'worldchain-miniapp',
            verifiedAt: new Date(),
        };
    }

    verify(dto: MiniAppLoginDto): MiniAppLoginVerificationResult & MiniAppHumanVerificationResult {
        const login = this.verifyLogin(dto.nonce, dto.payload);
        const human = this.verifyHuman(login.address, dto.humanProof);

        return {
            ...login,
            ...human,
        };
    }
}

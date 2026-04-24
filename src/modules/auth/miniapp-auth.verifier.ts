import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ethers } from 'ethers';
import {
    MiniAppLoginDto,
    MiniAppVerifyHumanDto,
} from './dto/miniapp-login.dto';
import { verifySiweMessage } from '../../libs/worldapp/siwe';
import { WorldApp } from '../../libs/worldapp/worldapp';

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
    async verifyLogin(nonce: string, payload: MiniAppLoginDto['payload']): Promise<MiniAppLoginVerificationResult> {
        if (payload.status.toLowerCase() !== 'success') {
            throw new UnauthorizedException('Invalid mini-app auth status');
        }

        const verifyResult = await verifySiweMessage(payload, nonce);
        if (!verifyResult?.isValid || !verifyResult.siweMessageData.address) {
            throw new UnauthorizedException('Invalid mini-app signature');
        }

        return { address: ethers.getAddress(verifyResult.siweMessageData.address) };
    }

    async verifyHuman(address: string, humanProof: MiniAppVerifyHumanDto): Promise<MiniAppHumanVerificationResult> {
        const normalizedAddress = ethers.getAddress(address);
        const normalizedSignal = ethers.getAddress(humanProof.signal);
        if (normalizedSignal !== normalizedAddress) {
            throw new BadRequestException('Mini-app human proof signal mismatch');
        }

        const verified = await WorldApp.verifyHuman(humanProof);
        if (!verified) {
            throw new BadRequestException('Invalid mini-app human proof');
        }

        return {
            humanVerified: true,
            verificationSource: 'worldchain-miniapp',
            verifiedAt: new Date(),
        };
    }
}

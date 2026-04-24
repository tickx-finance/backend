import {
  MiniAppWalletAuthSuccessPayloadDto as MiniAppWalletAuthSuccessPayload,
  MiniAppVerifyHumanDto as VerifyHumanDto,
} from '../../modules/auth/dto/miniapp-login.dto';
import { env } from '../../config';
import { verifySiweMessage } from './siwe';
import { getAddress } from 'ethers';
import axios from 'axios';

type WorldAppVerifyCloudProof = (
  payload: Record<string, unknown>,
  appId: string,
  action: string,
  signal: string,
) => Promise<{ success?: boolean }>;

const loadVerifyCloudProof = (): WorldAppVerifyCloudProof => {
  const minikit = require('@worldcoin/minikit-js') as {
    verifyCloudProof?: WorldAppVerifyCloudProof;
  };

  if (typeof minikit.verifyCloudProof !== 'function') {
    throw new Error('@worldcoin/minikit-js.verifyCloudProof is unavailable');
  }

  return minikit.verifyCloudProof;
};

export namespace WorldApp {
  export async function verifyWorldAppPayload(
    nonce: string,
    payload: MiniAppWalletAuthSuccessPayload,
  ) {
    try {
      if (payload.status !== 'success') return false;

      const verifyResult = await verifySiweMessage(payload, nonce);
      if (!verifyResult?.isValid) return false;

      const { address } = verifyResult.siweMessageData;
      return getAddress(address);
    } catch {
      return false;
    }
  }

  export function verifyDomainUri(domain: string, uri: string) {
    const isValidDomain = env.worldApp.domains.includes(domain);
    const isValidUri = env.worldApp.uris.includes(uri);
    return isValidDomain && isValidUri;
  }

  export async function verifyHuman(dto: VerifyHumanDto) {
    const { action, signal, payload } = dto;

    if (payload.verification_level !== 'orb') return false;
    const verifyCloudProof = loadVerifyCloudProof();
    for (const appId of env.worldApp.appIds) {
      const result = await verifyCloudProof(
        payload as unknown as Record<string, unknown>,
        appId,
        action,
        signal,
      );

      if (result.success) return true;
    }

    return false;
  }

  export async function sendWorldAppNotification(body: {
    app_id: string;
    wallet_addresses: string[];
    title: string;
    message: string;
    mini_app_path?: string;
  }): Promise<any> {
    try {
      const response = await axios.post(
        'https://developer.worldcoin.org/api/v2/minikit/send-notification',
        body,
        {
          headers: {
            Authorization: `Bearer ${env.worldApp.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      const status = error.response?.status ?? 'UNKNOWN';
      const data = error.response?.data ?? error.message;
      throw new Error(
        `Failed to send notification: ${status} ${JSON.stringify(data)}`,
      );
    }
  }
}

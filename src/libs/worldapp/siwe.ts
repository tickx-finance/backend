import { MiniAppWalletAuthSuccessPayloadDto as MiniAppWalletAuthSuccessPayload } from '../../modules/auth/dto/miniapp-login.dto';
import {
  Client,
  createPublicClient,
  getContract,
  hashMessage,
  http,
  recoverAddress,
} from 'viem';
import { worldchain } from 'viem/chains';

const PREAMBLE = ' wants you to sign in with your Ethereum account:';
const URI_TAG = 'URI: ';
const VERSION_TAG = 'Version: ';
const CHAIN_TAG = 'Chain ID: ';
const NONCE_TAG = 'Nonce: ';
const IAT_TAG = 'Issued At: ';
const EXP_TAG = 'Expiration Time: ';
const NBF_TAG = 'Not Before: ';
const RID_TAG = 'Request ID: ';
const ERC_191_PREFIX = '\x19Ethereum Signed Message:\n';
const EIP1271_MAGICVALUE = '0x1626ba7e';

export type SiweMessage = {
  scheme?: string;
  domain: string;
  address?: string;
  statement?: string;
  uri: string;
  version: string;
  chain_id: number;
  nonce: string;
  issued_at: string;
  expiration_time?: string;
  not_before?: string;
  request_id?: string;
};

const SAFE_CONTRACT_ABI = [
  {
    inputs: [
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
    ],
    name: 'isOwner',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: '_message',
        type: 'bytes32',
      },
      {
        internalType: 'bytes',
        name: '_signature',
        type: 'bytes',
      },
    ],
    name: 'isValidSignature',
    outputs: [
      {
        internalType: 'bytes4',
        name: '',
        type: 'bytes4',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

const tagged = (line, tag) => {
  if (line && line.includes(tag)) {
    return line.replace(tag, '');
  }
  throw new Error(`Missing '${tag}'`);
};

export const parseSiweMessage = (inputString: string) => {
  const lines = inputString.split('\n')[Symbol.iterator]();
  const domain = tagged(lines.next()?.value, PREAMBLE);
  const address = lines.next()?.value;
  lines.next();

  const nextValue = lines.next()?.value;
  let statement;
  if (nextValue) {
    statement = nextValue;
    lines.next();
  }

  const uri = tagged(lines.next()?.value, URI_TAG);
  const version = tagged(lines.next()?.value, VERSION_TAG);
  const chain_id = tagged(lines.next()?.value, CHAIN_TAG);
  const nonce = tagged(lines.next()?.value, NONCE_TAG);
  const issued_at = tagged(lines.next()?.value, IAT_TAG);

  let expiration_time, not_before, request_id;
  for (const line of lines) {
    if (line.startsWith(EXP_TAG)) {
      expiration_time = tagged(line, EXP_TAG);
    } else if (line.startsWith(NBF_TAG)) {
      not_before = tagged(line, NBF_TAG);
    } else if (line.startsWith(RID_TAG)) {
      request_id = tagged(line, RID_TAG);
    }
  }

  if (lines.next().done === false) {
    throw new Error('Extra lines in the input');
  }

  const siweMessageData: SiweMessage = {
    domain,
    address,
    statement,
    uri,
    version,
    chain_id,
    nonce,
    issued_at,
    expiration_time,
    not_before,
    request_id,
  };

  return siweMessageData;
};

export const generateSiweMessage = (siweMessageData: SiweMessage) => {
  let siweMessage = '';

  if (siweMessageData.scheme) {
    siweMessage += `${siweMessageData.scheme}://${siweMessageData.domain} wants you to sign in with your Ethereum account:\n`;
  } else {
    siweMessage += `${siweMessageData.domain} wants you to sign in with your Ethereum account:\n`;
  }

  if (siweMessageData.address) {
    siweMessage += `${siweMessageData.address}\n`;
  } else {
    siweMessage += '{address}\n';
  }
  siweMessage += '\n';

  if (siweMessageData.statement) {
    siweMessage += `${siweMessageData.statement}\n`;
  }

  siweMessage += '\n';
  siweMessage += `URI: ${siweMessageData.uri}\n`;
  siweMessage += `Version: ${siweMessageData.version}\n`;
  siweMessage += `Chain ID: ${siweMessageData.chain_id}\n`;
  siweMessage += `Nonce: ${siweMessageData.nonce}\n`;
  siweMessage += `Issued At: ${siweMessageData.issued_at}\n`;

  if (siweMessageData.expiration_time) {
    siweMessage += `Expiration Time: ${siweMessageData.expiration_time}\n`;
  }

  if (siweMessageData.not_before) {
    siweMessage += `Not Before: ${siweMessageData.not_before}\n`;
  }

  if (siweMessageData.request_id) {
    siweMessage += `Request ID: ${siweMessageData.request_id}\n`;
  }

  return siweMessage;
};

export const verifySiweMessage = (
  payload: MiniAppWalletAuthSuccessPayload,
  nonce: string,
  statement?: string,
  requestId?: string,
  userProvider?: Client,
) => {
  if (payload.version === 2) {
    return verifySiweMessageV2(
      payload,
      nonce,
      statement,
      requestId,
      userProvider,
    );
  }

  return verifySiweMessageV1(
    payload,
    nonce,
    statement,
    requestId,
    userProvider,
  );
};

const validateMessage = (
  siweMessageData: SiweMessage,
  nonce: string,
  statement?: string,
  requestId?: string,
) => {
  if (siweMessageData.expiration_time) {
    const expirationTime = new Date(siweMessageData.expiration_time);
    if (expirationTime < new Date()) {
      throw new Error('Expired message');
    }
  }

  if (siweMessageData.not_before) {
    const notBefore = new Date(siweMessageData.not_before);
    if (notBefore > new Date()) {
      throw new Error('Not Before time has not passed');
    }
  }

  if (nonce && siweMessageData.nonce !== nonce) {
    throw new Error(
      `Nonce mismatch. Got: ${siweMessageData.nonce}, Expected: ${nonce}`,
    );
  }

  if (statement && siweMessageData.statement !== statement) {
    throw new Error(
      `Statement mismatch. Got: ${siweMessageData.statement}, Expected: ${statement}`,
    );
  }

  if (requestId && siweMessageData.request_id !== requestId) {
    throw new Error(
      `Request ID mismatch. Got: ${siweMessageData.request_id}, Expected: ${requestId}`,
    );
  }
  return true;
};

export const verifySiweMessageV1 = async (
  payload: MiniAppWalletAuthSuccessPayload,
  nonce: string,
  statement?: string,
  requestId?: string,
  userProvider?: Client,
) => {
  if (typeof window !== 'undefined') {
    throw new Error('Wallet auth payload can only be verified in the backend');
  }

  const { message, signature, address } = payload;
  const siweMessageData = parseSiweMessage(message);
  validateMessage(siweMessageData, nonce, statement, requestId);

  const provider =
    userProvider ||
    createPublicClient({ chain: worldchain, transport: http() });
  const signedMessage = `${ERC_191_PREFIX}${message.length}${message}`;
  const hashedMessage = hashMessage(signedMessage);
  const contract = getContract({
    address: address as `0x${string}`,
    abi: SAFE_CONTRACT_ABI,
    client: provider as any,
  });

  try {
    const recoveredAddress = await recoverAddress({
      hash: hashedMessage,
      signature: `0x${signature}`,
    });

    const isOwner = await (contract as any).read.isOwner([recoveredAddress]);
    if (!isOwner) {
      throw new Error('Signature verification failed, invalid owner');
    }
  } catch {
    throw new Error('Signature verification failed');
  }

  return { isValid: true, siweMessageData };
};

export const verifySiweMessageV2 = async (
  payload: MiniAppWalletAuthSuccessPayload,
  nonce: string,
  statement?: string,
  requestId?: string,
  userProvider?: Client,
) => {
  if (typeof window !== 'undefined') {
    throw new Error('Wallet auth payload can only be verified in the backend');
  }

  const { message, signature, address } = payload;
  const siweMessageData = parseSiweMessage(message);
  if (!validateMessage(siweMessageData, nonce, statement, requestId)) {
    throw new Error('Validation failed');
  }

  try {
    const walletContract = getContract({
      address: address as `0x${string}`,
      abi: SAFE_CONTRACT_ABI,
      client: (userProvider ||
        createPublicClient({ chain: worldchain, transport: http() })) as any,
    });
    const hashedMessage = hashMessage(message);
    const res = await (walletContract as any).read.isValidSignature([
      hashedMessage,
      signature,
    ]);
    return {
      isValid: res === EIP1271_MAGICVALUE,
      siweMessageData,
    };
  } catch {
    throw new Error('Signature verification failed');
  }
};

import { ethers } from 'ethers';
import { env } from 'src/config';

// Create provider from environment config
export const provider = new ethers.JsonRpcProvider(env.web3.rpc);

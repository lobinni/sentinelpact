import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";

/**
 * Central chain configuration. Every network and contract value is sourced
 * from environment variables with Studionet defaults.
 *
 * Redeployment: set `NEXT_PUBLIC_SENTINELPACT_CONTRACT` to the new address and
 * rebuild (see `.env.example` and `deployments/studionet.json`). When the
 * variable is unset or empty, the canonical Studionet deployment below is
 * used, so the app boots fully configured with zero environment setup.
 *
 * Wallet model — plugin-free: genlayer-js routes only `eth_sendTransaction`
 * and `eth_signTransaction` through the injected EIP-1193 provider (MetaMask)
 * after asserting the chain matches Studionet; every other JSON-RPC call goes
 * over plain HTTPS to the studio endpoint. No snap, plugin, WalletConnect, or
 * backend signer is involved at any point.
 */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || "61999");
export const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;
export const RPC_URL = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
export const EXPLORER_URL = process.env.NEXT_PUBLIC_GENLAYER_EXPLORER || "https://explorer-studio.genlayer.com";

export const DEFAULT_CONTRACT_ADDRESS = "0x81d6c588A9bee60265DEA0d19c38818a77f32bcf";
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_SENTINELPACT_CONTRACT || DEFAULT_CONTRACT_ADDRESS).trim();

if (CHAIN_ID !== 61999) {
  throw new Error("SentinelPact is configured exclusively for GenLayer Studionet (chain 61999).");
}

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function provider() {
  return typeof window !== "undefined" ? window.ethereum || null : null;
}

/**
 * Ask the injected wallet to switch to (or add) Studionet. Reuses the standard
 * wallet_switchEthereumChain / wallet_addEthereumChain pair — nothing
 * GenLayer-specific is installed in the wallet.
 */
export async function requestStudionetNetwork(injected: Eip1193Provider) {
  try {
    await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
  } catch (error: any) {
    if (error?.code !== 4902) throw error;
    await injected.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_HEX,
          chainName: "GenLayer Studionet",
          nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER_URL],
        },
      ],
    });
  }
}

/**
 * Preflight before every write: make sure MetaMask has granted account access
 * and is on Studionet (switching automatically when possible). Returns the
 * address MetaMask considers active — MetaMask always signs from its own
 * active account, so the UI must prefer it over any cached address.
 */
export async function preflightWallet(expected?: string | null): Promise<`0x${string}` | null> {
  const injected = provider();
  if (!injected) throw new Error("No injected EIP-1193 wallet was found. Install MetaMask to continue.");
  let accounts: string[] = [];
  try {
    accounts = (await injected.request({ method: "eth_requestAccounts" })) as string[];
  } catch (error: any) {
    if (error?.code === 4001) throw new Error("Connection request was rejected in the wallet.");
    throw error;
  }
  let chainHex: string | undefined;
  try {
    chainHex = await injected.request({ method: "eth_chainId" });
  } catch {
    chainHex = undefined;
  }
  if (Number.parseInt(String(chainHex), 16) !== CHAIN_ID) {
    await requestStudionetNetwork(injected);
  }
  const active = (accounts?.[0] || null) as `0x${string}` | null;
  if (active && expected && active.toLowerCase() !== expected.toLowerCase()) {
    // MetaMask switched accounts — signing will use the active one.
    return active;
  }
  return active || (expected as `0x${string}` | null);
}

export function readClient() {
  return createClient({ chain: studionet, endpoint: RPC_URL });
}

export async function writeClient(address: `0x${string}`) {
  const injected = provider();
  if (!injected) throw new Error("No injected EIP-1193 wallet was found.");
  // Plain address account: SDK marks it external and only delegates
  // eth_sendTransaction / eth_signTransaction to the injected wallet.
  return createClient({
    chain: studionet,
    account: address,
    provider: injected as any,
    endpoint: RPC_URL,
  } as any);
}

export async function latestFinalRead(functionName: string, args: any[] = []) {
  if (!CONTRACT_ADDRESS) throw new Error("SentinelPact contract address is not configured.");
  return readClient().readContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    functionName,
    args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

export function contractExplorer() {
  return CONTRACT_ADDRESS ? `${EXPLORER_URL}/address/${CONTRACT_ADDRESS}` : EXPLORER_URL;
}

export function addressExplorer(address?: string | null) {
  return address ? `${EXPLORER_URL}/address/${address}` : EXPLORER_URL;
}

export function transactionExplorer(hash?: string) {
  return hash ? `${EXPLORER_URL}/tx/${hash}` : `${EXPLORER_URL}/txs`;
}

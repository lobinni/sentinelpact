"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CHAIN_ID, provider, requestStudionetNetwork } from "./client";
import type { WalletState } from "@/lib/types";

const initial: WalletState = {
  address: null,
  chainId: null,
  connected: false,
  correctNetwork: false,
  loading: true,
};

type WalletContextShape = WalletState & {
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextShape | null>(null);
const DISCONNECTED = "sentinelpact.wallet.disconnected";

async function chainId() {
  const p = provider();
  if (!p) return null;
  const value = await p.request({ method: "eth_chainId" });
  return Number.parseInt(String(value), 16);
}

/**
 * MetaMask-only wallet context. Connection is plain EIP-1193:
 * eth_requestAccounts + wallet_switchEthereumChain (wallet_addEthereumChain on
 * first sight) for chain 61999. No GenLayer snap/plugin is ever installed.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>(initial);

  const refresh = useCallback(async (requestAccounts = false) => {
    const p = provider();
    if (!p) {
      setState({ ...initial, loading: false });
      return;
    }
    const accounts = (await p.request({
      method: requestAccounts ? "eth_requestAccounts" : "eth_accounts",
    })) as string[];
    const network = await chainId();
    const address = (accounts?.[0] || null) as `0x${string}` | null;
    setState({
      address,
      chainId: network,
      connected: !!address,
      correctNetwork: network === CHAIN_ID,
      loading: false,
    });
  }, []);

  useEffect(() => {
    if (localStorage.getItem(DISCONNECTED) === "1") {
      setState({ ...initial, loading: false });
      return;
    }
    refresh(false).catch(() => setState({ ...initial, loading: false }));
  }, [refresh]);

  useEffect(() => {
    const p = provider();
    if (!p?.on) return;
    const changed = () => refresh(false).catch(() => undefined);
    p.on("accountsChanged", changed);
    p.on("chainChanged", changed);
    return () => {
      p.removeListener?.("accountsChanged", changed);
      p.removeListener?.("chainChanged", changed);
    };
  }, [refresh]);

  const switchNetwork = useCallback(async () => {
    const p = provider();
    if (!p) throw new Error("No injected EIP-1193 wallet was found.");
    await requestStudionetNetwork(p);
    await refresh(false);
  }, [refresh]);

  const connect = useCallback(async () => {
    localStorage.removeItem(DISCONNECTED);
    await refresh(true);
    const network = await chainId();
    if (network !== CHAIN_ID) await switchNetwork();
  }, [refresh, switchNetwork]);

  const disconnect = useCallback(() => {
    localStorage.setItem(DISCONNECTED, "1");
    setState({ ...initial, loading: false });
  }, []);

  const value = useMemo(
    () => ({ ...state, connect, switchNetwork, disconnect }),
    [state, connect, switchNetwork, disconnect]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}

"use client";

import { WalletProvider } from "@/lib/genlayer/wallet";

export function Providers({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

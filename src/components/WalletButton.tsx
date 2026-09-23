"use client";

import { useState } from "react";
import { Unplug, Wallet } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import { shortAddress } from "@/lib/format";

export function WalletButton() {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await wallet.connect();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection failed.");
    } finally {
      setBusy(false);
    }
  };

  if (wallet.connected && wallet.address) {
    return (
      <div className="flex items-center gap-2">
        {!wallet.correctNetwork && (
          <button className="btn btn-accent btn-sm" onClick={() => wallet.switchNetwork().catch(() => undefined)}>
            Switch to 61999
          </button>
        )}
        <span className={`pill ${wallet.correctNetwork ? "pill-live" : "pill-danger"}`}>
          <span className="mono">{shortAddress(wallet.address)}</span>
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={wallet.disconnect}
          title="Disconnect wallet"
          aria-label="Disconnect wallet"
        >
          <Unplug className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn btn-primary btn-sm" onClick={connect} disabled={busy || wallet.loading}>
        <Wallet className="h-3.5 w-3.5" />
        {busy ? "Connecting…" : "Connect wallet"}
      </button>
      {error && <span className="mono hidden text-[10px] text-[var(--danger)] sm:inline">{error.slice(0, 42)}</span>}
    </div>
  );
}

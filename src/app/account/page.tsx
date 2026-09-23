"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Banknote, Wallet } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { StatusPill } from "@/components/StatusPill";
import { LoadState } from "@/components/LoadState";
import { TxRail } from "@/components/TxRail";
import { ConfigNotice } from "@/components/ConfigNotice";
import { SentinelPact } from "@/lib/genlayer/sentinelpact";
import { useWallet } from "@/lib/genlayer/wallet";
import { addressExplorer } from "@/lib/genlayer/client";
import { formatDate, genFromAtto, shortAddress } from "@/lib/format";
import type { TxState, WarrantyRecord } from "@/lib/types";

const IDLE: TxState = { stage: "idle" };

type Position = { warranty: WarrantyRecord; coverage: string; claimed: boolean };

export default function AccountPage() {
  const wallet = useWallet();
  const configured = SentinelPact.configured();
  const ready = wallet.connected && wallet.correctNetwork && wallet.address;

  const [credit, setCredit] = useState("0");
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<TxState>(IDLE);

  useEffect(() => {
    if (!configured || !wallet.address) {
      setPositions([]);
      setCredit("0");
      return;
    }
    let alive = true;
    setLoading(true);
    const address = wallet.address;
    Promise.all([SentinelPact.credit(address), SentinelPact.listWarranties()])
      .then(async ([creditValue, warranties]) => {
        const rows = await Promise.all(
          warranties.map(async (warranty) => {
            const cov = await SentinelPact.coverage(warranty.warranty_id, address).catch(() => null);
            return cov && cov.coverage_atto !== "0"
              ? { warranty, coverage: cov.coverage_atto, claimed: !!cov.claimed }
              : null;
          })
        );
        if (!alive) return;
        setCredit(creditValue);
        setPositions(rows.filter(Boolean) as Position[]);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to load account state."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [configured, wallet.address, tx.stage]);

  if (!configured) {
    return (
      <div className="container-x pt-14">
        <ConfigNotice />
      </div>
    );
  }

  return (
    <div className="container-x pt-14">
      <PageHead
        eyebrow="Your ledger"
        title="Account"
        lead="Pull-payment credits, coverage positions, and settlement claims tied to the connected wallet."
      />

      {!ready ? (
        <div className="card card-pad mt-10 flex items-start gap-3 border-[rgba(147,104,0,0.45)]">
          <Wallet className="mt-0.5 h-4 w-4 text-[var(--amber)]" />
          <p className="text-sm">
            Connect a wallet on <strong>Studionet (chain 61999)</strong> to inspect your positions.
          </p>
        </div>
      ) : (
        <div className="mt-10 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <div className="card card-pad corner-marks">
              <p className="eyebrow">Connected</p>
              <a
                href={addressExplorer(wallet.address)}
                target="_blank"
                rel="noreferrer"
                className="mono mt-3 block break-all text-sm font-medium text-[var(--mint-deep)] underline underline-offset-4"
              >
                {shortAddress(wallet.address)}
              </a>
              <div className="mt-6 grid grid-cols-2 gap-px border border-[var(--line)] bg-[var(--line)]">
                <div className="bg-[var(--bg-elev)] p-4">
                  <p className="stat-label mt-0">Withdrawable</p>
                  <p className="display mt-2 text-3xl">{genFromAtto(credit)}</p>
                  <p className="mono mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--muted-fg)]">GEN</p>
                </div>
                <div className="bg-[var(--bg-elev)] p-4">
                  <p className="stat-label mt-0">Positions</p>
                  <p className="display mt-2 text-3xl">{positions.length}</p>
                  <p className="mono mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--muted-fg)]">coverage lines</p>
                </div>
              </div>
              <button
                className="btn btn-primary mt-6 w-full"
                disabled={credit === "0" || tx.stage === "signing" || tx.stage === "submitted"}
                onClick={() => {
                  if (!wallet.address) return;
                  setTx({ stage: "signing", message: "Preparing withdrawal…" });
                  SentinelPact.write(wallet.address, "withdraw_credit", [wallet.address], 0n, setTx).catch(() => undefined);
                }}
              >
                <Banknote className="h-4 w-4" /> Withdraw credit
              </button>
            </div>
            {tx.stage !== "idle" && <TxRail state={tx} />}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">Coverage positions</p>
            </div>
            <LoadState loading={loading} error={error} empty={!loading && !positions.length ? "No coverage positions for this wallet." : null}>
              <div className="space-y-3">
                {positions.map(({ warranty, coverage, claimed }) => (
                  <Link
                    key={warranty.warranty_id}
                    href={`/warranties/${warranty.warranty_id}`}
                    className="card card-pad card-hover flex flex-wrap items-center justify-between gap-4"
                  >
                    <div>
                      <p className="font-semibold">{warranty.title}</p>
                      <p className="mono mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--muted-fg)]">
                        {warranty.warranty_id} · covered {genFromAtto(coverage)} GEN · ends {formatDate(warranty.ends_at)}
                        {claimed ? " · claimed" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusPill status={warranty.status} />
                      <ArrowRight className="h-4 w-4 text-[var(--muted-fg)]" />
                    </div>
                  </Link>
                ))}
              </div>
            </LoadState>
          </div>
        </div>
      )}
    </div>
  );
}

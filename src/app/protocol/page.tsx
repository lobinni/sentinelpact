"use client";

import { useEffect, useState } from "react";
import { Copy, FileSearch, Gavel, Landmark, Layers, Lock, Scale } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { LoadState } from "@/components/LoadState";
import { ConfigNotice } from "@/components/ConfigNotice";
import { SentinelPact } from "@/lib/genlayer/sentinelpact";
import { CHAIN_ID, CONTRACT_ADDRESS, EXPLORER_URL, RPC_URL, contractExplorer } from "@/lib/genlayer/client";
import { genFromAtto, shortAddress } from "@/lib/format";
import type { ProtocolStats } from "@/lib/types";

const PILLARS = [
  {
    icon: Lock,
    title: "Frozen terms",
    text: "Severity rules, vulnerability classes, exclusions, thresholds, and windows are locked at warranty creation. Nothing is renegotiable after escrows open.",
  },
  {
    icon: FileSearch,
    title: "Stage one · source examination",
    text: "Each revealed source is fetched by validators and reduced to structured facts by an independent consensus round. Unreachable or immaterial sources can never influence a verdict.",
  },
  {
    icon: Scale,
    title: "Stage two · adjudication",
    text: "Only verified evidence from distinct source families reaches the judge stage. A separate consensus round replays the decision before any verdict finalizes.",
  },
  {
    icon: Landmark,
    title: "Deterministic settlement",
    text: "A finalized BREACHED verdict alone converts bond escrow into a payout reserve. Holders claim their covered amount, then withdraw through pull payments.",
  },
];

export default function ProtocolPage() {
  const configured = SentinelPact.configured();
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let alive = true;
    SentinelPact.stats()
      .then((value) => alive && setStats(value))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to load protocol stats."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [configured]);

  const accounting = stats
    ? [
        { label: "Warranty escrow", value: `${genFromAtto(stats.warranty_escrow_atto)} GEN` },
        { label: "Evidence escrow", value: `${genFromAtto(stats.evidence_escrow_atto)} GEN` },
        { label: "Payout reserve", value: `${genFromAtto(stats.payout_reserve_atto)} GEN` },
        { label: "Claimable credit", value: `${genFromAtto(stats.claimable_atto)} GEN` },
        { label: "Withdrawn to date", value: `${genFromAtto(stats.withdrawn_atto)} GEN` },
        { label: "Accounting balanced", value: stats.accounting_balanced ? "Yes" : "No" },
      ]
    : [];

  return (
    <div className="container-x pt-14">
      <PageHead
        eyebrow="Protocol"
        title="Settlement by consensus"
        lead="SentinelPact keeps every protocol dollar and every verdict inside a single intelligent contract on GenLayer Studionet."
      />

      {/* network card */}
      <section className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="card card-pad corner-marks">
          <p className="eyebrow">Network</p>
          <div className="mt-3">
            <div className="row-line">
              <span className="row-key">Network</span>
              <span className="row-val">GenLayer Studionet</span>
            </div>
            <div className="row-line">
              <span className="row-key">Chain ID</span>
              <span className="row-val">{CHAIN_ID}</span>
            </div>
            <div className="row-line">
              <span className="row-key">RPC</span>
              <span className="row-val mono text-[13px]">{RPC_URL.replace("https://", "")}</span>
            </div>
            <div className="row-line">
              <span className="row-key">Explorer</span>
              <a className="row-val text-[var(--mint-deep)] underline underline-offset-4" href={EXPLORER_URL} target="_blank" rel="noreferrer">
                explorer-studio.genlayer.com
              </a>
            </div>
            <div className="row-line">
              <span className="row-key">Contract</span>
              {CONTRACT_ADDRESS ? (
                <span className="row-val inline-flex items-center gap-2">
                  <a className="mono text-[13px] text-[var(--mint-deep)] underline underline-offset-4" href={contractExplorer()} target="_blank" rel="noreferrer">
                    {shortAddress(CONTRACT_ADDRESS)}
                  </a>
                  <button
                    aria-label="Copy contract address"
                    className="text-[var(--muted-fg)] hover:text-[var(--ink)]"
                    onClick={() => {
                      navigator.clipboard.writeText(CONTRACT_ADDRESS).catch(() => undefined);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {copied && <span className="mono text-[10px] uppercase text-[var(--mint-deep)]">copied</span>}
                </span>
              ) : (
                <span className="row-val text-[var(--muted-fg)]">not configured</span>
              )}
            </div>
            {stats?.version && (
              <div className="row-line">
                <span className="row-key">Version</span>
                <span className="row-val">{stats.version}</span>
              </div>
            )}
          </div>
        </div>

        <div className="card card-pad">
          <p className="eyebrow">Live accounting</p>
          {configured ? (
            <LoadState loading={loading} error={error}>
              <div className="mt-3">
                {accounting.map((row) => (
                  <div key={row.label} className="row-line">
                    <span className="row-key">{row.label}</span>
                    <span className="row-val">{row.value}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-[var(--muted-fg)]">
                Every deposited GEN is always accounted for as exactly one of: warranty escrow, evidence escrow,
                payout reserve, claimable credit, or withdrawn value.
              </p>
            </LoadState>
          ) : (
            <div className="mt-4">
              <ConfigNotice />
            </div>
          )}
        </div>
      </section>

      {/* pillars */}
      <section className="mt-20">
        <span className="eyebrow">Design</span>
        <h2 className="display mt-4 text-4xl">How settlement stays honest</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {PILLARS.map((pillar) => (
            <div key={pillar.title} className="card card-pad card-hover corner-marks">
              <pillar.icon className="h-5 w-5 text-[var(--mint-deep)]" />
              <h3 className="display mt-4 text-lg">{pillar.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">{pillar.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* source families */}
      <section className="mt-20">
        <span className="eyebrow">Corroboration</span>
        <h2 className="display mt-4 text-4xl">Six source families</h2>
        <p className="lead mt-4">
          A breach never rests on a single voice. Every incident requires verified evidence from multiple distinct
          families before adjudication unlocks.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { name: "Vendor", text: "First-party advisories and security bulletins from the publisher." },
            { name: "GitHub Advisory", text: "Curated GHSA records with affected version ranges." },
            { name: "NVD", text: "National Vulnerability Database CVE publications." },
            { name: "CISA", text: "CISA alerts and Known Exploited Vulnerabilities entries." },
            { name: "Package Registry", text: "Registry security reports attached to the package itself." },
            { name: "Security Research", text: "Independent researcher write-ups with verifiable detail." },
          ].map((family, index) => (
            <div key={family.name} className="card card-pad">
              <div className="flex items-center justify-between">
                <Layers className="h-4 w-4 text-[var(--mint-deep)]" />
                <span className="mono text-[10px] tracking-[0.2em] text-[var(--muted-fg)]">0{index + 1}</span>
              </div>
              <h3 className="display mt-3 text-lg">{family.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-fg)]">{family.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* settlement rules */}
      <section className="band-dark mt-20">
        <div className="container-x grid gap-8 py-14 lg:grid-cols-3">
          {[
            {
              icon: Gavel,
              title: "Verdicts",
              text: "BREACHED finalizes only when consistent verified evidence establishes every warranty condition. INCONCLUSIVE keeps the incident open; expiry is never a semantic verdict.",
            },
            {
              icon: Lock,
              title: "Escrows",
              text: "Publisher bonds back coverage; evidence bonds back honest submissions. Unrevealed commitments are slashed to the publisher; unreachable sources refund the submitter.",
            },
            {
              icon: Landmark,
              title: "Payouts",
              text: "Coverage claims draw from a deterministic reserve capped by the bond. All balances move through pull payments — the contract never pushes funds uninvited.",
            },
          ].map((item) => (
            <div key={item.title}>
              <item.icon className="h-5 w-5 text-[var(--mint)]" />
              <h3 className="display mt-4 text-xl text-[#f8fcf9]">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[rgba(248,252,249,0.6)]">{item.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

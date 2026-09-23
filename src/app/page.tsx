"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  FileSearch,
  Gavel,
  Landmark,
  Package,
  Radar,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Mark } from "@/components/Mark";
import { StatusPill } from "@/components/StatusPill";
import { WarrantyCard } from "@/components/WarrantyCard";
import { LoadState } from "@/components/LoadState";
import { SentinelPact } from "@/lib/genlayer/sentinelpact";
import { contractExplorer } from "@/lib/genlayer/client";
import { genFromAtto } from "@/lib/format";
import type { ProtocolStats, WarrantyRecord } from "@/lib/types";

const STEPS = [
  {
    icon: Package,
    title: "Register a release",
    text: "A publisher pins an exact package version with its digest, then escrows a native GEN bond behind frozen warranty terms.",
  },
  {
    icon: Users,
    title: "Sell coverage",
    text: "Coverage buyers pay a premium for protection up to the bonded amount. Premiums credit the publisher instantly.",
  },
  {
    icon: FileSearch,
    title: "Prove the incident",
    text: "Community members commit and reveal public vulnerability evidence. Validator consensus examines every live source independently.",
  },
  {
    icon: Gavel,
    title: "Settle on-chain",
    text: "A finalized BREACHED verdict converts the bond into a deterministic payout reserve. Holders claim, then withdraw.",
  },
];

const NODE_POSITIONS = [
  { top: "2%", left: "44%", delay: "0s", icon: ShieldCheck, tag: "Vendor" },
  { top: "22%", left: "82%", delay: "-1.2s", icon: Radar, tag: "Advisory" },
  { top: "64%", left: "88%", delay: "-2.4s", icon: BadgeCheck, tag: "NVD" },
  { top: "86%", left: "46%", delay: "-3.1s", icon: Landmark, tag: "CISA" },
  { top: "62%", left: "2%", delay: "-4.2s", icon: Package, tag: "Registry" },
  { top: "18%", left: "6%", delay: "-5s", icon: FileSearch, tag: "Research" },
];

function NodeField() {
  return (
    <div className="node-field" aria-hidden="true">
      <svg className="arc-ring" viewBox="0 0 460 460" fill="none">
        <circle cx="230" cy="230" r="216" stroke="rgba(8,127,113,0.45)" strokeWidth="1.5" strokeDasharray="3 9" />
      </svg>
      <svg className="arc-ring arc-ring-rev" viewBox="0 0 460 460" fill="none" style={{ inset: "9%" }}>
        <circle cx="230" cy="230" r="196" stroke="rgba(53,213,180,0.7)" strokeWidth="1.5" strokeDasharray="42 26" />
      </svg>
      <svg className="arc-ring" viewBox="0 0 460 460" fill="none" style={{ inset: "20%", animationDuration: "38s" }}>
        <circle cx="230" cy="230" r="168" stroke="rgba(11,18,16,0.28)" strokeWidth="1.5" strokeDasharray="2 12" />
      </svg>
      <div className="node-core">
        <Mark size={44} />
      </div>
      {NODE_POSITIONS.map((node) => (
        <div
          key={node.tag}
          className="node-dot"
          style={{ top: node.top, left: node.left, animationDelay: node.delay }}
        >
          <node.icon className="h-5 w-5" />
          <span className="node-tag">{node.tag}</span>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [warranties, setWarranties] = useState<WarrantyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!SentinelPact.configured()) {
      setLoading(false);
      return;
    }
    Promise.all([SentinelPact.stats(), SentinelPact.listWarranties()])
      .then(([s, w]) => {
        if (!alive) return;
        setStats(s);
        setWarranties(w.slice(0, 6));
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to read protocol state."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const statItems = [
    { label: "Active warranties", value: stats?.warranties ?? "—" },
    { label: "Bond escrowed", value: stats ? `${genFromAtto(stats.warranty_escrow_atto)} GEN` : "—" },
    { label: "Coverage sold", value: stats ? `${genFromAtto(stats.payout_reserve_atto || "0")} GEN` : "—" },
    { label: "Incidents resolved", value: stats?.incidents ?? "—" },
  ];

  return (
    <div>
      {/* ------------------------------ hero ------------------------------ */}
      <section className="grid-bg grid-bg-far relative overflow-hidden">
        <div className="container-x grid items-center gap-14 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24">
          <div>
            <span className="eyebrow enter">GenLayer Studionet · Chain 61999</span>
            <h1 className="display enter enter-1 mt-6 text-[clamp(44px,7.2vw,88px)]">
              Warranties with the bond on the&nbsp;line.
            </h1>
            <p className="lead enter enter-2 mt-6">
              SentinelPact escrows native GEN behind frozen release-warranty terms, sells coverage before an incident,
              and settles public vulnerability evidence through two-stage decentralized consensus. Payouts are
              deterministic — never discretionary.
            </p>
            <div className="enter enter-3 mt-8 flex flex-wrap items-center gap-4">
              <Link href="/warranties" className="btn btn-primary">
                Browse warranties <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/open" className="btn btn-ghost">
                Open a warranty
              </Link>
            </div>
            <div className="enter enter-4 mono mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] uppercase tracking-[0.18em] text-[var(--muted-fg)]">
              <span className="inline-flex items-center gap-2">
                <span className="pulse-dot" /> Live network
              </span>
              <span>Two-stage consensus</span>
              <span>No admin keys</span>
            </div>
          </div>
          <div className="enter enter-2">
            <NodeField />
          </div>
        </div>

        <div className="marquee">
          <div className="marquee-track" aria-hidden="true">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex flex-none items-center gap-12">
                {[
                  "Studionet 61999",
                  "Escrowed bonds",
                  "Commit / reveal evidence",
                  "Independent validator replay",
                  "Deterministic payout reserves",
                  "Pull-payment withdrawals",
                ].map((item) => (
                  <span key={item} className="flex items-center gap-12">
                    <span>{item}</span>
                    <span className="text-[var(--mint-deep)]">///</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------ stats ------------------------------ */}
      <section className="container-x grid gap-px border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-4">
        {statItems.map((item, index) => (
          <div key={item.label} className={`card enter enter-${Math.min(index + 1, 4)} p-6`}>
            <p className="stat-num">{item.value}</p>
            <p className="stat-label">{item.label}</p>
          </div>
        ))}
      </section>

      {/* ------------------------------ how it works ------------------------------ */}
      <section className="container-x mt-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="eyebrow">Protocol flow</span>
            <h2 className="display mt-4 text-4xl sm:text-5xl">How the pact holds</h2>
          </div>
          <a
            href={contractExplorer()}
            target="_blank"
            rel="noreferrer"
            className="mono inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-[var(--mint-deep)] underline underline-offset-4"
          >
            View contract <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <div key={step.title} className={`card card-pad card-hover corner-marks enter enter-${index + 1}`}>
              <div className="flex items-center justify-between">
                <step.icon className="h-5 w-5 text-[var(--mint-deep)]" />
                <span className="mono text-[10px] tracking-[0.2em] text-[var(--muted-fg)]">0{index + 1}</span>
              </div>
              <h3 className="display mt-5 text-lg">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------ live warranties ------------------------------ */}
      <section className="container-x mt-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="eyebrow">Coverage market</span>
            <h2 className="display mt-4 text-4xl sm:text-5xl">Open warranties</h2>
          </div>
          <Link
            href="/warranties"
            className="mono inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-[var(--mint-deep)] underline underline-offset-4"
          >
            All warranties <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="mt-10">
          <LoadState loading={loading} error={error} empty={!loading && !warranties.length ? "No warranties on the books yet." : null}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {warranties.map((warranty, index) => (
                <WarrantyCard key={warranty.warranty_id} warranty={warranty} index={index} />
              ))}
            </div>
          </LoadState>
        </div>
      </section>

      {/* ------------------------------ CTA band ------------------------------ */}
      <section className="band-dark mt-24">
        <div className="container-x grid items-center gap-10 py-16 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-center gap-3">
              <StatusPill status="OPEN" label="Live on Studionet" />
            </div>
            <h2 className="display mt-5 max-w-xl text-4xl text-[#f8fcf9] sm:text-5xl">
              Put your release under a real bond.
            </h2>
            <p className="lead mt-4">
              Connect a browser wallet on chain 61999, register your exact release, and let consensus — not promises —
              arbitrate the outcome.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/open" className="btn btn-accent">
              Open a warranty <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/protocol" className="btn btn-ghost !text-[#f8fcf9]" style={{ borderColor: "rgba(248,252,249,0.3)" }}>
              Read the protocol
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

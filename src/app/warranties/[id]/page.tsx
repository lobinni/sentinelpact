"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Landmark, RefreshCw, ShieldAlert, ShieldCheck, Timer } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { StatusPill } from "@/components/StatusPill";
import { LoadState } from "@/components/LoadState";
import { TxRail } from "@/components/TxRail";
import { ConfigNotice } from "@/components/ConfigNotice";
import { SentinelPact } from "@/lib/genlayer/sentinelpact";
import { useWallet } from "@/lib/genlayer/wallet";
import { formatDate, formatDateTime, genFromAtto, shortAddress, toAtto } from "@/lib/format";
import type { IncidentRecord, ReleaseRecord, TxState, WarrantyRecord } from "@/lib/types";

const IDLE: TxState = { stage: "idle" };

export default function WarrantyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const wallet = useWallet();
  const configured = SentinelPact.configured();

  const [warranty, setWarranty] = useState<WarrantyRecord | null>(null);
  const [release, setRelease] = useState<ReleaseRecord | null>(null);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [myCoverage, setMyCoverage] = useState("0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [coverageAmount, setCoverageAmount] = useState("");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentHint, setIncidentHint] = useState("");
  const [tx, setTx] = useState<TxState>(IDLE);

  const reload = useCallback(async () => {
    const w = await SentinelPact.warranty(id);
    setWarranty(w);
    const [r, i] = await Promise.all([
      SentinelPact.release(w.release_id).catch(() => null),
      SentinelPact.incidents(id).catch(() => [] as IncidentRecord[]),
    ]);
    if (r) setRelease(r);
    setIncidents([...i].reverse());
  }, [id]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let alive = true;
    reload()
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to load warranty."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reload, configured]);

  useEffect(() => {
    if (!wallet.address || !warranty) return;
    SentinelPact.coverage(id, wallet.address)
      .then((c) => setMyCoverage(String(c.coverage_atto || "0")))
      .catch(() => undefined);
  }, [wallet.address, warranty, id, tx.stage]);

  const premium = useMemo(() => {
    if (!warranty || !coverageAmount) return 0n;
    try {
      const cov = toAtto(coverageAmount);
      const bps = BigInt(warranty.premium_bps || "0");
      return (cov * bps + 9999n) / 10000n;
    } catch {
      return 0n;
    }
  }, [coverageAmount, warranty]);

  const ready = wallet.connected && wallet.correctNetwork && wallet.address;

  const runWrite = (name: string, args: any[], value = 0n) => {
    if (!ready || !wallet.address) return;
    setTx({ stage: "signing", message: "Preparing transaction…" });
    SentinelPact.write(wallet.address, name, args, value, setTx)
      .then(() => reload().catch(() => undefined))
      .catch(() => undefined);
  };

  if (!configured) {
    return (
      <div className="container-x pt-14">
        <ConfigNotice />
      </div>
    );
  }

  const isOpen = warranty?.status === "OPEN";
  const isBreached = warranty?.status === "BREACHED";
  const noCoverage = warranty ? warranty.total_coverage_atto === "0" : false;
  const noActiveIncident = warranty ? warranty.active_incident_id === "" : false;
  const ended = warranty ? Date.now() / 1000 > Number(warranty.ends_at) : false;
  const closePassed = warranty ? Date.now() / 1000 > Number(warranty.coverage_closes_at) : false;
  const isPublisher =
    warranty && wallet.address ? warranty.publisher.toLowerCase() === wallet.address.toLowerCase() : false;

  return (
    <div className="container-x pt-14">
      <LoadState loading={loading} error={error} empty={!loading && !warranty ? "Warranty not found." : null}>
        {warranty && (
          <>
            <PageHead
              eyebrow={`Warranty ${warranty.warranty_id}`}
              title={warranty.title}
              lead={`${release ? `${release.package_name} ${release.version} · ` : ""}publisher ${shortAddress(
                warranty.publisher
              )}`}
              aside={<StatusPill status={warranty.status} />}
            />

            <div className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              {/* ---------- terms ---------- */}
              <div className="space-y-4">
                <div className="card card-pad">
                  <p className="eyebrow">Escrow</p>
                  <div className="mt-4 grid grid-cols-2 gap-px border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">
                    {[
                      { label: "Bond", value: `${genFromAtto(warranty.bond_atto)} GEN` },
                      { label: "Covered", value: `${genFromAtto(warranty.total_coverage_atto)} GEN` },
                      { label: "Premium", value: `${(Number(warranty.premium_bps) / 100).toFixed(2)}%` },
                      { label: "Reserve", value: `${genFromAtto(warranty.payout_reserve_atto || "0")} GEN` },
                    ].map((cell) => (
                      <div key={cell.label} className="bg-[var(--bg-elev)] p-4">
                        <p className="stat-label mt-0">{cell.label}</p>
                        <p className="mono mt-1 text-sm font-medium">{cell.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5">
                    <div className="row-line">
                      <span className="row-key">Coverage closes</span>
                      <span className="row-val">{formatDateTime(warranty.coverage_closes_at)}</span>
                    </div>
                    <div className="row-line">
                      <span className="row-key">Warranty ends</span>
                      <span className="row-val">{formatDate(warranty.ends_at)}</span>
                    </div>
                    <div className="row-line">
                      <span className="row-key">Incident window</span>
                      <span className="row-val">{Math.round(Number(warranty.incident_window_seconds) / 3600)}h</span>
                    </div>
                    <div className="row-line">
                      <span className="row-key">Min sources</span>
                      <span className="row-val">
                        {warranty.min_sources} across {warranty.min_source_families} families
                      </span>
                    </div>
                    <div className="row-line">
                      <span className="row-key">Evidence bond</span>
                      <span className="row-val">{genFromAtto(warranty.evidence_bond_atto)} GEN</span>
                    </div>
                  </div>
                </div>

                <div className="card card-pad">
                  <p className="eyebrow">Frozen terms</p>
                  <div className="mt-4 space-y-4 text-sm leading-relaxed">
                    <div>
                      <p className="row-key mb-1">Severity rule</p>
                      <p>{warranty.severity_rule}</p>
                    </div>
                    <div>
                      <p className="row-key mb-1">Vulnerability class</p>
                      <p>{warranty.vulnerability_class}</p>
                    </div>
                    <div>
                      <p className="row-key mb-1">Exclusions</p>
                      <p className="text-[var(--muted-fg)]">{warranty.exclusions}</p>
                    </div>
                  </div>
                </div>

                {/* ---------- incidents ---------- */}
                <div className="card card-pad">
                  <div className="flex items-center justify-between">
                    <p className="eyebrow">Incidents</p>
                    <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-fg)]">
                      {incidents.length} total
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {!incidents.length && (
                      <p className="text-sm text-[var(--muted-fg)]">No incidents opened against this warranty.</p>
                    )}
                    {incidents.map((incident) => (
                      <Link
                        key={incident.incident_id}
                        href={`/incidents/${incident.incident_id}`}
                        className="card card-pad card-hover flex flex-wrap items-center justify-between gap-3"
                      >
                        <div>
                          <p className="font-semibold">{incident.title}</p>
                          <p className="mono mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--muted-fg)]">
                            {incident.incident_id} · {incident.verified_count} verified
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusPill status={incident.status} />
                          <ArrowRight className="h-4 w-4 text-[var(--muted-fg)]" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              {/* ---------- actions ---------- */}
              <div className="space-y-4">
                {!ready && (
                  <div className="card card-pad border-[rgba(147,104,0,0.45)]">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <ShieldAlert className="h-4 w-4 text-[var(--amber)]" /> Wallet required
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--muted-fg)]">
                      Connect an injected wallet on Studionet (chain 61999) to interact with this warranty.
                    </p>
                  </div>
                )}

                {tx.stage !== "idle" && <TxRail state={tx} />}

                {isOpen && !closePassed && (
                  <div className="card card-pad corner-marks">
                    <p className="eyebrow">Buy coverage</p>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">
                      Protection up to the bonded amount. The premium credits the publisher instantly.
                    </p>
                    <label className="label mt-4" htmlFor="cov">Coverage amount (GEN)</label>
                    <input
                      id="cov"
                      className="input mono"
                      placeholder="e.g. 2.5"
                      value={coverageAmount}
                      onChange={(e) => setCoverageAmount(e.target.value)}
                    />
                    <p className="mono mt-3 flex items-center justify-between text-[12px]">
                      <span className="text-[var(--muted-fg)]">Premium due</span>
                      <span className="font-medium">{genFromAtto(premium)} GEN</span>
                    </p>
                    {myCoverage !== "0" && (
                      <p className="mono mt-1 flex items-center justify-between text-[11px]">
                        <span className="text-[var(--muted-fg)]">Your coverage</span>
                        <span>{genFromAtto(myCoverage)} GEN</span>
                      </p>
                    )}
                    <button
                      className="btn btn-primary mt-4 w-full"
                      disabled={!ready || !coverageAmount || premium <= 0n}
                      onClick={() => runWrite("buy_coverage", [id, toAtto(coverageAmount)], premium)}
                    >
                      Buy coverage
                    </button>
                  </div>
                )}

                {isOpen && closePassed && !ended && noActiveIncident && (
                  <div className="card card-pad corner-marks">
                    <p className="eyebrow">Open incident</p>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">
                      Coverage is closed. Anyone can raise an incident and open the evidence window.
                    </p>
                    <label className="label mt-4" htmlFor="it">Incident title</label>
                    <input
                      id="it"
                      className="input"
                      placeholder="Short factual title"
                      value={incidentTitle}
                      onChange={(e) => setIncidentTitle(e.target.value)}
                    />
                    <label className="label mt-4" htmlFor="ih">Advisory hint</label>
                    <input
                      id="ih"
                      className="input"
                      placeholder="e.g. suspected advisory identifier or topic"
                      value={incidentHint}
                      onChange={(e) => setIncidentHint(e.target.value)}
                    />
                    <button
                      className="btn btn-accent mt-4 w-full"
                      disabled={!ready || !incidentTitle.trim() || !incidentHint.trim()}
                      onClick={() => runWrite("open_incident", [id, incidentTitle.trim(), incidentHint.trim()])}
                    >
                      Open incident
                    </button>
                  </div>
                )}

                {isBreached && myCoverage !== "0" && (
                  <div className="card card-pad corner-marks">
                    <p className="eyebrow">Claim payout</p>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">
                      This warranty settled as breached. Convert your {genFromAtto(myCoverage)} GEN of coverage into
                      withdrawable credit.
                    </p>
                    <button
                      className="btn btn-accent mt-4 w-full"
                      disabled={!ready}
                      onClick={() => runWrite("claim_breach_payout", [id, wallet.address])}
                    >
                      Claim breach payout
                    </button>
                  </div>
                )}

                <div className="card card-pad">
                  <p className="eyebrow">Lifecycle</p>
                  <div className="mt-4 space-y-3">
                    {isOpen && ended && noActiveIncident && (
                      <button
                        className="btn btn-ghost w-full"
                        disabled={!ready}
                        onClick={() => runWrite("expire_warranty", [id])}
                      >
                        <Timer className="h-4 w-4" /> Expire warranty
                      </button>
                    )}
                    {isOpen && isPublisher && noCoverage && noActiveIncident && (
                      <button
                        className="btn btn-ghost w-full"
                        disabled={!ready}
                        onClick={() => runWrite("cancel_warranty", [id])}
                      >
                        <Landmark className="h-4 w-4" /> Cancel warranty
                      </button>
                    )}
                    {isOpen && !ended && (
                      <p className="flex items-center gap-2 text-sm text-[var(--muted-fg)]">
                        <ShieldCheck className="h-4 w-4 text-[var(--mint-deep)]" />
                        {closePassed ? "Disclosure window live — monitoring for incidents." : "Coverage market open."}
                      </p>
                    )}
                    {!isOpen && (
                      <p className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted-fg)]">
                        Closed {formatDate(warranty.closed_at)}
                      </p>
                    )}
                    <button
                      className="btn btn-ghost btn-sm w-full"
                      onClick={() => reload().catch(() => undefined)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh state
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </LoadState>
    </div>
  );
}

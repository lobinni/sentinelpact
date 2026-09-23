"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Eye, Gavel, KeyRound, RefreshCw, TimerReset } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { StatusPill } from "@/components/StatusPill";
import { LoadState } from "@/components/LoadState";
import { TxRail } from "@/components/TxRail";
import { ConfigNotice } from "@/components/ConfigNotice";
import { familyLabel } from "@/components/EvidenceRows";
import { SentinelPact, SOURCE_FAMILIES } from "@/lib/genlayer/sentinelpact";
import { useWallet } from "@/lib/genlayer/wallet";
import { formatDateTime, genFromAtto, shortAddress } from "@/lib/format";
import type { EvidenceRecord, IncidentRecord, TxState, WarrantyRecord } from "@/lib/types";

const IDLE: TxState = { stage: "idle" };

type RevealDraft = {
  family: string;
  url: string;
  fact: string;
  salt: string;
};

function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const wallet = useWallet();
  const configured = SentinelPact.configured();

  const [incident, setIncident] = useState<IncidentRecord | null>(null);
  const [warranty, setWarranty] = useState<WarrantyRecord | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<TxState>(IDLE);

  // commit form
  const [family, setFamily] = useState<string>(SOURCE_FAMILIES[0]);
  const [url, setUrl] = useState("");
  const [fact, setFact] = useState("");
  const [salt, setSalt] = useState(randomSalt);
  const [commitPreview, setCommitPreview] = useState("");

  // reveal form
  const [revealFor, setRevealFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<RevealDraft>({ family: SOURCE_FAMILIES[0], url: "", fact: "", salt: "" });

  const reload = useCallback(async () => {
    const inc = await SentinelPact.incident(id);
    setIncident(inc);
    const war = await SentinelPact.warranty(inc.warranty_id);
    setWarranty(war);
    const page = await SentinelPact.evidence(id, 0, 25);
    setEvidence([...page.items].reverse());
  }, [id]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let alive = true;
    reload()
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to load incident."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reload, configured]);

  const ready = wallet.connected && wallet.correctNetwork && wallet.address;

  const runWrite = (name: string, args: any[], value = 0n) => {
    if (!ready || !wallet.address) return;
    setTx({ stage: "signing", message: "Preparing transaction…" });
    SentinelPact.write(wallet.address, name, args, value, setTx)
      .then(() => reload().catch(() => undefined))
      .catch(() => undefined);
  };

  // Persist the commit payload locally so the reveal step is one click away.
  useEffect(() => {
    if (!ready || !wallet.address || !url.trim() || !fact.trim()) {
      setCommitPreview("");
      return;
    }
    let alive = true;
    SentinelPact.commitment(id, wallet.address, family, url.trim(), fact.trim(), salt)
      .then((hash) => alive && setCommitPreview(hash))
      .catch(() => alive && setCommitPreview(""));
    return () => {
      alive = false;
    };
  }, [id, wallet.address, ready, family, url, fact, salt]);

  const commit = () => {
    if (!wallet.address || !commitPreview || !warranty) return;
    const bond = BigInt(warranty.evidence_bond_atto || "0");
    localStorage.setItem(
      `sentinelpact.reveal.${id}.${commitPreview.slice(0, 18)}`,
      JSON.stringify({ family, url: url.trim(), fact: fact.trim(), salt })
    );
    runWrite("commit_evidence", [id, commitPreview], bond);
  };

  const openReveal = (item: EvidenceRecord) => {
    setRevealFor(item.evidence_id);
    let local: RevealDraft | null = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || "";
        if (key.startsWith(`sentinelpact.reveal.${id}.`)) {
          local = JSON.parse(localStorage.getItem(key) || "null");
          if (local) break;
        }
      }
    } catch {
      local = null;
    }
    setDraft(local || { family: SOURCE_FAMILIES[0], url: "", fact: "", salt: randomSalt() });
  };

  const now = Date.now() / 1000;
  const windowOpen = incident ? incident.status === "OPEN" && now < Number(incident.evidence_deadline) : false;
  const windowClosed = incident ? incident.status === "OPEN" && now >= Number(incident.evidence_deadline) : false;
  const canAdjudicate = useMemo(() => {
    if (!incident || !warranty || incident.status !== "OPEN") return false;
    return (
      Number(incident.verified_count) >= Number(warranty.min_sources) &&
      Number(incident.verified_family_count) >= Number(warranty.min_source_families)
    );
  }, [incident, warranty]);

  if (!configured) {
    return (
      <div className="container-x pt-14">
        <ConfigNotice />
      </div>
    );
  }

  return (
    <div className="container-x pt-14">
      <LoadState loading={loading} error={error} empty={!loading && !incident ? "Incident not found." : null}>
        {incident && (
          <>
            <PageHead
              eyebrow={`Incident ${incident.incident_id}`}
              title={incident.title}
              lead={
                warranty
                  ? `Against “${warranty.title}” — ${incident.verified_count} of at least ${warranty.min_sources} sources verified across ${incident.verified_family_count} of ${warranty.min_source_families} families.`
                  : undefined
              }
              aside={
                <div className="flex gap-2">
                  {incident.last_verdict && <StatusPill status={incident.last_verdict} label={incident.last_verdict.replace("_", " ")} />}
                  <StatusPill status={incident.status} label={incident.status.replace("_", " ")} />
                </div>
              }
            />

            <div className="mt-10 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              {/* ---------- left: meta + actions ---------- */}
              <div className="space-y-4">
                <div className="card card-pad">
                  <p className="eyebrow">Timeline</p>
                  <div className="mt-3">
                    <div className="row-line">
                      <span className="row-key">Opened</span>
                      <span className="row-val">{formatDateTime(incident.opened_at)}</span>
                    </div>
                    <div className="row-line">
                      <span className="row-key">Evidence deadline</span>
                      <span className="row-val">{formatDateTime(incident.evidence_deadline)}</span>
                    </div>
                    <div className="row-line">
                      <span className="row-key">Capacity used</span>
                      <span className="row-val">
                        {incident.evidence_capacity_used}/{incident.evidence_capacity_limit}
                      </span>
                    </div>
                    <div className="row-line">
                      <span className="row-key">Adjudication rounds</span>
                      <span className="row-val">{incident.adjudication_rounds}</span>
                    </div>
                    {incident.resolved_at && incident.resolved_at !== "0" && (
                      <div className="row-line">
                        <span className="row-key">Resolved</span>
                        <span className="row-val">{formatDateTime(incident.resolved_at)}</span>
                      </div>
                    )}
                    {warranty && (
                      <div className="row-line">
                        <span className="row-key">Warranty</span>
                        <Link href={`/warranties/${warranty.warranty_id}`} className="row-val text-[var(--mint-deep)] underline underline-offset-4">
                          {warranty.warranty_id}
                        </Link>
                      </div>
                    )}
                  </div>
                  {incident.last_basis && (
                    <p className="mt-3 border-l-2 border-[var(--mint)] pl-3 text-[13px] leading-relaxed text-[var(--muted-fg)]">
                      {incident.last_basis}
                    </p>
                  )}
                </div>

                {tx.stage !== "idle" && <TxRail state={tx} />}

                <div className="card card-pad">
                  <p className="eyebrow">Actions</p>
                  <div className="mt-4 space-y-3">
                    {canAdjudicate && (
                      <button
                        className="btn btn-accent w-full"
                        disabled={!ready}
                        onClick={() => runWrite("adjudicate_incident", [id])}
                      >
                        <Gavel className="h-4 w-4" /> Adjudicate incident
                      </button>
                    )}
                    {windowClosed && (
                      <button
                        className="btn btn-ghost w-full"
                        disabled={!ready}
                        onClick={() => runWrite("expire_incident", [id])}
                      >
                        <TimerReset className="h-4 w-4" /> Expire evidence window
                      </button>
                    )}
                    {!canAdjudicate && !windowClosed && (
                      <p className="text-sm text-[var(--muted-fg)]">
                        {incident.status === "OPEN"
                          ? "Adjudication unlocks once the verified-evidence thresholds are met."
                          : "This incident is closed."}
                      </p>
                    )}
                    <button className="btn btn-ghost btn-sm w-full" onClick={() => reload().catch(() => undefined)}>
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh state
                    </button>
                  </div>
                </div>

                {windowOpen && warranty && (
                  <div className="card card-pad corner-marks">
                    <p className="eyebrow">Commit evidence</p>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">
                      Lock a {genFromAtto(warranty.evidence_bond_atto)} GEN bond behind a salted commitment, then
                      reveal within 15 minutes. Verified evidence returns the bond.
                    </p>
                    <label className="label mt-4" htmlFor="fam">Source family</label>
                    <select id="fam" className="select" value={family} onChange={(e) => setFamily(e.target.value)}>
                      {SOURCE_FAMILIES.map((f) => (
                        <option key={f} value={f}>
                          {familyLabel(f)}
                        </option>
                      ))}
                    </select>
                    <label className="label mt-4" htmlFor="url">Source URL</label>
                    <input
                      id="url"
                      className="input mono"
                      placeholder="https://…"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <label className="label mt-4" htmlFor="fact">Claimed fact</label>
                    <textarea
                      id="fact"
                      className="textarea"
                      placeholder="What the source establishes, in plain language"
                      value={fact}
                      onChange={(e) => setFact(e.target.value)}
                    />
                    <div className="mono mt-3 flex items-center justify-between text-[11px]">
                      <span className="text-[var(--muted-fg)]">Salt</span>
                      <button className="text-[var(--mint-deep)] underline underline-offset-4" onClick={() => setSalt(randomSalt())}>
                        regenerate
                      </button>
                    </div>
                    <p className="mono mt-1 break-all text-[11px] text-[var(--muted-fg)]">{salt}</p>
                    <p className="field-hint">
                      Keep this salt — it is required to reveal. It is also stored in this browser automatically.
                    </p>
                    <button
                      className="btn btn-primary mt-4 w-full"
                      disabled={!ready || !commitPreview}
                      onClick={commit}
                    >
                      <KeyRound className="h-4 w-4" /> Commit evidence
                    </button>
                  </div>
                )}
              </div>

              {/* ---------- right: evidence feed ---------- */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="eyebrow">Evidence feed</p>
                  <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-fg)]">
                    {evidence.length} submissions
                  </span>
                </div>
                {!evidence.length && (
                  <div className="card card-pad text-sm text-[var(--muted-fg)]">
                    Nothing committed yet. The first verified sources set the adjudication record.
                  </div>
                )}
                <div className="space-y-3">
                  {evidence.map((item) => {
                    const ownItem = wallet.address && item.submitter.toLowerCase() === wallet.address.toLowerCase();
                    const revealDue = now >= Number(item.reveal_deadline);
                    return (
                      <article key={item.evidence_id} className="card card-pad">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill status={item.status} />
                            <span className="pill pill-quiet">
                              <span>{familyLabel(item.source_family)}</span>
                            </span>
                          </div>
                          <span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-fg)]">
                            {item.evidence_id}
                          </span>
                        </div>
                        {item.claimed_fact ? (
                          <p className="mt-3 text-sm leading-relaxed">{item.claimed_fact}</p>
                        ) : (
                          <p className="mono mt-3 text-[11px] uppercase tracking-[0.14em] text-[var(--muted-fg)]">
                            Committed · reveal by {formatDateTime(item.reveal_deadline)}
                          </p>
                        )}
                        {item.basis && (
                          <p className="mt-3 border-l-2 border-[var(--mint)] pl-3 text-[13px] leading-relaxed text-[var(--muted-fg)]">
                            {item.basis}
                          </p>
                        )}
                        <div className="mono mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] uppercase tracking-[0.14em] text-[var(--muted-fg)]">
                          <span>by {shortAddress(item.submitter)}</span>
                          {item.advisory_id && <span>{item.advisory_id}</span>}
                          {item.affected_range && <span>{item.affected_range}</span>}
                        </div>

                        {/* per-item contextual actions */}
                        <div className="mt-4 flex flex-wrap gap-2">
                          {item.status === "COMMITTED" && !revealDue && ownItem && (
                            <button className="btn btn-ghost btn-sm" onClick={() => openReveal(item)}>
                              <Eye className="h-3.5 w-3.5" /> Reveal
                            </button>
                          )}
                          {item.status === "COMMITTED" && revealDue && (
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={!ready}
                              onClick={() => runWrite("expire_unrevealed_evidence", [item.evidence_id])}
                            >
                              Slash unrevealed
                            </button>
                          )}
                          {item.status === "SOURCE_UNAVAILABLE" && windowOpen && (
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={!ready}
                              onClick={() => runWrite("retry_evidence", [item.evidence_id])}
                            >
                              Retry examination
                            </button>
                          )}
                          {item.source_url && (
                            <a className="btn btn-ghost btn-sm" href={item.source_url} target="_blank" rel="noreferrer">
                              Source <ArrowRight className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>

                        {revealFor === item.evidence_id && (
                          <div className="mt-4 border-t border-[var(--line)] pt-4">
                            <p className="eyebrow">Reveal payload</p>
                            <label className="label mt-3">Source family</label>
                            <select
                              className="select"
                              value={draft.family}
                              onChange={(e) => setDraft({ ...draft, family: e.target.value })}
                            >
                              {SOURCE_FAMILIES.map((f) => (
                                <option key={f} value={f}>
                                  {familyLabel(f)}
                                </option>
                              ))}
                            </select>
                            <label className="label mt-3">Source URL</label>
                            <input
                              className="input mono"
                              value={draft.url}
                              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                            />
                            <label className="label mt-3">Claimed fact</label>
                            <textarea
                              className="textarea"
                              value={draft.fact}
                              onChange={(e) => setDraft({ ...draft, fact: e.target.value })}
                            />
                            <label className="label mt-3">Salt</label>
                            <input
                              className="input mono"
                              value={draft.salt}
                              onChange={(e) => setDraft({ ...draft, salt: e.target.value })}
                            />
                            <div className="mt-4 flex gap-2">
                              <button
                                className="btn btn-primary flex-1"
                                disabled={!ready || !draft.url.trim() || !draft.fact.trim() || !draft.salt.trim()}
                                onClick={() => {
                                  runWrite("reveal_evidence", [
                                    item.evidence_id,
                                    draft.family,
                                    draft.url.trim(),
                                    draft.fact.trim(),
                                    draft.salt.trim(),
                                  ]);
                                  setRevealFor(null);
                                }}
                              >
                                Reveal evidence
                              </button>
                              <button className="btn btn-ghost" onClick={() => setRevealFor(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </LoadState>
    </div>
  );
}

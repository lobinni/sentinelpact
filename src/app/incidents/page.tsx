"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { StatusPill } from "@/components/StatusPill";
import { LoadState } from "@/components/LoadState";
import { ConfigNotice } from "@/components/ConfigNotice";
import { SentinelPact } from "@/lib/genlayer/sentinelpact";
import { formatDateTime } from "@/lib/format";
import type { IncidentRecord, WarrantyRecord } from "@/lib/types";

const FILTERS = ["ALL", "OPEN", "BREACHED", "NOT_AFFECTED", "EXPIRED"] as const;

export default function IncidentsPage() {
  const [grouped, setGrouped] = useState<{ warranty: WarrantyRecord; incidents: IncidentRecord[] }[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const configured = SentinelPact.configured();

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let alive = true;
    SentinelPact.listWarranties()
      .then(async (warranties) => {
        const rows = await Promise.all(
          warranties.map(async (warranty) => ({
            warranty,
            incidents: await SentinelPact.incidents(warranty.warranty_id).catch(() => [] as IncidentRecord[]),
          }))
        );
        if (alive) setGrouped(rows.filter((row) => row.incidents.length > 0));
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to load incidents."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [configured]);

  const all = useMemo(() => grouped.flatMap((row) => row.incidents), [grouped]);
  const visible = useMemo(() => {
    const rows = filter === "ALL" ? grouped : grouped.map((g) => ({ ...g, incidents: g.incidents.filter((i) => i.status === filter) }));
    return rows.filter((row) => row.incidents.length > 0);
  }, [grouped, filter]);

  return (
    <div className="container-x pt-14">
      <PageHead
        eyebrow="Evidence & verdicts"
        title="Incidents"
        lead="Public vulnerability evidence, examined source-by-source and adjudicated by independent validator replay."
        aside={
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button key={item} onClick={() => setFilter(item)} className={`tab ${filter === item ? "tab-active" : ""}`}>
                {item.replace("_", " ")}
                <span className="tab-count">
                  {item === "ALL" ? all.length : all.filter((i) => i.status === item).length}
                </span>
              </button>
            ))}
          </div>
        }
      />

      <div className="mt-12 space-y-8">
        {!configured ? (
          <ConfigNotice />
        ) : (
          <LoadState loading={loading} error={error} empty={!loading && !visible.length ? "No incidents match this filter yet." : null}>
            {visible.map((row) => (
              <section key={row.warranty.warranty_id}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="display text-xl">{row.warranty.title}</h2>
                  <Link
                    href={`/warranties/${row.warranty.warranty_id}`}
                    className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--mint-deep)] underline underline-offset-4"
                  >
                    {row.warranty.warranty_id}
                  </Link>
                </div>
                <div className="space-y-3">
                  {row.incidents.map((incident) => (
                    <Link
                      key={incident.incident_id}
                      href={`/incidents/${incident.incident_id}`}
                      className="card card-pad card-hover flex flex-wrap items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">{incident.title}</p>
                        <p className="mono mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--muted-fg)]">
                          {incident.incident_id} · opened {formatDateTime(incident.opened_at)} ·{" "}
                          {incident.verified_count} verified
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {incident.last_verdict && <StatusPill status={incident.last_verdict} label={incident.last_verdict.replace("_", " ")} />}
                        <StatusPill status={incident.status} label={incident.status.replace("_", " ")} />
                        <ArrowRight className="h-4 w-4 flex-none text-[var(--muted-fg)]" />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </LoadState>
        )}
      </div>
    </div>
  );
}

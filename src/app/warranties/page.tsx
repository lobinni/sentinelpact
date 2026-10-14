"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/PageHead";
import { WarrantyCard } from "@/components/WarrantyCard";
import { LoadState } from "@/components/LoadState";
import { ConfigNotice } from "@/components/ConfigNotice";
import { SentinelPact } from "@/lib/genlayer/sentinelpact";
import type { WarrantyRecord } from "@/lib/types";

const FILTERS = ["ALL", "OPEN", "BREACHED", "EXPIRED", "CANCELED"] as const;

export default function WarrantiesPage() {
  const [warranties, setWarranties] = useState<WarrantyRecord[]>([]);
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
      .then((items) => alive && setWarranties([...items].reverse()))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to load warranties."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [configured]);

  const visible = useMemo(
    () => (filter === "ALL" ? warranties : warranties.filter((item) => item.status === filter)),
    [warranties, filter]
  );

  return (
    <div className="container-x pt-14">
      <PageHead
        eyebrow="Coverage market"
        title="Warranties"
        lead="Frozen terms, escrowed bonds, and live coverage capacity — every warranty settles exactly as written."
        aside={
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`tab ${filter === item ? "tab-active" : ""}`}
              >
                {item}
                <span className="tab-count">
                  {item === "ALL" ? warranties.length : warranties.filter((w) => w.status === item).length}
                </span>
              </button>
            ))}
          </div>
        }
      />

      <div className="mt-12">
        {!configured ? (
          <ConfigNotice />
        ) : (
          <LoadState loading={loading} error={error} empty={!loading && !visible.length ? "No warranties match this filter yet." : null}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((warranty, index) => (
                <WarrantyCard key={warranty.warranty_id} warranty={warranty} index={index} />
              ))}
            </div>
          </LoadState>
        )}
      </div>
    </div>
  );
}

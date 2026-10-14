import Link from "next/link";
import { ArrowUpRight, Package, ShieldCheck, Timer } from "lucide-react";
import { StatusPill } from "./StatusPill";
import { formatDate, genFromAtto, shortAddress } from "@/lib/format";
import type { WarrantyRecord } from "@/lib/types";

export function WarrantyCard({ warranty, index = 0 }: { warranty: WarrantyRecord; index?: number }) {
  const bond = genFromAtto(warranty.bond_atto);
  const coverage = genFromAtto(warranty.total_coverage_atto);
  const premium = (Number(warranty.premium_bps) / 100).toFixed(2);
  return (
    <Link
      href={`/warranties/${warranty.warranty_id}`}
      className={`card card-hover card-pad corner-marks enter block`}
      style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <StatusPill status={warranty.status} />
        <ArrowUpRight className="h-4 w-4 text-[var(--muted-fg)]" />
      </div>
      <h3 className="display mt-4 text-xl leading-tight">{warranty.title}</h3>
      <p className="mono mt-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-[var(--muted-fg)]">
        <Package className="h-3.5 w-3.5" />
        {warranty.package_name || warranty.release_id} · {warranty.version || ""}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-[var(--line)] pt-4">
        <div>
          <p className="stat-label mt-0">Bond</p>
          <p className="mono mt-1 text-sm font-medium">{bond} GEN</p>
        </div>
        <div>
          <p className="stat-label mt-0">Covered</p>
          <p className="mono mt-1 text-sm font-medium">{coverage} GEN</p>
        </div>
        <div>
          <p className="stat-label mt-0">Premium</p>
          <p className="mono mt-1 text-sm font-medium">{premium}%</p>
        </div>
      </div>
      <div className="mono mt-4 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-[var(--muted-fg)]">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> {shortAddress(warranty.publisher)}
        </span>
        <span className="flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5" /> ends {formatDate(warranty.ends_at)}
        </span>
      </div>
    </Link>
  );
}

import { ExternalLink, FileSearch } from "lucide-react";
import { StatusPill } from "./StatusPill";
import { formatDateTime, shortAddress } from "@/lib/format";
import type { EvidenceRecord } from "@/lib/types";

const FAMILY_LABEL: Record<string, string> = {
  VENDOR: "Vendor",
  GITHUB_ADVISORY: "GitHub Advisory",
  NVD: "NVD",
  CISA: "CISA",
  PACKAGE_REGISTRY: "Package Registry",
  SECURITY_RESEARCH: "Security Research",
};

export function familyLabel(family: string) {
  return FAMILY_LABEL[family] || family || "Undeclared";
}

export function EvidenceRows({ items }: { items: EvidenceRecord[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item) => (
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
              Committed — awaiting reveal
            </p>
          )}

          {item.basis && (
            <p className="mt-3 border-l-2 border-[var(--mint)] pl-3 text-[13px] leading-relaxed text-[var(--muted-fg)]">
              <FileSearch className="mr-1.5 inline h-3.5 w-3.5 text-[var(--mint-deep)]" />
              {item.basis}
            </p>
          )}

          <div className="mono mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] uppercase tracking-[0.14em] text-[var(--muted-fg)]">
            <span>by {shortAddress(item.submitter)}</span>
            {item.examined_at && item.examined_at !== "0" && <span>examined {formatDateTime(item.examined_at)}</span>}
            {item.advisory_id && <span>{item.advisory_id}</span>}
            {item.source_url && (
              <a
                href={item.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[var(--mint-deep)] underline underline-offset-4"
              >
                Source <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

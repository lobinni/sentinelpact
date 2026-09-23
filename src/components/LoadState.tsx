import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

export function LoadState({
  loading,
  error,
  empty,
  children,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: string | null;
  children?: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="card card-pad flex items-center gap-3">
        <Loader2 className="h-4 w-4 spin text-[var(--mint-deep)]" />
        <span className="mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-fg)]">
          Reading finalized state…
        </span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card card-pad flex items-start gap-3 border-[rgba(196,91,62,0.5)]">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-[var(--danger)]" />
        <div>
          <p className="font-semibold">Could not load on-chain data</p>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">{error}</p>
        </div>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="card card-pad flex items-center gap-3">
        <Inbox className="h-4 w-4 text-[var(--muted-fg)]" />
        <span className="text-sm text-[var(--muted-fg)]">{empty}</span>
      </div>
    );
  }
  return <>{children}</>;
}

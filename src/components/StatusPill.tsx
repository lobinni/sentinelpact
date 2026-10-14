import { statusTone } from "@/lib/format";

export function StatusPill({ status, label }: { status?: string; label?: string }) {
  const tone = statusTone(status);
  const cls =
    tone === "live" ? "pill pill-live" : tone === "warn" ? "pill pill-warn" : tone === "danger" ? "pill pill-danger" : "pill pill-quiet";
  return (
    <span className={cls}>
      <span>{label || status || "—"}</span>
    </span>
  );
}

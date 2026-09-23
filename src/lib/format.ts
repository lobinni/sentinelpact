export function shortAddress(value?: string | null) {
  if (!value) return "—";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function genFromAtto(value?: string | bigint | number) {
  try {
    const raw = BigInt(value ?? 0);
    const whole = raw / 10n ** 18n;
    const frac = (raw % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return "0";
  }
}

export function toAtto(value: string) {
  const [wholeRaw, fracRaw = ""] = value.trim().split(".");
  const whole = wholeRaw || "0";
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fracRaw) || fracRaw.length > 18) {
    throw new Error("Use a positive GEN amount with up to 18 decimals.");
  }
  return BigInt(whole) * 10n ** 18n + BigInt((fracRaw + "0".repeat(18)).slice(0, 18));
}

export function formatDate(unix?: string | number) {
  if (!unix || Number(unix) <= 0) return "—";
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(Number(unix) * 1000)
  );
}

export function formatDateTime(unix?: string | number) {
  if (!unix || Number(unix) <= 0) return "—";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(unix) * 1000));
}

export function statusTone(status?: string) {
  const value = (status || "").toUpperCase();
  if (["BREACHED", "INVALID_SOURCE"].includes(value)) return "danger";
  if (["OPEN", "VERIFIED", "FINALIZED"].includes(value)) return "live";
  if (["INCONCLUSIVE", "SOURCE_UNAVAILABLE", "PENDING_SOURCE", "COMMITTED"].includes(value)) return "warn";
  return "quiet";
}

export function asPlain<T = any>(value: any): T {
  if (value instanceof Map) {
    return Object.fromEntries(Array.from(value.entries()).map(([k, v]) => [String(k), asPlain(v)])) as T;
  }
  if (Array.isArray(value)) return value.map(asPlain) as T;
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = asPlain(v);
    return out as T;
  }
  return value as T;
}

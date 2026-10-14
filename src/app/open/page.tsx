"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Dices, FileUp, PackagePlus, ShieldPlus, Wand2 } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { TxRail } from "@/components/TxRail";
import { ConfigNotice } from "@/components/ConfigNotice";
import { SentinelPact } from "@/lib/genlayer/sentinelpact";
import { useWallet } from "@/lib/genlayer/wallet";
import { genFromAtto, toAtto } from "@/lib/format";
import type { ReleaseRecord, TxState } from "@/lib/types";

const IDLE: TxState = { stage: "idle" };

/* ------------------------------ helpers ------------------------------ */

function toUnix(value: string) {
  if (!value) return 0;
  return Math.floor(new Date(value).getTime() / 1000);
}

function localInput(unix: number) {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function randomHex(bytes: number) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tolerates 0x prefixes, uppercase and whitespace; contract wants 64 lowercase hex. */
function normalizeDigest(value: string) {
  return value.trim().toLowerCase().replace(/^0x/, "").replace(/\s+/g, "");
}

/* ------------------------------ templates ------------------------------ */

const RELEASE_PRESETS = [
  { ecosystem: "npm", name: "@acme/beacon-parser", version: "3.7.4", url: "https://github.com/acme/beacon-parser/releases/tag/v3.7.4" },
  { ecosystem: "pypi", name: "orion-utils", version: "1.2.0", url: "https://pypi.org/project/orion-utils/1.2.0/" },
  { ecosystem: "crates", name: "ledger_core", version: "0.9.3", url: "https://crates.io/crates/ledger_core/0.9.3" },
];

const SEVERITY_PRESETS = [
  "CVSS 9.0 or higher (Critical)",
  "CVSS 7.0 or higher (High)",
  "Any vendor-labeled CRITICAL advisory",
];

const CLASS_PRESETS = [
  "remote code execution",
  "SQL injection",
  "cross-site scripting",
  "authentication bypass",
  "supply chain compromise",
  "arbitrary file write",
];

const EXCLUSION_PRESETS = [
  "dev-only usage, unsupported forks, local admin access required",
  "physical access required; social engineering scenarios",
];

type WarrantyPreset = {
  id: string;
  label: string;
  closesMin: number;
  endsMin: number;
  incidentHours: string;
  premiumBps: string;
  minSources: string;
  minFamilies: string;
  evidenceBond: string;
  bond: string;
};

const WARRANTY_PRESETS: WarrantyPreset[] = [
  {
    id: "demo",
    label: "Demo · ~25 min",
    closesMin: 6,
    endsMin: 120,
    incidentHours: "0.5",
    premiumBps: "500",
    minSources: "2",
    minFamilies: "2",
    evidenceBond: "0.001",
    bond: "0.05",
  },
  {
    id: "day",
    label: "Standard · 24 h",
    closesMin: 60,
    endsMin: 1440,
    incidentHours: "2",
    premiumBps: "250",
    minSources: "2",
    minFamilies: "2",
    evidenceBond: "0.005",
    bond: "1",
  },
  {
    id: "week",
    label: "Extended · 7 days",
    closesMin: 1440,
    endsMin: 10080,
    incidentHours: "24",
    premiumBps: "150",
    minSources: "3",
    minFamilies: "2",
    evidenceBond: "0.01",
    bond: "5",
  },
];

function Checklist({ items }: { items: { ok: boolean; label: string }[] }) {
  return (
    <div className="mt-4 space-y-1">
      {items.map((item) => (
        <p key={item.label} className={`check-item ${item.ok ? "check-ok" : "check-no"}`}>
          {item.ok ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
          {item.label}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------ page ------------------------------ */

export default function OpenPage() {
  const wallet = useWallet();
  const configured = SentinelPact.configured();
  const ready = wallet.connected && wallet.correctNetwork && wallet.address;

  const [tx, setTx] = useState<TxState>(IDLE);
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);

  // release form
  const [ecosystem, setEcosystem] = useState("npm");
  const [packageName, setPackageName] = useState("");
  const [version, setVersion] = useState("");
  const [digest, setDigest] = useState("");
  const [metadataUrl, setMetadataUrl] = useState("");
  const [hashing, setHashing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // warranty form
  const [releaseId, setReleaseId] = useState("");
  const [title, setTitle] = useState("");
  const [severityRule, setSeverityRule] = useState("");
  const [vulnClass, setVulnClass] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [premiumBps, setPremiumBps] = useState("500");
  const [coverageCloses, setCoverageCloses] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [incidentHours, setIncidentHours] = useState("0.5");
  const [minSources, setMinSources] = useState("2");
  const [minFamilies, setMinFamilies] = useState("2");
  const [evidenceBond, setEvidenceBond] = useState("0.001");
  const [bond, setBond] = useState("0.05");

  const loadReleases = () => {
    if (!configured) return;
    SentinelPact.listReleases()
      .then((items) => setReleases([...items].reverse()))
      .catch(() => undefined);
  };

  useEffect(() => {
    loadReleases();
  }, [configured]);

  // Only releases published by the connected wallet may be warranted —
  // the contract rejects anyone else ("only release publisher can warrant it").
  const myReleases = useMemo(() => {
    if (!wallet.address) return [];
    return releases.filter((r) => r.publisher.toLowerCase() === wallet.address!.toLowerCase());
  }, [releases, wallet.address]);

  useEffect(() => {
    if (!myReleases.some((r) => r.release_id === releaseId)) {
      setReleaseId(myReleases[0]?.release_id ?? "");
    }
  }, [myReleases, releaseId]);

  // Keep time-sensitive checks fresh while the page sits open.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  const runWrite = (name: string, args: any[], value = 0n) => {
    if (!ready || !wallet.address) return;
    setTx({ stage: "signing", message: "Preparing transaction…" });
    SentinelPact.write(wallet.address, name, args, value, setTx)
      .then(() => loadReleases())
      .catch(() => undefined);
  };

  /* -------- release readiness -------- */
  const digestNorm = normalizeDigest(digest);
  const validDigest = /^[0-9a-f]{64}$/.test(digestNorm);
  const releaseChecks = [
    { ok: !!ready, label: "Wallet connected on Studionet (61999)" },
    { ok: packageName.trim().length > 0, label: "Package name" },
    { ok: version.trim().length > 0, label: "Version" },
    { ok: validDigest, label: `Release digest — 64 hex chars (have ${digestNorm.length})` },
    { ok: metadataUrl.trim().startsWith("https://"), label: "Metadata URL begins with https://" },
  ];
  const releaseReady = releaseChecks.every((c) => c.ok);

  const applyReleasePreset = (preset: (typeof RELEASE_PRESETS)[number]) => {
    setEcosystem(preset.ecosystem);
    setPackageName(preset.name);
    setVersion(preset.version);
    setMetadataUrl(preset.url);
    setDigest(randomHex(32));
  };

  const hashFile = async (file: File) => {
    setHashing(true);
    try {
      const buf = await file.arrayBuffer();
      const digestBuf = await crypto.subtle.digest("SHA-256", buf);
      const hex = Array.from(new Uint8Array(digestBuf), (b) => b.toString(16).padStart(2, "0")).join("");
      setDigest(hex);
    } finally {
      setHashing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* -------- warranty readiness -------- */
  const bondAtto = useMemo(() => {
    try {
      return toAtto(bond || "0");
    } catch {
      return 0n;
    }
  }, [bond]);

  const evidenceAtto = useMemo(() => {
    try {
      return toAtto(evidenceBond || "0");
    } catch {
      return 0n;
    }
  }, [evidenceBond]);

  const selectedRelease = myReleases.find((r) => r.release_id === releaseId);
  const isPublisher = !!(
    selectedRelease &&
    wallet.address &&
    selectedRelease.publisher.toLowerCase() === wallet.address.toLowerCase()
  );

  /**
   * Mirrors every guard in the contract's open_warranty exactly, evaluated
   * with a fresh clock on each render and re-verified at click time, so the
   * button can only light up when the contract will actually accept the call.
   */
  const warrantyChecksNow = () => {
    const now = Math.floor(Date.now() / 1000);
    const closesUnix = toUnix(coverageCloses);
    const endsUnix = toUnix(endsAt);
    const premium = Number(premiumBps);
    const sources = Number(minSources);
    const families = Number(minFamilies);
    const incidentSeconds = Math.round(Number(incidentHours) * 3600);
    return [
      { ok: !!ready, label: "Wallet connected on Studionet (61999)" },
      { ok: !!releaseId, label: "Release selected (register one first)" },
      { ok: !releaseId || isPublisher, label: "Connected wallet is the release publisher" },
      { ok: title.trim().length > 2, label: "Warranty title" },
      { ok: severityRule.trim().length > 2, label: "Severity rule" },
      { ok: vulnClass.trim().length > 2, label: "Vulnerability class" },
      { ok: exclusions.trim().length > 2, label: "Exclusions" },
      { ok: closesUnix >= now + 300, label: "Coverage closes ≥ 5 minutes from now" },
      { ok: endsUnix >= now + 1800 && endsUnix <= now + 90 * 24 * 3600, label: "Warranty ends 30 minutes – 90 days from now" },
      { ok: closesUnix > 0 && endsUnix > closesUnix, label: "Warranty ends after coverage closes" },
      { ok: incidentSeconds >= 900 && incidentSeconds <= 7 * 24 * 3600, label: "Incident window 15 minutes – 7 days" },
      { ok: premium >= 25 && premium <= 2500, label: "Premium 25 – 2500 bps" },
      { ok: sources >= 2 && sources <= 12, label: "Min sources 2 – 12" },
      { ok: families >= 2 && families <= Math.min(6, sources), label: "Min families 2 – min(6, sources)" },
      { ok: evidenceAtto >= 10n ** 14n && evidenceAtto <= 10n * 10n ** 18n, label: "Evidence bond between 0.0001 and 10 GEN" },
      { ok: bondAtto >= 10n ** 15n && bondAtto <= 100n * 10n ** 18n, label: "Bond between 0.001 and 100 GEN" },
    ];
  };
  const warrantyChecks = warrantyChecksNow();
  const warrantyReady = warrantyChecks.every((c) => c.ok);

  const applyWarrantyPreset = (preset: WarrantyPreset) => {
    const freshNow = Math.floor(Date.now() / 1000);
    if (!title.trim() && packageName) {
      setTitle(`Coverage for ${packageName} ${version}`);
    }
    if (!severityRule.trim()) setSeverityRule(SEVERITY_PRESETS[0]);
    if (!vulnClass.trim()) setVulnClass(CLASS_PRESETS[0]);
    if (!exclusions.trim()) setExclusions(EXCLUSION_PRESETS[0]);
    setPremiumBps(preset.premiumBps);
    setCoverageCloses(localInput(freshNow + preset.closesMin * 60));
    setEndsAt(localInput(freshNow + preset.endsMin * 60));
    setIncidentHours(preset.incidentHours);
    setMinSources(preset.minSources);
    setMinFamilies(preset.minFamilies);
    setEvidenceBond(preset.evidenceBond);
    setBond(preset.bond);
  };

  if (!configured) {
    return (
      <div className="container-x pt-14">
        <ConfigNotice />
      </div>
    );
  }

  return (
    <div className="container-x pt-14">
      <PageHead
        eyebrow="Publisher console"
        title="Open a bonded warranty"
        lead="Register the exact release you ship, then freeze warranty terms behind an escrowed GEN bond. Pick a template or fill the fields manually — the checklist shows exactly what is missing."
      />

      {!ready && (
        <div className="card card-pad mt-10 border-[rgba(147,104,0,0.45)]">
          <p className="text-sm">
            Connect a wallet on <strong>Studionet (chain 61999)</strong> to publish — the buttons below activate as
            soon as the wallet is on the right network.
          </p>
        </div>
      )}

      {tx.stage !== "idle" && (
        <div className="mt-10">
          <TxRail state={tx} />
        </div>
      )}

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {/* ---------- register release ---------- */}
        <section className="card card-pad corner-marks">
          <div className="flex items-center gap-3">
            <PackagePlus className="h-5 w-5 text-[var(--mint-deep)]" />
            <h2 className="display text-xl">1 · Register release</h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">
            Pins one exact release identity. A release can never be edited or re-registered.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Wand2 className="h-3.5 w-3.5 text-[var(--mint-deep)]" />
            {RELEASE_PRESETS.map((preset) => (
              <button key={preset.name} className="chip-btn" onClick={() => applyReleasePreset(preset)}>
                {preset.name}
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Ecosystem</label>
              <select className="select" value={ecosystem} onChange={(e) => setEcosystem(e.target.value)}>
                <option value="npm">npm</option>
                <option value="pypi">pypi</option>
                <option value="crates">crates</option>
                <option value="go">go</option>
                <option value="maven">maven</option>
                <option value="github">github</option>
              </select>
            </div>
            <div>
              <label className="label">Version</label>
              <input className="input mono" placeholder="1.4.2" value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
          </div>
          <div className="mt-4">
            <label className="label">Package name</label>
            <input className="input" placeholder="e.g. @acme/payments" value={packageName} onChange={(e) => setPackageName(e.target.value)} />
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <label className="label mb-0">Release digest (SHA-256, hex)</label>
              <div className="flex gap-2">
                <button className="chip-btn" onClick={() => setDigest(randomHex(32))}>
                  <Dices className="h-3 w-3" /> Random
                </button>
                <button className="chip-btn" onClick={() => fileRef.current?.click()} disabled={hashing}>
                  <FileUp className="h-3 w-3" /> {hashing ? "Hashing…" : "Hash a file"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) hashFile(file);
                  }}
                />
              </div>
            </div>
            <input
              className={`input mono mt-2 ${digest && !validDigest ? "border-[var(--danger)]" : digest ? "border-[var(--mint-deep)]" : ""}`}
              placeholder="64 lowercase hex characters"
              value={digest}
              onChange={(e) => setDigest(e.target.value)}
            />
            <p className={`field-hint ${digest && !validDigest ? "text-[var(--danger)]" : ""}`}>
              {digest
                ? validDigest
                  ? "Digest looks valid — `0x` prefixes and capitalization are normalized automatically."
                  : `Needs exactly 64 hex characters — currently ${digestNorm.length}.`
                : "Hash of the published artifact — or paste anything for a practice run."}
            </p>
          </div>
          <div className="mt-4">
            <label className="label">Metadata URL</label>
            <input className="input mono" placeholder="https://…" value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} />
          </div>

          <Checklist items={releaseChecks} />

          <button
            className="btn btn-primary mt-5 w-full"
            disabled={!releaseReady}
            onClick={() =>
              runWrite("register_release", [ecosystem, packageName.trim(), version.trim(), digestNorm, metadataUrl.trim()])
            }
          >
            Register release
          </button>
        </section>

        {/* ---------- open warranty ---------- */}
        <section className="card card-pad corner-marks">
          <div className="flex items-center gap-3">
            <ShieldPlus className="h-5 w-5 text-[var(--mint-deep)]" />
            <h2 className="display text-xl">2 · Open warranty</h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">
            Escrow the bond and freeze the terms. Premiums from coverage buyers credit you immediately.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Wand2 className="h-3.5 w-3.5 text-[var(--mint-deep)]" />
            {WARRANTY_PRESETS.map((preset) => (
              <button key={preset.id} className="chip-btn" onClick={() => applyWarrantyPreset(preset)}>
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <label className="label">Release</label>
            <select className="select" value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>
              {!myReleases.length && (
                <option value="">No releases owned by this wallet — register one in step 1</option>
              )}
              {myReleases.map((release) => (
                <option key={release.release_id} value={release.release_id}>
                  {release.package_name} {release.version} · {release.release_id}
                </option>
              ))}
            </select>
            {wallet.address && releases.length > 0 && myReleases.length === 0 && (
              <p className="field-hint">
                Existing releases belong to other publishers — the contract only lets a release&apos;s publisher
                warrant it, so register your own above.
              </p>
            )}
          </div>
          <div className="mt-4">
            <label className="label">Warranty title</label>
            <input className="input" placeholder="e.g. Critical RCE coverage for the 1.4 line" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Severity rule</label>
              <input className="input" placeholder="CVSS ≥ 7.0" value={severityRule} onChange={(e) => setSeverityRule(e.target.value)} />
              <div className="mt-2 flex flex-wrap gap-2">
                {SEVERITY_PRESETS.map((preset) => (
                  <button key={preset} className="chip-btn" onClick={() => setSeverityRule(preset)}>
                    {preset.split(" (")[0].replace(" or higher", "+")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Vulnerability class</label>
              <input className="input" placeholder="Remote code execution" value={vulnClass} onChange={(e) => setVulnClass(e.target.value)} />
              <div className="mt-2 flex flex-wrap gap-2">
                {CLASS_PRESETS.slice(0, 3).map((preset) => (
                  <button key={preset} className="chip-btn" onClick={() => setVulnClass(preset)}>
                    {preset.split(" ")[0] === "remote" ? "RCE" : preset.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <label className="label">Exclusions</label>
            <textarea className="textarea" placeholder="Conditions that never qualify, in plain language" value={exclusions} onChange={(e) => setExclusions(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="chip-btn" onClick={() => setExclusions("dev-only usage, unsupported forks, local admin access required")}>
                Standard exclusions
              </button>
              <button className="chip-btn" onClick={() => setExclusions("physical access required; social engineering scenarios")}>
                Strict exclusions
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Coverage closes</label>
              <input type="datetime-local" className="input mono" value={coverageCloses} onChange={(e) => setCoverageCloses(e.target.value)} />
            </div>
            <div>
              <label className="label">Warranty ends</label>
              <input type="datetime-local" className="input mono" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Premium (bps)</label>
              <select className="select mono" value={premiumBps} onChange={(e) => setPremiumBps(e.target.value)}>
                <option value="25">25 · 0.25%</option>
                <option value="150">150 · 1.5%</option>
                <option value="250">250 · 2.5%</option>
                <option value="500">500 · 5%</option>
                <option value="1000">1000 · 10%</option>
              </select>
            </div>
            <div>
              <label className="label">Min sources</label>
              <select
                className="select mono"
                value={minSources}
                onChange={(e) => {
                  setMinSources(e.target.value);
                  const cap = Math.min(6, Number(e.target.value));
                  if (Number(minFamilies) > cap) setMinFamilies(String(cap));
                }}
              >
                {["2", "3", "4", "5", "6"].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Min families</label>
              <select className="select mono" value={minFamilies} onChange={(e) => setMinFamilies(e.target.value)}>
                {["2", "3", "4", "5", "6"]
                  .filter((n) => Number(n) <= Math.min(6, Number(minSources)))
                  .map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Incident window</label>
              <select className="select mono" value={incidentHours} onChange={(e) => setIncidentHours(e.target.value)}>
                <option value="0.5">30 min</option>
                <option value="1">1 hour</option>
                <option value="2">2 hours</option>
                <option value="24">24 hours</option>
                <option value="72">3 days</option>
              </select>
            </div>
            <div>
              <label className="label">Evidence bond (GEN)</label>
              <select className="select mono" value={evidenceBond} onChange={(e) => setEvidenceBond(e.target.value)}>
                <option value="0.001">0.001</option>
                <option value="0.005">0.005</option>
                <option value="0.01">0.01</option>
                <option value="0.1">0.1</option>
              </select>
            </div>
            <div>
              <label className="label">Your bond (GEN)</label>
              <select className="select mono" value={bond} onChange={(e) => setBond(e.target.value)}>
                <option value="0.05">0.05</option>
                <option value="0.5">0.5</option>
                <option value="1">1</option>
                <option value="5">5</option>
                <option value="10">10</option>
              </select>
            </div>
          </div>

          <Checklist items={warrantyChecks} />

          <button
            className="btn btn-accent mt-5 w-full"
            disabled={!warrantyReady}
            onClick={() => {
              // Re-verify against the real clock right before signing — time
              // dependent guards (coverage close, warranty end) can flip while
              // the form sits open.
              if (!warrantyChecksNow().every((c) => c.ok)) return;
              runWrite(
                "open_warranty",
                [
                  releaseId,
                  title.trim(),
                  severityRule.trim(),
                  vulnClass.trim(),
                  exclusions.trim(),
                  Number(premiumBps),
                  toUnix(coverageCloses),
                  toUnix(endsAt),
                  Math.round(Number(incidentHours) * 3600),
                  Number(minSources),
                  Number(minFamilies),
                  // u256 param — must be numeric (bigint), never a string.
                  evidenceAtto,
                ],
                bondAtto
              );
            }}
          >
            Escrow {genFromAtto(bondAtto)} GEN & open warranty
          </button>
        </section>
      </div>
    </div>
  );
}

# Architecture

SentinelPact is a single intelligent contract on GenLayer Studionet plus a wallet-first Next.js frontend. There is no backend signer, no relayer, and no admin key.

## 1 · Contract layers (inside one contract)

`contracts/sentinelpact.py` keeps every partition of protocol state in one deployable unit:

| Layer | Responsibility |
| --- | --- |
| Release registry | Exact release identities (`ecosystem`, `package`, `version`, digest, metadata URL). Immutable, de-duplicated per publisher. |
| Warranties | Frozen terms escrowed by a publisher bond: severity rule, vulnerability class, exclusions, premium bps, windows, evidence thresholds, evidence bond. |
| Coverage | Per-holder coverage positions priced at `premium = ceil(coverage × premium_bps / 10_000)`; premiums credit the publisher immediately. |
| Incidents | One active incident per warranty; opens only after coverage closes and before the warranty ends; bounded evidence capacity (12 slots). |
| Evidence | Salted commit → reveal → source-examination lifecycle with a 15-minute reveal window. Permanent history is kept even when capacity is released. |
| Verdicts | Two consensus stages: per-source structured extraction, then incident adjudication over verified evidence only. |
| Settlement | `BREACHED` converts `min(bond, coverage_total)` into a payout reserve; claims convert coverage into credit; withdrawals are pull payments. |

## 2 · Evidence capacity vs. history

Admission capacity and history are separate ledgers:

- `VERIFIED` evidence consumes one of 12 incident slots permanently.
- `SOURCE_UNAVAILABLE`, `INVALID_SOURCE`, and `UNREVEALED` release their slot, so spam or flaky sources cannot brick an incident.
- `retry_evidence` re-acquires a slot for a source that was unreachable, only while the evidence window is open.
- All submissions remain readable through `list_evidence` pagination — history is never deleted.

## 3 · Two-stage consensus

**Stage one — source examination.** `evaluate_evidence` (self-callback scheduled on reveal finalization) fetches the revealed URL through `gl.nondet.web` and reduces it to structured booleans (`same_package`, `material`, `publication_in_window`, `release_affected`, `severity_qualifies`, `class_matches`, `exclusion_applies`, …) via `gl.vm.run_nondet_unsafe` with a validator replay. Field-level agreement, not string similarity, is checked. Sources that cannot be fetched become `SOURCE_UNAVAILABLE` (bond refunded to submitter); sources failing admission become `INVALID_SOURCE` (bond credited to the publisher).

**Stage two — adjudication.** `adjudicate_incident` requires `verified_count >= min_sources` and at least `min_source_families` distinct families. Verified summaries are serialized deterministically (sorted JSON) into a judge prompt. A second consensus round replays the judge decision field-by-field. Only `BREACHED` and `NOT_AFFECTED` are semantic verdicts; `INCONCLUSIVE` leaves the incident open.

## 4 · Time model

```
warranty.created  < coverage_closes_at < ends_at
incident window   = incident_window_seconds, opens after coverage closes
reveal window     = min(15m, remaining evidence window)
```

Expiry paths are first-class writes: `expire_warranty` (bond back to publisher), `expire_incident` (marks `INCONCLUSIVE`, frees the active slot), `expire_unrevealed_evidence` (slashes the bond to the publisher).

## 5 · Accounting invariant

```
total_deposited = warranty_escrow + evidence_escrow + payout_reserve + total_claimable + total_withdrawn
```

Every GEN in the contract is always exactly one of those five buckets. `get_stats().accounting_balanced` recomputes the invariant on every read.

## 6 · Frontend layers (Next.js)

| Path | Role |
| --- | --- |
| `src/lib/genlayer/client.ts` | Single network/configuration module. Chain, RPC, explorer, and contract address are all env-driven here. |
| `src/lib/genlayer/sentinelpact.ts` | Typed facade: finalized reads + consensus-staged writes (`signing → submitted → decided → finalizing → successful`). |
| `src/lib/genlayer/wallet.tsx` | Injected EIP-1193 wallet context with Studionet (61999) switching/adding. |
| `src/lib/genlayer/fees.ts` | Best-effort consensus fee estimation with simulation refinement. |
| `src/app/**` | Pages: `/`, `/warranties`, `/warranties/[id]`, `/incidents`, `/incidents/[id]`, `/open`, `/account`, `/protocol`. |
| `src/components/**` | Design-system components — no data fetching logic. |

Reads target `TransactionHashVariant.LATEST_FINAL` so the UI never shows un-decided state. Writes wait for both consensus acceptance **and** finality, surfacing execution failures with their consensus stage.

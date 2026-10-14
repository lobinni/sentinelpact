# SentinelPact

**Bonded software-release warranties resolved by GenLayer consensus.**

SentinelPact registers an exact release, escrows native GEN behind frozen warranty terms, sells coverage before an incident, and adjudicates public vulnerability evidence through two-stage consensus. Settlement is deterministic: only a finalized `BREACHED` adjudication creates a payout reserve.

## Last update — developer handoff

**Last updated:** 2026-10-14 UTC  
**Current release:** `2.1.0-studionet`  
**Canonical contract:** [`0xD61eFb765F260F4D191C359D7a7413fcb59162Bf`](https://explorer-studio.genlayer.com/address/0xD61eFb765F260F4D191C359D7a7413fcb59162Bf)  
**Network:** GenLayer Studionet, chain `61999`  
**On-chain verification:** `get_stats()` identity, strict-expiry flag, replay mode, and adversarial read-only probes all passed on 2026-10-14

This repository tracks one current release only. Treat the canonical address above, `contracts/sentinelpact.py`, and `deployments/studionet.json` as the source of truth. Do not restore superseded deployment addresses or earlier storage schemas.

### What changed in the current release (addresses the latest security review)

- **No expiry bypass for pending evidence — the 30-minute grace is gone.** `expire_incident` now unconditionally requires `pending_evidence == 0`; elapsed time never discards a live evaluation. A callback stuck in `PENDING_SOURCE` for five minutes is resolved explicitly through `expire_stalled_evidence` (auditable `STALLED_SOURCE` record, bond refunded, capacity released), and only then can the incident expire.
- **Replay protection no longer hashes the raw URL.** Source identity is a aggressive canonical URL (`https://host/normalized-path` — query, fragment, port, `www`, case, repeated slashes, dot segments, and repeated percent-decoding all collapse) plus a semantic `family + advisory_id` fingerprint that validators extract from the source; a different path for the same advisory terminates as `DUPLICATE_SOURCE`.
- **Settlement-phase adjudication:** an irreversible verdict is blocked until the evidence window has closed and `pending_evidence == 0` — unchanged by this release.
- **Authenticated authoritative sources:** `NVD`, `CISA`, `GITHUB_ADVISORY`, and `PACKAGE_REGISTRY` submissions must use an allowlisted operator host before any model examines the content.
- **Reconcilable GEN withdrawals:** credit moves through `withdrawal_in_flight`; successful dispatch settles to `total_withdrawn`, while failed or ambiguous dispatch returns the amount to withdrawable credit.
- **MetaMask-only wallet flow:** plain injected EIP-1193 on Studionet `61999`; no GenLayer wallet plugin, snap, WalletConnect, or backend signer.

### Developer start-here checklist

1. Read [`docs/SETTLEMENT_SAFETY.md`](docs/SETTLEMENT_SAFETY.md) before changing evidence, adjudication, expiry, or withdrawal logic.
2. Review [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/SECURITY.md`](docs/SECURITY.md) before modifying contract storage or accounting.
3. Use [`samples/manual-live-test.json`](samples/manual-live-test.json) and [`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md) for safe manual tests; never manufacture a live `BREACHED` disclosure.
4. Check finalized lifecycle proof in [`docs/evidence/README.md`](docs/evidence/README.md) and [`docs/evidence/LIFECYCLE_EVIDENCE.json`](docs/evidence/LIFECYCLE_EVIDENCE.json).
5. After any contract redeployment, update only the canonical deployment record and `NEXT_PUBLIC_SENTINELPACT_CONTRACT`, then rebuild the frontend.

### Required verification before handoff

```bash
node scripts/verify_live.mjs
python -m pytest tests/direct/test_sentinelpact_adversarial.py -v
python -m pytest tests/direct/ -v
python -m pytest tests/integration/ -v -s
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run build
```

The live verifier must report `version=2.1.0-studionet`, `accounting_balanced=true`, `expiry_requires_zero_pending=true`, `pending_evidence_timeout_seconds=300`, `source_replay_protection=CANONICAL_URL_PLUS_FAMILY_ADVISORY_FINGERPRINT`, and `withdrawal_timeout_seconds=900`.

## Live release

| What | Value |
| --- | --- |
| Network | GenLayer Studionet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Explorer | `https://explorer-studio.genlayer.com` |
| Canonical contract | [`0xD61eFb765F260F4D191C359D7a7413fcb59162Bf`](https://explorer-studio.genlayer.com/address/0xD61eFb765F260F4D191C359D7a7413fcb59162Bf) · version `2.1.0-studionet` |
| Deployment record | [`deployments/studionet.json`](deployments/studionet.json) — identity and hardened settlement rules verified live via `get_stats()` |
| Wallet | MetaMask (injected EIP-1193) on chain 61999 — **no GenLayer snap/plugin required** |

**Plugin-free wallet model.** The app talks to MetaMask through the standard EIP-1193 interface only: `eth_requestAccounts`, `wallet_switchEthereumChain` / `wallet_addEthereumChain` (adds Studionet on first use), and `eth_sendTransaction` for signing consensus envelopes. Chain reads, receipt polling and fee estimation go over plain HTTPS to the studio RPC — nothing GenLayer-specific is ever installed in the wallet, and there is no backend signer. Every write also preflights the wallet (access granted + correct chain, auto-switching when possible) before MetaMask is asked to sign.

The live contract answered a read-only verification (`product=SentinelPact`, `version=2.1.0-studionet`, `chain_id=61999`, `accounting_balanced=true`, `admin_controls=false`, `max_adjudication_rounds=3`). Manual live-test samples are in [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md); GitHub + Vercel publishing steps are in [docs/GITHUB_VERCEL.md](docs/GITHUB_VERCEL.md).

The contract itself separates permanent evidence history from active admission capacity: `SOURCE_UNAVAILABLE`, `INVALID_SOURCE`, and `UNREVEALED` release a slot; retries reacquire one while the incident window is open; `VERIFIED` evidence remains capacity-consuming. Adjudication walks a bounded verified-evidence index, and history reads are paginated.

## Architecture

All protocol state lives in the single intelligent contract `contracts/sentinelpact.py`: release registry, funded warranties, coverage, incidents, commit/reveal evidence, source examination, warranty adjudication, payout reserves, pull-payment credits, expiry paths, and the accounting invariant. Source examination reproduces substantive structured fields; adjudication consumes only verified evidence from distinct source families. `SOURCE_UNAVAILABLE` is a retryable non-decision, and expiry fallback `INCONCLUSIVE` is not a semantic verdict.

The accounting invariant is exposed by `get_stats()`:

```
total_deposited = warranty_escrow + evidence_escrow + payout_reserve + total_claimable + withdrawal_in_flight + total_withdrawn
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), the step-by-step adversarial review in [docs/ANTI_CHEAT.md](docs/ANTI_CHEAT.md), and the security review response in [docs/SETTLEMENT_SAFETY.md](docs/SETTLEMENT_SAFETY.md).

### Settlement safety controls

* **Settlement phase.** Irreversible adjudication runs only after the evidence window closed *and* every in-flight examination resolved. Expiry requires zero pending items unconditionally — the former 30-minute grace path is removed; a stalled callback must be resolved per-item via `expire_stalled_evidence` first.
* **Authenticated authorities.** `NVD`, `CISA`, `GITHUB_ADVISORY` and `PACKAGE_REGISTRY` evidence must be served from that operator's own hosts, checked deterministically on-chain before any model reads the source.
* **No verdict grinding.** Canonical URL identities and semantic advisory fingerprints are unique per warranty, every attempt is charged against a warranty-wide ceiling, and a re-judgement requires strictly new verified evidence.
* **Reconcilable withdrawals.** Withdrawals are two-phase with an in-flight accounting bucket; a failed or unobserved transfer always returns to withdrawable credit.

Finalized on-chain proof of the corrected lifecycle: [docs/evidence/](docs/evidence/).

## Repository layout

```
contracts/            SentinelPact intelligent contract (GenLayer GenVM, Python)
docs/                 Architecture, security, deployment, testing, configuration guides
deployments/          Canonical per-network deployment records
scripts/              Deployment automation
tests/direct/         Direct Mode unit tests (deterministic, mocked nondet)
tests/integration/    Read-only Studionet smoke tests
src/                  Next.js frontend (App Router, wallet-first, no backend signer)
```

## Quick start

### 1 · Point the app at a deployment

```bash
cp .env.example .env.local
# set NEXT_PUBLIC_SENTINELPACT_CONTRACT to the deployed address
npm run dev
```

The contract address is centralized — updating that one variable (and rebuilding) re-points the entire app. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

### 2 · Connect a wallet

The UI expects an injected EIP-1193 wallet (MetaMask) on **Studionet, chain 61999**. Read-only browsing works without a wallet; every state change requires one.

### 3 · Deploy your own instance

```bash
pip install -r requirements.txt
export GENLAYER_PRIVATE_KEY=0x...
python scripts/deploy_contract.py
```

Full flow in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Local checks

```bash
genvm-lint check contracts/sentinelpact.py --json
pytest tests/direct/ -v
pytest tests/integration/ -v -s
npm run typecheck && npm run build
```

Test guidance: [docs/TESTING.md](docs/TESTING.md). The read-only canonical smoke check is `node scripts/verify_live.mjs`; manual form values and safe expected outcomes are in [`samples/manual-live-test.json`](samples/manual-live-test.json).

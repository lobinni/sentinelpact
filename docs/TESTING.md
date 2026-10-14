# Testing guide

Two complementary suites cover the protocol: **Direct Mode** unit tests (local, deterministic) and **Studionet integration** smoke tests (live, read-only).

## Prerequisites

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

`requirements.txt` pins `genlayer-test==0.29.2` (Direct Mode runner), `genvm-lint`, `genlayer-py==0.16.3` (live client), and `pytest`.

## 1 · Contract lint (always first)

```bash
genvm-lint check contracts/sentinelpact.py --json
```

Checks that the contract stays inside the GenVM Python subset and consensus rules.

## 2 · Direct Mode tests

```bash
pytest tests/direct/ -v
```

The runner loads `contracts/sentinelpact.py` into an in-process GenVM. The harness provides `direct_vm`, `direct_deploy`, and account fixtures (`direct_alice`, `direct_bob`, `direct_charlie`). The suite mocks nondeterminism per test:

- `vm.mock_web(pattern, {"status": 200, "body": ...})` — source fetches
- `vm.mock_llm(pattern, json)` — examiner and judge responses
- `vm.warp(iso_datetime)` — deterministic time travel

`tests/direct/conftest.py` applies a narrow stdin compatibility shim for the pinned runner (supplies the fd-0 message context); it does not change contract behavior or assertions.

### What the sample suite covers

| Area | Examples |
| --- | --- |
| Registry | release + warranty become funded records; stats invariant holds |
| Access control | only the release publisher can warrant a release |
| Coverage | exact premium math; capacity cannot exceed the bond |
| Incident gating | incidents cannot open before coverage closes |
| Commit/reveal | commitment binds chain, contract, incident, wallet, and payload |
| Stage one | verified source returns the bond and records structured fields |
| Retryable states | `SOURCE_UNAVAILABLE` refunds and can retry within the window |
| Slashing | unrevealed commitments pay the publisher; invalid sources pay the publisher |
| Stage two | breach verdict requires family diversity, at least one independent authoritative family, and moves bond to reserve |
| Anti-grinding | a repeated judgement requires new verified evidence; rounds are bounded at three |
| Anti-fabrication | self-authorable `VENDOR + SECURITY_RESEARCH` evidence cannot unlock adjudication alone |
| Settlement | holders claim exactly their coverage, once; double claims revert |
| Expiry paths | ended warranties return the bond; `INCONCLUSIVE` moves nothing |

Add new cases by asserting on `get_stats()` before/after — the accounting invariant catches any bucket leak.

### Adversarial suite

`tests/direct/test_sentinelpact_adversarial.py` targets the settlement-safety controls directly:

| Attack attempted | Guard proven |
| --- | --- |
| Settle while the evidence window is still open | adjudication opens only in the settlement phase |
| Settle while an examination is still in flight | pending evaluations must resolve first |
| Expire an incident to discard a pending evaluation | expiry waits for pending work |
| Hold a bond hostage with a stuck evaluation | the specific item must be explicitly resolved as `STALLED_SOURCE` after five minutes; incident expiry never discards pending work regardless of elapsed time |
| Pass a self-hosted page off as `NVD` | on-chain host authentication rejects it |
| Settle on `VENDOR` + `SECURITY_RESEARCH` alone | an independent authority is required |
| Replay through query/fragment/host/path/percent URL variants | canonical URL identity rejects the variant per warranty |
| Replay one advisory through a genuinely different URL | semantic `family + advisory_id` fingerprint marks it `DUPLICATE_SOURCE` |
| Re-roll a verdict over unchanged evidence | watermark plus round/warranty ceilings |
| Lose GEN to a failed or unobserved transfer | two-phase withdrawal reconciles to credit |
| Double-spend a reconciled withdrawal | terminal status guards |

```bash
pytest tests/direct/test_sentinelpact_adversarial.py -v
```

## 3 · Studionet integration tests (live, chain 61999)

A zero-setup Node smoke check (read-only, no wallet) verifies the canonical contract identity, registry reads, accounting, authoritative-source guard, and round cap:

```bash
node scripts/verify_live.mjs
```

The Python suite defaults to the same canonical deployment `0xD61eFb765F260F4D191C359D7a7413fcb59162Bf`:

```bash
pytest tests/integration/ -v -s
```

To target your own redeployment instead:

```bash
SENTINELPACT_CONTRACT=0xYourAddress \
SENTINELPACT_DEPLOYMENT_TX=0xYourDeploymentTx \
pytest tests/integration/ -v -s
```

- Read-only: no transaction is ever submitted, no GEN is spent.
- Verifies deployment finality (when a tx hash is supplied), `get_stats()` identity fields, the accounting invariant, registry read shapes, and read stability across repeated `LATEST_FINAL` calls.

## 4 · Frontend checks

```bash
npm run typecheck
npm run build
```

## 5 · Finalized on-chain lifecycle evidence

```bash
node scripts/lifecycle_evidence.mjs phase1   # register, warrant, cover, withdraw
node scripts/lifecycle_evidence.mjs phase2   # incident + settlement-phase guards
node scripts/lifecycle_evidence.mjs phase3   # pending-evaluation + expiry guards
node scripts/lifecycle_evidence.mjs phase4   # final accounting + report
node scripts/lifecycle_evidence.mjs verify   # re-read every hash, record finality
```

Each step, including every deliberately rejected attack, is written with its transaction hash to [`docs/evidence/`](evidence/).

## 6 · Manual end-to-end script (Studionet)

A complete copy-paste walkthrough (sample values, URLs, expected states) against the live canonical contract lives in [MANUAL_TESTING.md](MANUAL_TESTING.md). Summary:

1. Wallet A (publisher): register a release at `/open`, then open a warranty (e.g. 5 GEN bond, 24h ends, coverage closes in ~10 minutes).
2. Wallet B: buy coverage on `/warranties/[id]` before the close.
3. After coverage closes, wallet B (or any): open an incident from the warranty page.
4. Wallet C: on `/incidents/[id]`, commit evidence (bond required), reveal within 15 minutes; watch the status move `COMMITTED → PENDING_SOURCE → VERIFIED` after consensus examines the live source.
5. Repeat with a second source **from a different family** (e.g. NVD + CISA).
6. Click **Adjudicate** — with sufficient verified evidence the judge stage runs.
7. If `BREACHED`: the holder claims on the warranty page, then withdraws from `/account`. Check `/protocol` — escrow must move to reserve to claimable to withdrawn, always balanced.

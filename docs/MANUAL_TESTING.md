# Manual live testing — Studionet (chain 61999)

A complete, copy-paste walkthrough against the canonical contract
[`0x81d6c588A9bee60265DEA0d19c38818a77f32bcf`](https://explorer-studio.genlayer.com/address/0x81d6c588A9bee60265DEA0d19c38818a77f32bcf) (`1.1.0-studionet`). A machine-readable input set with safe expected outcomes is available at [`samples/manual-live-test.json`](../samples/manual-live-test.json).

Three roles are used. One wallet can play all three, but separate addresses show the permissions clearly:

| Role | Who | Needs |
| --- | --- | --- |
| Publisher | Wallet A | registers the release, escrows the bond, earns premiums |
| Buyer | Wallet B | purchases coverage, later claims the payout |
| Witness | Wallet C (anyone) | opens incidents, commits evidence, calls adjudicate |

## 0 · Prerequisites

1. MetaMask (or any injected EIP-1193 wallet). **No GenLayer snap/plugin is needed** — signing is plain `eth_sendTransaction` on chain 61999; the app never installs anything into the wallet.
2. Open the app and press **Connect wallet** — accept the request to add/switch to **GenLayer Studionet (chain 61999)**. If added manually: RPC `https://studio.genlayer.com/api`, symbol `GEN`, explorer `https://explorer-studio.genlayer.com`.
3. Fund each wallet with a small amount of Studionet GEN (gas + bonds + premium).
4. Sanity read (optional, no wallet): `pytest tests/integration/ -v -s` should pass against the canonical deployment.

Before every on-chain write the app preflights MetaMask: if the wallet is on a different chain it triggers the standard switch/add-network prompt automatically, and it always signs from MetaMask's currently active account.

## 1 · Register a release (Wallet A) — `/open`

Sample input:

| Field | Sample value |
| --- | --- |
| Ecosystem | `npm` |
| Package name | `@acme/beacon-parser` |
| Version | `3.7.4` |
| Release digest | any 64 lowercase hex chars (e.g. `ab` repeated 32 times) |
| Metadata URL | `https://example.com/releases/3.7.4` |

Press **Register release** → confirm in MetaMask → wait for `Finalized with successful GenVM execution`. The release appears in the warranty step's selector (and on `/open` reload).

> The digest is the artifact fingerprint. Duplicate package+version+publisher registrations are rejected — change the version for each practice run.

## 2 · Open a warranty (Wallet A) — `/open`

Fast-cycle sample (the coverage and evidence workflow can be exercised in approximately 45 minutes):

| Field | Sample value | Constraint it satisfies |
| --- | --- | --- |
| Release | the one from step 1 | — |
| Title | `Critical RCE coverage for beacon-parser 3.7.4` | — |
| Severity rule | `CVSS 9.0 or higher, or vendor-labeled CRITICAL` | plain language |
| Vulnerability class | `remote code execution` | plain language |
| Exclusions | `dev-only usage, unsupported forks, local admin access required` | — |
| Premium (bps) | `500` (= 5%) | 25–2500 |
| Coverage closes | **now + 6 minutes** | ≥ now + 5 min |
| Warranty ends | **now + 2 hours** | 30 min – 90 days, after close |
| Incident window (h) | `0.5` (30 min) | 15 – 168 h |
| Min sources | `2` | 2–12 |
| Min families | `2` | 2–6, ≤ min sources |
| Evidence bond | `0.001` GEN | 0.0001–10 |
| Your bond | `0.05` GEN | ≥ 0.001 |

Press **Escrow 0.05 GEN & open warranty**. Expected: warranty card on `/warranties`, status `OPEN`, escrow `0.05 GEN`.

## 3 · Buy coverage (Wallet B) — `/warranties/[id]`

Before the 6-minute close:

- Coverage amount: `0.02` GEN
- Premium due: auto-computed `0.001` GEN (5%)

Press **Buy coverage**. Expected: wallet B position on `/account` shows `0.02 GEN`, wallet A's withdrawable credit shows the premium.

## 4 · Open the incident (any wallet)

After coverage closes, the **Open incident** panel appears on the warranty page:

| Field | Sample value |
| --- | --- |
| Incident title | `Suspected critical RCE in beacon-parser 3.7.4` |
| Advisory hint | `unauthenticated template evaluation` |

Expected: incident `OPEN`, evidence deadline = now + 30 min.

## 5 · Commit and reveal evidence (Wallet C) — `/incidents/[id]`

Per source (two sources, two families):

1. Fill **Source family**, **Source URL**, **Claimed fact**; keep the auto salt.
2. **Commit evidence** (sends the 0.001 GEN evidence bond).
3. Within 15 minutes press **Reveal** on the committed card → form auto-fills from this browser → **Reveal evidence**.
4. Status moves `COMMITTED → PENDING_SOURCE → VERIFIED` (or `SOURCE_UNAVAILABLE` — then press **Retry examination**, or `INVALID_SOURCE`) once validators finish fetching and checking the source.

Honest guidance on outcomes:

- **Safe negative-path sample (recommended):** choose one real historical advisory first, then register the exact package and affected version named by it in step 1. Use the matching NVD page as family `NVD` and the matching GitHub Advisory page as `GITHUB_ADVISORY`. Both are authoritative and independently controlled. Because their publication predates this newly opened warranty, examination records `publication_in_window=false`; adjudication should settle `NOT_AFFECTED` or `INCONCLUSIVE`. This exercises the complete live pipeline without inventing a vulnerability or manufacturing a payout.
- **Positive path (`BREACHED`) is not a synthetic demo:** it is valid only when a real independent authority (`GITHUB_ADVISORY`, `NVD`, `CISA`, or `PACKAGE_REGISTRY`) publishes a qualifying disclosure during the active warranty window and a second verified family corroborates it. Do not create, backdate, or misclassify a page to force this result. Direct Mode tests cover the positive reserve/claim/withdrawal branch deterministically without making a false live claim.

Two sources must come from **two different families**, and at least one must be from `GITHUB_ADVISORY`, `NVD`, `CISA`, or `PACKAGE_REGISTRY`. `VENDOR + SECURITY_RESEARCH` alone cannot unlock adjudication. Repeating adjudication over the same evidence is also blocked; every additional round requires newly verified evidence, with a maximum of three rounds.

## 6 · Adjudicate (any wallet)

Once `verified ≥ 2` across `2` families and the authoritative-source rule is satisfied, press **Adjudicate incident**. Expected states:

- `NOT_AFFECTED` → incident closes, warranty stays `OPEN`, bond untouched → later `expire_warranty` returns it.
- `INCONCLUSIVE` → incident stays open. A new adjudication requires at least one additional verified source and cannot exceed three total rounds; otherwise let the window expire.
- `BREACHED` → only for a truthful, in-window qualifying disclosure; the warranty closes and payout reserve = `min(bond, coverage) = 0.02 GEN` materializes on `/protocol`.

## 7 · Claim and withdraw (Wallet B; resign as needed)

1. Warranty page: **Claim breach payout** → your 0.02 GEN becomes credit.
2. `/account`: **Withdraw credit** → GEN arrives back in MetaMask.
3. `/protocol` accounting: escrow → reserve → claimable → withdrawn, `accounting_balanced = Yes` at every step.

## Timing cheatsheet

| Step | Wait |
| --- | --- |
| Release → warranty | immediate |
| Coverage window | 6 minutes |
| Incident window | 30 minutes (reveal within 15 minutes of each commit) |
| Each consensus stage | typically 1–5 minutes; the UI polls and the tx rail shows `decided → finalizing → successful` |

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `coverage window is closed` | coverage close time passed — open a fresh warranty with a longer window |
| `not enough time remains to reveal evidence` | commit earlier inside the incident window |
| `reveal does not match commitment` | salt/url/fact changed — reveal reuses the stored payload automatically; retry with identical values |
| `SOURCE_UNAVAILABLE` twice | validators cannot fetch the URL; choose a plain public https page without bot protection |
| `Consensus rejected the operation (leader timeout)` | transient network state — check the tx hash on the explorer, then resubmit if it truly failed |
| A pending note stays on screen after signing | the network is indexing more slowly than usual — confirm the hash on the explorer; the rail never reports success or failure without on-chain proof |

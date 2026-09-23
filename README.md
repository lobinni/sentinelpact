# SentinelPact

**Bonded software-release warranties resolved by GenLayer consensus.**

SentinelPact registers an exact release, escrows native GEN behind frozen warranty terms, sells coverage before an incident, and adjudicates public vulnerability evidence through two-stage consensus. Settlement is deterministic: only a finalized `BREACHED` adjudication creates a payout reserve.

## Live release

| What | Value |
| --- | --- |
| Network | GenLayer Studionet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Explorer | `https://explorer-studio.genlayer.com` |
| Canonical contract | [`0x81d6c588A9bee60265DEA0d19c38818a77f32bcf`](https://explorer-studio.genlayer.com/address/0x81d6c588A9bee60265DEA0d19c38818a77f32bcf) · version `1.1.0-studionet` |
| Deployment record | [`deployments/studionet.json`](deployments/studionet.json) — identity and hardened settlement rules verified live via `get_stats()` |
| Wallet | MetaMask (injected EIP-1193) on chain 61999 — **no GenLayer snap/plugin required** |

**Plugin-free wallet model.** The app talks to MetaMask through the standard EIP-1193 interface only: `eth_requestAccounts`, `wallet_switchEthereumChain` / `wallet_addEthereumChain` (adds Studionet on first use), and `eth_sendTransaction` for signing consensus envelopes. Chain reads, receipt polling and fee estimation go over plain HTTPS to the studio RPC — nothing GenLayer-specific is ever installed in the wallet, and there is no backend signer. Every write also preflights the wallet (access granted + correct chain, auto-switching when possible) before MetaMask is asked to sign.

The live contract answered a read-only verification (`product=SentinelPact`, `version=1.1.0-studionet`, `chain_id=61999`, `accounting_balanced=true`, `admin_controls=false`, `max_adjudication_rounds=3`). Manual live-test samples are in [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md); GitHub + Vercel publishing steps are in [docs/GITHUB_VERCEL.md](docs/GITHUB_VERCEL.md).

The contract itself separates permanent evidence history from active admission capacity: `SOURCE_UNAVAILABLE`, `INVALID_SOURCE`, and `UNREVEALED` release a slot; retries reacquire one while the incident window is open; `VERIFIED` evidence remains capacity-consuming. Adjudication walks a bounded verified-evidence index, and history reads are paginated.

## Architecture

All protocol state lives in the single intelligent contract `contracts/sentinelpact.py`: release registry, funded warranties, coverage, incidents, commit/reveal evidence, source examination, warranty adjudication, payout reserves, pull-payment credits, expiry paths, and the accounting invariant. Source examination reproduces substantive structured fields; adjudication consumes only verified evidence from distinct source families. `SOURCE_UNAVAILABLE` is a retryable non-decision, and expiry fallback `INCONCLUSIVE` is not a semantic verdict.

The accounting invariant is exposed by `get_stats()`:

```
total_deposited = warranty_escrow + evidence_escrow + payout_reserve + total_claimable + total_withdrawn
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), and the step-by-step adversarial review in [docs/ANTI_CHEAT.md](docs/ANTI_CHEAT.md).

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

# Deployment guide

Target network: **GenLayer Studionet, chain 61999** (`https://studio.genlayer.com/api`).

> Canonical deployment: [`0x81d6c588A9bee60265DEA0d19c38818a77f32bcf`](https://explorer-studio.genlayer.com/address/0x81d6c588A9bee60265DEA0d19c38818a77f32bcf) (`sentinelpact.py` v`1.1.0-studionet`). Identity, accounting, authoritative-source enforcement, and adjudication-round limits were verified live through `get_stats()`. The steps below are only needed for your own redeployment.

## Prerequisites

- Python 3.12 with `pip install -r requirements.txt`
- A Studionet deployer account funded with GEN (native asset used for deployment and bonds)
- The deployer private key in `GENLAYER_PRIVATE_KEY`

## 1 · Lint the contract

```bash
genvm-lint check contracts/sentinelpact.py --json
```

The lint must pass with zero findings before deploying; it validates the GenVM subset and consensus-safety constraints.

## 2 · Run Direct Mode tests

```bash
pytest tests/direct/ -v
```

All tests are deterministic (web + LLM mocked) and finish locally.

## 3 · Deploy

```bash
export GENLAYER_PRIVATE_KEY=0x...
python scripts/deploy_contract.py
```

The script:
1. Reads `contracts/sentinelpact.py`.
2. Deploys it through the funded account.
3. Waits for the transaction to reach `FINALIZED` consensus status.
4. Writes the address and transaction hash into `deployments/studionet.json`.
5. Prints the exact `NEXT_PUBLIC_SENTINELPACT_CONTRACT=0x…` line for the frontend.

Manual alternative (GenLayer CLI):

```bash
genlayer deploy --contract contracts/sentinelpact.py --network studionet
```

## 4 · Verify on-chain

```bash
SENTINELPACT_CONTRACT=0xYourAddress \
SENTINELPACT_DEPLOYMENT_TX=0xYourTx \
pytest tests/integration/ -v -s
```

The suite confirms finality of the deployment transaction, reads `get_stats()` (product/version/network/accounting invariant), and checks the registry read shapes — all read-only, no GEN spent.

## 5 · Point the frontend

```bash
cp .env.example .env.local
echo "NEXT_PUBLIC_SENTINELPACT_CONTRACT=0xYourAddress" >> .env.local
npm run build && npm run start
```

See [CONFIGURATION.md](CONFIGURATION.md) for the single-variable update flow.

## Redeployment policy

- Old instances remain live on-chain; the frontend simply re-points via the env variable.
- Record every deployment in `deployments/studionet.json` (the script does this for you).
- Bump the `VERSION` constant in `contracts/sentinelpact.py` for any source change so `get_stats()` identifies what is live.

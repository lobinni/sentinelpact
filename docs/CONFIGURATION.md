# Configuration & contract address updates

Everything the frontend needs is environment-driven. **Changing the contract address is a one-variable update.** With no environment variables at all, the app still boots fully configured against the canonical Studionet deployment, because `src/lib/genlayer/client.ts` falls back to `DEFAULT_CONTRACT_ADDRESS`.

Resolution order:

```
NEXT_PUBLIC_SENTINELPACT_CONTRACT (env, if non-empty)
        ↓ otherwise
DEFAULT_CONTRACT_ADDRESS (src/lib/genlayer/client.ts → canonical deployment)
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SENTINELPACT_CONTRACT` | `0x81d6c588A9bee60265DEA0d19c38818a77f32bcf` (canonical) | Deployed contract address. The only value that changes on redeployment. |
| `NEXT_PUBLIC_GENLAYER_CHAIN_ID` | `61999` | Chain guard. The app refuses to boot against any other chain by design. |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` | Studionet RPC endpoint for reads and writes. |
| `NEXT_PUBLIC_GENLAYER_EXPLORER` | `https://explorer-studio.genlayer.com` | Explorer links for contracts, addresses, and transactions. |
| `DATABASE_URL` | *(unset)* | Optional platform database for the health endpoint only; unset on Vercel. |

## Where the address flows

```
.env.local
  └─ NEXT_PUBLIC_SENTINELPACT_CONTRACT
       └─ src/lib/genlayer/client.ts   (exports CONTRACT_ADDRESS — the single source of truth)
            ├─ src/lib/genlayer/sentinelpact.ts   (all reads/writes)
            ├─ src/components/Footer.tsx          (explorer link)
            └─ src/app/protocol/page.tsx          (display + copy button)
```

No other file hardcodes an address. Integration tests and the deployment record use their own explicit variables (below), so a redeploy never edits source code.

## Updating to a new deployment (checklist)

1. Deploy: `python scripts/deploy_contract.py` — it prints the address and updates `deployments/studionet.json` automatically.
2. Set the env var and rebuild:
   ```bash
   echo "NEXT_PUBLIC_SENTINELPACT_CONTRACT=0xYourNewAddress" >> .env.local
   npm run build
   ```
3. (Optional) Point integration tests at it without touching code:
   ```bash
   SENTINELPACT_CONTRACT=0xYourNewAddress SENTINELPACT_DEPLOYMENT_TX=0xYourTx pytest tests/integration/ -v -s
   ```

Because `NEXT_PUBLIC_*` variables are inlined at build time, every address change requires a rebuild of the frontend. Local development (`.env.local`) picks the value up on the next `npm run dev` restart.

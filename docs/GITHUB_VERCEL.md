# Publishing — GitHub + Vercel

Step-by-step commands to publish this repository and deploy the frontend.
The app is fully on-chain: **no `DATABASE_URL` is required on Vercel** (the
optional database only backs the local `/api/health` endpoint, which reports
`db: "not_configured"` when unset).

## 1 · Push to GitHub

```bash
# from the project root
git init
git add .
git commit -m "SentinelPact: bonded release warranties on GenLayer Studionet"
git branch -M main

# create an EMPTY repository on GitHub first (no README/.gitignore/license),
# then:
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

The included `.gitignore` keeps `node_modules`, `.next`, `.env*`, `__pycache__`,
and virtualenvs out of the commit, while keeping `.env.example` tracked.

Verify what will be committed:

```bash
git status --short
```

## 2 · Deploy on Vercel

1. **Import Project** → pick the GitHub repository. Framework is auto-detected as **Next.js**; leave the defaults (`next build` / `next start`), root directory = repository root.
2. **Environment Variables** — none are strictly required (the app falls back to the canonical contract baked into `src/lib/genlayer/client.ts`, and deliberately has **no** `DATABASE_URL`). For an explicit, self-documenting setup, add these four with **all scopes** (Production + Preview + Development):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SENTINELPACT_CONTRACT` | `0x81d6c588A9bee60265DEA0d19c38818a77f32bcf` |
   | `NEXT_PUBLIC_GENLAYER_CHAIN_ID` | `61999` |
   | `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` |
   | `NEXT_PUBLIC_GENLAYER_EXPLORER` | `https://explorer-studio.genlayer.com` |

   **About Vercel's prefix warning:** when saving a `NEXT_PUBLIC_*` name, Vercel shows *"Remove the public framework prefix to keep this value private…"* — that is only a caution. A contract address is public data that the browser must see; keep the `NEXT_PUBLIC_` prefix and leave the variable non-sensitive. Do **not** rename it (the code only reads `NEXT_PUBLIC_SENTINELPACT_CONTRACT`).

3. **Deploy**. When the build finishes, open the deployment URL — live protocol stats from Studionet appear on the home page.

   **Important:** `NEXT_PUBLIC_*` values are inlined into the bundle **at build time**. Adding or editing them never affects an existing deployment — after any env change, go to **Deployments → ⋯ → Redeploy** (a fresh build), otherwise the site keeps the old baked-in values and can show "Contract address not configured".

CLI alternative:

```bash
npm i -g vercel
vercel link                       # inside the project root
vercel env add NEXT_PUBLIC_SENTINELPACT_CONTRACT production   # 0x81d6c588A9bee60265DEA0d19c38818a77f32bcf
vercel env add NEXT_PUBLIC_GENLAYER_CHAIN_ID production       # 61999
vercel env add NEXT_PUBLIC_GENLAYER_RPC_URL production        # https://studio.genlayer.com/api
vercel env add NEXT_PUBLIC_GENLAYER_EXPLORER production       # https://explorer-studio.genlayer.com
vercel --prod
```

## 3 · After any contract redeployment

On Vercel: **Settings → Environment Variables** → update
`NEXT_PUBLIC_SENTINELPACT_CONTRACT` → **Deployments → Redeploy** (a rebuild is
required because `NEXT_PUBLIC_*` values are inlined at build time). No code
change is ever needed — see [CONFIGURATION.md](CONFIGURATION.md).

## 4 · Post-deploy smoke check

```bash
# against the live frontend — stats should be non-zero once activity starts,
# and /protocol must show the canonical address with an explorer link.
curl -s https://<your-app>.vercel.app/api/health
# → {"ok":true,"db":"not_configured"}
```

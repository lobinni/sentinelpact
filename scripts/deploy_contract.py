#!/usr/bin/env python3
"""Deploy the SentinelPact contract to GenLayer Studionet (chain 61999).

Usage:
    export GENLAYER_PRIVATE_KEY=0x...   # funded deployer key
    python scripts/deploy_contract.py

The script deploys contracts/sentinelpact.py, waits for consensus acceptance
and finalization, then prints a ready-to-paste block for:
  - deployments/studionet.json
  - .env.local (NEXT_PUBLIC_SENTINELPACT_CONTRACT)
"""

import json
import os
import sys
import time
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parent.parent / "contracts" / "sentinelpact.py"
DEPLOYMENT_RECORD = Path(__file__).resolve().parent.parent / "deployments" / "studionet.json"


def main() -> int:
    try:
        from genlayer_py import create_account, create_client
        from genlayer_py.chains import studionet
    except ImportError:
        print("genlayer-py is not installed. Run: pip install -r requirements.txt")
        return 1

    private_key = os.getenv("GENLAYER_PRIVATE_KEY", "").strip()
    if not private_key:
        print("Set GENLAYER_PRIVATE_KEY to a funded Studionet deployer key.")
        return 1

    account = create_account(private_key)
    client = create_client(chain=studionet, account=account)
    print(f"Deployer: {account.address}")
    print(f"Network : {studionet.name} (chain {studionet.id})")

    code = CONTRACT_PATH.read_bytes()
    print(f"Deploying {CONTRACT_PATH.name} ({len(code)} bytes)…")

    deploy_hash = client.deploy_contract(code=code, args=b"")
    print(f"Submission accepted by the mempool: {deploy_hash}")

    receipt = client.wait_for_transaction_receipt(hash=deploy_hash, status="FINALIZED", interval=4000, retries=180)
    status = receipt.get("status_name", receipt.get("status"))
    status = getattr(status, "value", status)
    if str(status) not in ("FINALIZED", "7"):
        print(f"Deployment did not finalize cleanly: status={status}")
        return 1

    address = (
        receipt.get("recipient")
        or receipt.get("to_address")
        or receipt.get("contract_address")
        or receipt.get("data", {}).get("recipient")
    )
    if not address:
        print("Finalized, but the contract address was not present in the receipt; check the explorer.")
        print(receipt)
        return 1

    print(f"\nDeployment FINALIZED")
    print(f"  contract: {address}")
    print(f"  tx:       {deploy_hash}")

    if DEPLOYMENT_RECORD.exists():
        record = json.loads(DEPLOYMENT_RECORD.read_text())
        record["deployment"] = {
            "address": address,
            "transaction": str(deploy_hash),
            "deployedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "deployer": account.address,
            "status": "live",
        }
        DEPLOYMENT_RECORD.write_text(json.dumps(record, indent=2) + "\n")
        print(f"\nUpdated {DEPLOYMENT_RECORD}")

    print("\nNext step — point the frontend at the new deployment:")
    print(f"  NEXT_PUBLIC_SENTINELPACT_CONTRACT={address}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

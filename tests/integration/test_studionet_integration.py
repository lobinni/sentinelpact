"""Read-only smoke verification of a live SentinelPact deployment on Studionet.

These tests make real RPC calls but never submit transactions or spend GEN.

Run:
    pytest tests/integration/ -v -s                          # canonical deployment
    SENTINELPACT_CONTRACT=0xYourAddress pytest tests/integration/ -v -s

The deployment transaction hash is optional; when supplied the suite also
verifies that the deployment itself reached FINALIZED status.
"""

import os

import pytest
from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet
from genlayer_py.types import TransactionHashVariant


CANONICAL_CONTRACT = "0x81d6c588A9bee60265DEA0d19c38818a77f32bcf"
CONTRACT = os.getenv("SENTINELPACT_CONTRACT", CANONICAL_CONTRACT)
DEPLOYMENT_TX = os.getenv("SENTINELPACT_DEPLOYMENT_TX", "")
RPC = "https://studio.genlayer.com/api"

pytestmark = pytest.mark.skipif(not CONTRACT, reason="SENTINELPACT_CONTRACT is not set")


@pytest.fixture(scope="module")
def live():
    assert studionet.id == 61999
    assert studionet.rpc_urls["default"]["http"] == [RPC]
    account = create_account()
    return create_client(chain=studionet, account=account)


def read(client, function_name, args=None):
    return client.read_contract(
        address=CONTRACT,
        function_name=function_name,
        args=args or [],
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL,
    )


@pytest.mark.integration
def test_deployment_transaction_is_finalized(live):
    if not DEPLOYMENT_TX:
        pytest.skip("SENTINELPACT_DEPLOYMENT_TX is not set")
    transaction = live.get_transaction(DEPLOYMENT_TX)
    status = transaction.get("status_name", transaction.get("status"))
    status = getattr(status, "value", status)
    assert status in ("FINALIZED", 7, "7")
    print(f"deployment_tx={DEPLOYMENT_TX} status={status}")


@pytest.mark.integration
def test_contract_stats_and_accounting(live):
    stats = read(live, "get_stats")
    assert stats["product"] == "SentinelPact"
    assert stats["version"] == "1.1.0-studionet"
    assert stats["network"] == "Studionet"
    assert stats["chain_id"] == "61999"
    assert stats["rpc"] == RPC
    assert stats["accounting_balanced"] is True
    assert stats["admin_controls"] is False
    assert stats["max_adjudication_rounds"] == "3"
    assert stats["authoritative_families"] == "GITHUB_ADVISORY,NVD,CISA,PACKAGE_REGISTRY"

    deposited = int(stats["total_deposited_atto"])
    accounted = sum(
        int(stats[key])
        for key in (
            "warranty_escrow_atto",
            "evidence_escrow_atto",
            "payout_reserve_atto",
            "claimable_atto",
            "withdrawn_atto",
        )
    )
    assert deposited == accounted
    print(
        "stats="
        f"deposited:{deposited},"
        f"warranty_escrow:{stats['warranty_escrow_atto']},"
        f"evidence_escrow:{stats['evidence_escrow_atto']},"
        f"payout_reserve:{stats['payout_reserve_atto']},"
        f"claimable:{stats['claimable_atto']},"
        f"withdrawn:{stats['withdrawn_atto']},"
        f"balanced:{stats['accounting_balanced']}"
    )


@pytest.mark.integration
def test_registry_reads_have_expected_shape(live):
    releases = read(live, "list_releases", [0, 25])
    warranties = read(live, "list_warranties", [0, 25])

    assert isinstance(releases, dict)
    assert isinstance(releases["items"], list)
    assert int(releases["total"]) >= len(releases["items"])
    assert isinstance(warranties, dict)
    assert isinstance(warranties["items"], list)
    assert int(warranties["total"]) >= len(warranties["items"])

    for row in releases["items"]:
        assert row["release_id"].startswith("sp-rel-")
        assert row["publisher"].startswith("0x")
    for row in warranties["items"]:
        assert row["warranty_id"].startswith("sp-war-")
        assert row["release_id"].startswith("sp-rel-")

    print(f"registry=releases:{releases['total']},warranties:{warranties['total']}")


@pytest.mark.integration
def test_repeated_latest_final_reads_are_stable(live):
    first = read(live, "get_stats")
    second = read(live, "get_stats")
    stable_fields = (
        "product",
        "version",
        "network",
        "chain_id",
        "rpc",
        "total_deposited_atto",
        "warranty_escrow_atto",
        "evidence_escrow_atto",
        "payout_reserve_atto",
        "claimable_atto",
        "withdrawn_atto",
        "accounting_balanced",
    )
    assert {key: first[key] for key in stable_fields} == {key: second[key] for key in stable_fields}

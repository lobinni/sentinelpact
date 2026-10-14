"""Direct Mode tests for the SentinelPact intelligent contract.

These tests run the contract in the GenVM Direct Mode runner. Web traffic and
LLM responses are mocked per test so behavior is fully deterministic. The
fixture set (direct_vm, direct_deploy, direct_alice, ...) is provided by the
pinned genlayer-test runner; see docs/TESTING.md for the exact harness setup.
"""

import hashlib
import json
import sys
from datetime import datetime, timezone

import pytest


NOW = 2_000_000_000
BOND = 10**18
EVIDENCE_BOND = 10**15
DIGEST = "ab" * 32
SALT = "cd" * 32


def addr(value):
    raw = value.as_bytes if hasattr(value, "as_bytes") else value
    if isinstance(raw, bytes):
        return "0x" + raw.hex()
    if hasattr(value, "as_hex"):
        return value.as_hex
    return str(value)


def contract_module():
    for name, module in list(sys.modules.items()):
        if name.startswith("_contract") and module:
            return module
    return None


def warp(vm, unix):
    value = datetime.fromtimestamp(unix, timezone.utc).isoformat()
    vm.warp(value)
    module = contract_module()
    if module:
        module.gl.message_raw["datetime"] = value


@pytest.fixture(autouse=True)
def fixed_clock(direct_vm):
    warp(direct_vm, NOW)


def pack(parts):
    return "".join(f"{len(part)}:{part}" for part in parts)


def commitment(vm, incident_id, submitter, family, url, fact, salt=SALT):
    return hashlib.sha256(
        pack(
            [
                "sentinelpact-evidence-v1",
                "61999",
                addr(vm._contract_address).lower(),
                incident_id,
                addr(submitter).lower(),
                family,
                url,
                fact,
                salt,
            ]
        ).encode()
    ).hexdigest()


def mock_llm(vm, result):
    vm.clear_mocks()
    vm.mock_llm(r"(?s).*", json.dumps(result))


def mock_source(vm, body="Security advisory body"):
    vm.mock_web(r"(?s).*", {"status": 200, "body": body})


def source_result(**changes):
    base = {
        "source_available": True,
        "family_matches": True,
        "same_package": True,
        "material": True,
        "publication_in_window": True,
        "version_discussed": True,
        "release_affected": True,
        "severity_qualifies": True,
        "class_matches": True,
        "exclusion_applies": False,
        "advisory_id": "CVE-2099-0001",
        "affected_range": ">=3.7.0 <=3.7.4",
        "basis": "The advisory names the package, affected range, critical severity, and remote execution condition.",
    }
    base.update(changes)
    return base


def breach_result(**changes):
    base = {
        "affected_release": True,
        "disclosure_in_window": True,
        "severity_qualifies": True,
        "class_matches": True,
        "exclusion_applies": False,
        "evidence_consistent": True,
        "verdict": "BREACHED",
        "basis": "Two distinct source families establish the covered release and warranty conditions.",
    }
    base.update(changes)
    return base


def setup_release_and_warranty(vm, contract, publisher):
    vm.sender = publisher
    release_id = contract.register_release(
        "npm",
        "@demo/parser",
        "3.7.4",
        DIGEST,
        "https://example.com/releases/3.7.4",
    )
    vm.value = BOND
    try:
        warranty_id = contract.open_warranty(
            release_id,
            "Critical RCE warranty",
            "CVSS >= 9.0 or explicitly classified CRITICAL",
            "remote code execution",
            "local-admin-only, development-only dependency, unsupported fork",
            500,
            NOW + 600,
            NOW + 7200,
            1800,
            2,
            2,
            EVIDENCE_BOND,
        )
    finally:
        vm.value = 0
    return release_id, warranty_id


def open_incident(vm, contract, warranty_id, opener):
    warp(vm, NOW + 601)
    vm.sender = opener
    return contract.open_incident(warranty_id, "Potential critical RCE", "CVE-2099-0001")


def submit_verified(vm, contract, incident_id, submitter, family, url, fact):
    digest = commitment(vm, incident_id, submitter, family, url, fact)
    vm.sender = submitter
    vm.value = EVIDENCE_BOND
    try:
        evidence_id = contract.commit_evidence(incident_id, digest)
    finally:
        vm.value = 0
    contract.reveal_evidence(evidence_id, family, url, fact, SALT)
    vm.sender = vm._contract_address
    mock_llm(vm, source_result())
    contract.evaluate_evidence(evidence_id)
    return evidence_id


SETTLEMENT_AT = NOW + 601 + 1800 + 1


def enter_settlement(vm):
    """Advance past the evidence deadline so settlement may run."""
    warp(vm, SETTLEMENT_AT)


def adjudicate_breach(vm, contract, incident_id):
    enter_settlement(vm)
    vm.sender = vm._contract_address
    mock_llm(vm, breach_result())
    return contract.adjudicate_incident(incident_id)


# ---------------------------------------------------------------- tests ----


def test_release_and_warranty_are_funded_records(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy
    release_id, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)

    release = contract.get_release(release_id)
    assert release["package_name"] == "@demo/parser"
    assert release["warranty_count"] == "1"

    warranty = contract.get_warranty(warranty_id)
    assert warranty["status"] == "OPEN"
    assert warranty["bond_atto"] == str(BOND)
    assert warranty["publisher"] == addr(direct_alice)

    stats = contract.get_stats()
    assert stats["warranty_escrow_atto"] == str(BOND)
    assert stats["accounting_balanced"] is True


def test_only_release_publisher_can_open_warranty(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    release_id, _ = setup_release_and_warranty(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_bob
    direct_vm.value = BOND
    try:
        with pytest.raises(Exception, match="only release publisher"):
            contract.open_warranty(
                release_id, "t", "sev", "cls", "exc", 500, NOW + 600, NOW + 7200, 1800, 2, 2, EVIDENCE_BOND
            )
    finally:
        direct_vm.value = 0


def test_coverage_premium_and_capacity(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)

    coverage = BOND // 2
    premium = (coverage * 500 + 9999) // 10000
    direct_vm.sender = direct_bob
    direct_vm.value = premium
    try:
        contract.buy_coverage(warranty_id, coverage)
    finally:
        direct_vm.value = 0

    position = contract.get_coverage(warranty_id, addr(direct_bob))
    assert position["coverage_atto"] == str(coverage)
    assert contract.get_credit(addr(direct_alice)) == str(premium)

    remaining = BOND - coverage
    with pytest.raises(Exception, match="exceeds remaining bond capacity"):
        direct_vm.value = (remaining * 500 + 9999) // 10000
        try:
            contract.buy_coverage(warranty_id, remaining + 1)
        finally:
            direct_vm.value = 0


def test_incident_cannot_open_until_coverage_closes(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="coverage closes"):
        contract.open_incident(warranty_id, "too early", "none")


def test_commitment_binds_chain_contract_incident_wallet_and_source(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)

    digest = commitment(direct_vm, incident_id, direct_bob, "NVD", "https://nvd.nist.gov/vuln/detail/CVE-2099-0003", "fact")
    direct_vm.sender = direct_bob
    direct_vm.value = EVIDENCE_BOND
    try:
        evidence_id = contract.commit_evidence(incident_id, digest)
    finally:
        direct_vm.value = 0

    with pytest.raises(Exception, match="does not match commitment"):
        contract.reveal_evidence(evidence_id, "NVD", "https://nvd.nist.gov/vuln/detail/CVE-2099-0099", "fact", SALT)


def test_verified_source_returns_bond_and_records_fields(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    evidence_id = submit_verified(
        direct_vm, contract, incident_id, direct_bob, "NVD", "https://nvd.nist.gov/vuln/detail/CVE-2099-0001", "The release is affected"
    )

    item = contract.get_evidence(evidence_id)
    assert item["status"] == "VERIFIED"
    assert item["advisory_id"] == "CVE-2099-0001"
    assert item["bond_atto"] == "0"
    assert contract.get_credit(addr(direct_bob)) == str(EVIDENCE_BOND)

    incident = contract.get_incident(incident_id)
    assert incident["verified_count"] == "1"
    assert "NVD" in incident["verified_families"]


def test_source_unavailable_is_retryable_non_decision(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)

    digest = commitment(direct_vm, incident_id, direct_bob, "CISA", "https://www.cisa.gov/news-events/alerts/example", "fact")
    direct_vm.sender = direct_bob
    direct_vm.value = EVIDENCE_BOND
    try:
        evidence_id = contract.commit_evidence(incident_id, digest)
    finally:
        direct_vm.value = 0
    contract.reveal_evidence(evidence_id, "CISA", "https://www.cisa.gov/news-events/alerts/example", "fact", SALT)

    direct_vm.sender = direct_vm._contract_address
    mock_llm(direct_vm, source_result(source_available=False, basis="The source could not be fetched successfully."))
    contract.evaluate_evidence(evidence_id)

    item = contract.get_evidence(evidence_id)
    assert item["status"] == "SOURCE_UNAVAILABLE"
    assert contract.get_credit(addr(direct_bob)) == str(EVIDENCE_BOND)

    direct_vm.sender = direct_alice
    contract.retry_evidence(evidence_id)
    assert contract.get_evidence(evidence_id)["status"] == "PENDING_SOURCE"


def test_invalid_source_bond_goes_to_publisher(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)

    digest = commitment(direct_vm, incident_id, direct_bob, "VENDOR", "https://vendor.example/blog", "fact")
    direct_vm.sender = direct_bob
    direct_vm.value = EVIDENCE_BOND
    try:
        evidence_id = contract.commit_evidence(incident_id, digest)
    finally:
        direct_vm.value = 0
    contract.reveal_evidence(evidence_id, "VENDOR", "https://vendor.example/blog", "fact", SALT)

    direct_vm.sender = direct_vm._contract_address
    mock_llm(direct_vm, source_result(material=False, basis="Unrelated marketing post."))
    contract.evaluate_evidence(evidence_id)

    assert contract.get_evidence(evidence_id)["status"] == "INVALID_SOURCE"
    assert contract.get_credit(addr(direct_alice)) == str(EVIDENCE_BOND)


def test_breach_moves_bond_to_payout_reserve(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)

    coverage = BOND // 4
    premium = (coverage * 500 + 9999) // 10000
    direct_vm.sender = direct_charlie
    direct_vm.value = premium
    try:
        contract.buy_coverage(warranty_id, coverage)
    finally:
        direct_vm.value = 0

    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", "https://nvd.nist.gov/vuln/detail/CVE-2099-0001", "affected")
    submit_verified(direct_vm, contract, incident_id, direct_alice, "CISA", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", "affected")

    verdict = adjudicate_breach(direct_vm, contract, incident_id)
    assert verdict == "BREACHED"

    warranty = contract.get_warranty(warranty_id)
    assert warranty["status"] == "BREACHED"
    assert warranty["payout_reserve_atto"] == str(coverage)

    stats = contract.get_stats()
    assert stats["payout_reserve_atto"] == str(coverage)
    assert stats["warranty_escrow_atto"] == "0"
    assert stats["accounting_balanced"] is True


def test_coverage_holder_claims_breach_payout(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)

    coverage = BOND // 4
    premium = (coverage * 500 + 9999) // 10000
    direct_vm.sender = direct_charlie
    direct_vm.value = premium
    try:
        contract.buy_coverage(warranty_id, coverage)
    finally:
        direct_vm.value = 0

    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", "https://nvd.nist.gov/vuln/detail/CVE-2099-0001", "affected")
    submit_verified(direct_vm, contract, incident_id, direct_alice, "CISA", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", "affected")
    adjudicate_breach(direct_vm, contract, incident_id)

    direct_vm.sender = direct_charlie
    contract.claim_breach_payout(warranty_id, addr(direct_charlie))
    assert contract.get_credit(addr(direct_charlie)) == str(coverage)

    with pytest.raises(Exception, match="already claimed"):
        contract.claim_breach_payout(warranty_id, addr(direct_charlie))


def test_inconclusive_keeps_incident_open_and_moves_no_money(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", "https://nvd.nist.gov/vuln/detail/CVE-2099-0001", "affected")
    submit_verified(direct_vm, contract, incident_id, direct_alice, "CISA", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", "affected")

    enter_settlement(direct_vm)
    direct_vm.sender = direct_vm._contract_address
    mock_llm(direct_vm, breach_result(evidence_consistent=False, verdict="INCONCLUSIVE"))
    verdict = contract.adjudicate_incident(incident_id)

    assert verdict == "INCONCLUSIVE"
    assert contract.get_incident(incident_id)["status"] == "OPEN"
    assert contract.get_warranty(warranty_id)["status"] == "OPEN"
    assert contract.get_stats()["payout_reserve_atto"] == "0"


def test_warranty_expiry_returns_bond(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)
    warp(direct_vm, NOW + 7201)
    contract.expire_warranty(warranty_id)

    warranty = contract.get_warranty(warranty_id)
    assert warranty["status"] == "EXPIRED"
    assert contract.get_credit(addr(direct_alice)) == str(BOND)
    assert contract.get_stats()["accounting_balanced"] is True


def test_unrevealed_evidence_expires_to_publisher(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)

    digest = commitment(direct_vm, incident_id, direct_bob, "NVD", "https://nvd.nist.gov/vuln/detail/CVE-2099-0001", "fact")
    direct_vm.sender = direct_bob
    direct_vm.value = EVIDENCE_BOND
    try:
        evidence_id = contract.commit_evidence(incident_id, digest)
    finally:
        direct_vm.value = 0

    warp(direct_vm, NOW + 601 + 16 * 60)
    contract.expire_unrevealed_evidence(evidence_id)

    item = contract.get_evidence(evidence_id)
    assert item["status"] == "UNREVEALED"
    assert contract.get_credit(addr(direct_alice)) == str(EVIDENCE_BOND)


def test_source_family_diversity_required(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy
    _, warranty_id = setup_release_and_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", "https://nvd.nist.gov/vuln/detail/CVE-2099-0011", "affected")
    submit_verified(direct_vm, contract, incident_id, direct_alice, "NVD", "https://nvd.nist.gov/vuln/detail/CVE-2099-0012", "affected")

    enter_settlement(direct_vm)
    with pytest.raises(Exception, match="source-family diversity"):
        contract.adjudicate_incident(incident_id)

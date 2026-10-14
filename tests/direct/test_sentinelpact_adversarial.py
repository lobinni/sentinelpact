"""Adversarial Direct Mode tests for the corrected SentinelPact lifecycle.

Each test targets one security-critical control:

  1. Irreversible adjudication cannot run before every timely evidence item had
     a chance to arrive and finish examination, and expiry cannot bypass a
     pending evaluation.
  2. Authoritative evidence sources are authenticated on-chain, and unchanged
     evidence cannot buy fresh verdict attempts across incidents.
  3. GEN withdrawals reconcile safely when a transfer fails or stays ambiguous.

The harness mirrors tests/direct/test_sentinelpact.py: web and LLM access are
mocked per test, and time is advanced deterministically with `warp`.
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

INCIDENT_WINDOW = 1800
INCIDENT_OPENED_AT = NOW + 601
EVIDENCE_DEADLINE = INCIDENT_OPENED_AT + INCIDENT_WINDOW
PENDING_EVIDENCE_TIMEOUT = 5 * 60
LEGACY_GRACE = 30 * 60
WITHDRAWAL_TIMEOUT = 15 * 60

# Hosts the contract accepts for each authoritative family.
NVD_URL = "https://nvd.nist.gov/vuln/detail/CVE-2099-0001"
NVD_URL_ALT = "https://nvd.nist.gov/vuln/detail/CVE-2099-0002"
CISA_URL = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"
GHSA_URL = "https://github.com/advisories/GHSA-2099-aaaa-bbbb"
VENDOR_URL = "https://vendor.example/security/advisory-1"
RESEARCH_URL = "https://research.example/reports/finding-1"
SPOOFED_NVD_URL = "https://nvd-nist-gov.attacker.example/vuln/detail/CVE-2099-0001"


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
    vm.mock_web(r"(?s).*", {"status": 200, "body": "Security advisory body"})


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
        "basis": "The advisory names the package, affected range, severity, and remote execution condition.",
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
        "basis": "Two distinct authenticated source families establish every warranty condition.",
    }
    base.update(changes)
    return base


def setup_warranty(vm, contract, publisher, version="3.7.4"):
    vm.sender = publisher
    release_id = contract.register_release(
        "npm", "@demo/parser", version, DIGEST, "https://example.com/releases/" + version
    )
    vm.value = BOND
    try:
        warranty_id = contract.open_warranty(
            release_id,
            "Critical RCE warranty",
            "CVSS >= 9.0 or explicitly classified CRITICAL",
            "remote code execution",
            "local-admin-only, development-only dependency",
            500,
            NOW + 600,
            NOW + 7200,
            INCIDENT_WINDOW,
            2,
            2,
            EVIDENCE_BOND,
        )
    finally:
        vm.value = 0
    return release_id, warranty_id


def open_incident(vm, contract, warranty_id, opener, at=INCIDENT_OPENED_AT):
    warp(vm, at)
    vm.sender = opener
    return contract.open_incident(warranty_id, "Potential critical RCE", "CVE-2099-0001")


def commit_and_reveal(vm, contract, incident_id, submitter, family, url, fact):
    """Commit + reveal, leaving the item PENDING_SOURCE (examination in flight)."""
    digest = commitment(vm, incident_id, submitter, family, url, fact)
    vm.sender = submitter
    vm.value = EVIDENCE_BOND
    try:
        evidence_id = contract.commit_evidence(incident_id, digest)
    finally:
        vm.value = 0
    contract.reveal_evidence(evidence_id, family, url, fact, SALT)
    return evidence_id


def examine(vm, contract, evidence_id, result=None):
    vm.sender = vm._contract_address
    mock_llm(vm, result or source_result())
    contract.evaluate_evidence(evidence_id)


def submit_verified(vm, contract, incident_id, submitter, family, url, fact):
    evidence_id = commit_and_reveal(vm, contract, incident_id, submitter, family, url, fact)
    examine(vm, contract, evidence_id)
    return evidence_id


def enter_settlement(vm, offset=1):
    """Advance past the evidence deadline into the settlement phase."""
    warp(vm, EVIDENCE_DEADLINE + offset)


# ---------------------------------------------------------------------------
# 1. Irreversible adjudication / expiry vs. pending evaluations
# ---------------------------------------------------------------------------


def test_adjudication_is_blocked_while_the_evidence_window_is_open(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """A verdict must never be rushed while timely evidence can still arrive."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", NVD_URL, "affected")
    submit_verified(direct_vm, contract, incident_id, direct_alice, "CISA", CISA_URL, "affected")

    incident = contract.get_incident(incident_id)
    assert incident["verified_count"] == "2"
    assert incident["evidence_window_closed"] is False
    assert incident["settlement_ready"] is False

    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="after the evidence window closes"):
        contract.adjudicate_incident(incident_id)

    # The warranty is untouched: no reserve, no closure.
    assert contract.get_warranty(warranty_id)["status"] == "OPEN"
    assert contract.get_stats()["payout_reserve_atto"] == "0"


def test_adjudication_is_blocked_while_an_examination_is_pending(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Settlement waits for every in-flight examination, even after the deadline."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", NVD_URL, "affected")
    submit_verified(direct_vm, contract, incident_id, direct_alice, "CISA", CISA_URL, "affected")
    # A third item is revealed but never examined — it stays in flight.
    commit_and_reveal(direct_vm, contract, incident_id, direct_bob, "GITHUB_ADVISORY", GHSA_URL, "affected")

    enter_settlement(direct_vm)
    assert contract.get_incident(incident_id)["pending_evidence"] == "1"

    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="pending evidence evaluations must resolve before adjudication"):
        contract.adjudicate_incident(incident_id)


def test_expiry_cannot_bypass_a_pending_evaluation(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Expiry always waits for in-flight examinations; there is no time bypass."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    evidence_id = commit_and_reveal(
        direct_vm, contract, incident_id, direct_bob, "NVD", NVD_URL, "affected"
    )

    enter_settlement(direct_vm)
    assert contract.get_incident(incident_id)["pending_evidence"] == "1"

    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="pending evidence must be resolved individually before expiry"):
        contract.expire_incident(incident_id)

    # Resolving the examination normally unblocks expiry.
    examine(direct_vm, contract, evidence_id)
    assert contract.get_incident(incident_id)["pending_evidence"] == "0"
    direct_vm.sender = direct_bob
    contract.expire_incident(incident_id)
    assert contract.get_incident(incident_id)["status"] == "EXPIRED"


def test_even_after_thirty_minutes_expiry_cannot_close_over_pending_evidence(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Regression: the old 30-minute grace must never make pending evidence discardable."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    evidence_id = commit_and_reveal(
        direct_vm, contract, incident_id, direct_bob, "NVD", NVD_URL, "affected"
    )

    # Far beyond both the old grace and the explicit stalled-evidence timeout.
    warp(direct_vm, EVIDENCE_DEADLINE + LEGACY_GRACE + 1)
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="pending evidence must be resolved individually before expiry"):
        contract.expire_incident(incident_id)

    # The only liveness path resolves this one item explicitly and audibly.
    contract.expire_stalled_evidence(evidence_id)
    evidence = contract.get_evidence(evidence_id)
    assert evidence["status"] == "STALLED_SOURCE"
    assert contract.get_incident(incident_id)["pending_evidence"] == "0"

    contract.expire_incident(incident_id)
    incident = contract.get_incident(incident_id)
    assert incident["status"] == "EXPIRED"
    assert incident["last_verdict"] == "INCONCLUSIVE"
    assert contract.get_warranty(warranty_id)["active_incident_id"] == ""


def test_settlement_phase_allows_a_single_clean_adjudication(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """The corrected happy path: settle only after the window closed and all work resolved."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)

    coverage = BOND // 4
    premium = (coverage * 500 + 9999) // 10000
    direct_vm.sender = direct_charlie
    direct_vm.value = premium
    try:
        contract.buy_coverage(warranty_id, coverage)
    finally:
        direct_vm.value = 0

    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", NVD_URL, "affected")
    submit_verified(direct_vm, contract, incident_id, direct_alice, "CISA", CISA_URL, "affected")

    enter_settlement(direct_vm)
    incident = contract.get_incident(incident_id)
    assert incident["settlement_ready"] is True

    direct_vm.sender = direct_vm._contract_address
    mock_llm(direct_vm, breach_result())
    assert contract.adjudicate_incident(incident_id) == "BREACHED"

    warranty = contract.get_warranty(warranty_id)
    assert warranty["status"] == "BREACHED"
    assert warranty["payout_reserve_atto"] == str(coverage)
    assert warranty["adjudication_attempts"] == "1"
    assert contract.get_stats()["accounting_balanced"] is True


# ---------------------------------------------------------------------------
# 2. Authoritative source authentication + cross-incident verdict grinding
# ---------------------------------------------------------------------------


def test_spoofed_authoritative_host_is_rejected_on_reveal(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Declaring NVD is meaningless unless the URL is actually on an NVD host."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)

    digest = commitment(direct_vm, incident_id, direct_bob, "NVD", SPOOFED_NVD_URL, "spoofed")
    direct_vm.sender = direct_bob
    direct_vm.value = EVIDENCE_BOND
    try:
        evidence_id = contract.commit_evidence(incident_id, digest)
    finally:
        direct_vm.value = 0

    with pytest.raises(Exception, match="official NVD host"):
        contract.reveal_evidence(evidence_id, "NVD", SPOOFED_NVD_URL, "spoofed", SALT)

    # The attempt is not free: the bond stays locked and is slashed on expiry.
    assert contract.get_evidence(evidence_id)["status"] == "COMMITTED"


def test_authoritative_subdomains_are_accepted(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Legitimate subdomains of an authority still authenticate."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    evidence_id = submit_verified(
        direct_vm,
        contract,
        incident_id,
        direct_bob,
        "CISA",
        "https://www.cisa.gov/news-events/alerts/2099/01/01/example",
        "affected",
    )
    item = contract.get_evidence(evidence_id)
    assert item["status"] == "VERIFIED"
    assert item["source_host"] == "cisa.gov"


def test_self_authorable_sources_cannot_settle_a_breach(direct_vm, direct_deploy, direct_alice, direct_bob):
    """VENDOR + SECURITY_RESEARCH are both self-publishable and cannot settle alone."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "VENDOR", VENDOR_URL, "self-authored")
    submit_verified(
        direct_vm, contract, incident_id, direct_alice, "SECURITY_RESEARCH", RESEARCH_URL, "self-authored"
    )

    enter_settlement(direct_vm)
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="independent authority"):
        contract.adjudicate_incident(incident_id)


def test_same_evidence_cannot_be_replayed_into_a_new_incident(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Unchanged evidence cannot buy a fresh verdict attempt in another incident."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)

    first_incident = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, first_incident, direct_bob, "NVD", NVD_URL, "affected")

    enter_settlement(direct_vm)
    direct_vm.sender = direct_bob
    contract.expire_incident(first_incident)
    assert contract.get_incident(first_incident)["status"] == "EXPIRED"

    # A fresh incident on the same warranty cannot reuse that exact source.
    second_opened_at = EVIDENCE_DEADLINE + 10
    direct_vm.sender = direct_bob
    second_incident = contract.open_incident(warranty_id, "Second attempt", "same advisory")

    digest = commitment(direct_vm, second_incident, direct_bob, "NVD", NVD_URL, "affected")
    direct_vm.sender = direct_bob
    direct_vm.value = EVIDENCE_BOND
    try:
        evidence_id = contract.commit_evidence(second_incident, digest)
    finally:
        direct_vm.value = 0

    with pytest.raises(Exception, match="canonical source already used for this warranty"):
        contract.reveal_evidence(evidence_id, "NVD", NVD_URL, "affected", SALT)
    assert second_opened_at > 0


def test_url_spelling_variants_share_one_canonical_replay_key(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Query, fragment, host case, port, slash and percent variants cannot replay a source."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", NVD_URL, "affected")

    variant = (
        "https://WWW.NVD.NIST.GOV:443/vuln//detail/./"
        "CVE%2d2099%2d0001/?utm_source=replay#summary"
    )
    digest = commitment(direct_vm, incident_id, direct_alice, "NVD", variant, "affected")
    direct_vm.sender = direct_alice
    direct_vm.value = EVIDENCE_BOND
    try:
        evidence_id = contract.commit_evidence(incident_id, digest)
    finally:
        direct_vm.value = 0

    with pytest.raises(Exception, match="canonical source already used for this warranty"):
        contract.reveal_evidence(evidence_id, "NVD", variant, "affected", SALT)

    first = contract.get_evidence("sp-ev-1")
    assert first["canonical_source"] == "https://nvd.nist.gov/vuln/detail/cve-2099-0001"


def test_alternate_urls_for_the_same_advisory_are_semantically_deduplicated(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Even genuinely different URLs cannot replay one advisory in the same family."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", NVD_URL, "affected")

    alternate = "https://nvd.nist.gov/vuln/detail/index.html?id=CVE-2099-0001"
    duplicate_id = commit_and_reveal(
        direct_vm, contract, incident_id, direct_alice, "NVD", alternate, "same advisory"
    )
    # The source examiner independently extracts the same advisory ID.
    examine(direct_vm, contract, duplicate_id, source_result(advisory_id="cve 2099 0001"))

    duplicate = contract.get_evidence(duplicate_id)
    assert duplicate["status"] == "DUPLICATE_SOURCE"
    assert duplicate["source_fingerprint"] == "NVD:cve20990001"
    assert contract.get_incident(incident_id)["verified_count"] == "1"


def test_repeated_adjudication_requires_new_verified_evidence(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """An INCONCLUSIVE round cannot simply be re-rolled over the same evidence."""
    contract = direct_deploy
    _, warranty_id = setup_warranty(direct_vm, contract, direct_alice)
    incident_id = open_incident(direct_vm, contract, warranty_id, direct_bob)
    submit_verified(direct_vm, contract, incident_id, direct_bob, "NVD", NVD_URL, "affected")
    submit_verified(direct_vm, contract, incident_id, direct_alice, "CISA", CISA_URL, "affected")

    enter_settlement(direct_vm)
    direct_vm.sender = direct_vm._contract_address
    mock_llm(direct_vm, breach_result(evidence_consistent=False, verdict="INCONCLUSIVE"))
    assert contract.adjudicate_incident(incident_id) == "INCONCLUSIVE"

    incident = contract.get_incident(incident_id)
    assert incident["adjudication_rounds"] == "1"
    assert incident["last_round_verified_count"] == "2"
    # The attempt is also charged against the warranty-wide budget.
    assert contract.get_warranty(warranty_id)["adjudication_attempts"] == "1"

    with pytest.raises(Exception, match="add new verified evidence"):
        contract.adjudicate_incident(incident_id)


# ---------------------------------------------------------------------------
# 3. Safe GEN withdrawal reconciliation
# ---------------------------------------------------------------------------


def credit_publisher(vm, contract, publisher, buyer):
    """Give the publisher withdrawable credit through a coverage premium."""
    _, warranty_id = setup_warranty(vm, contract, publisher)
    coverage = BOND // 4
    premium = (coverage * 500 + 9999) // 10000
    vm.sender = buyer
    vm.value = premium
    try:
        contract.buy_coverage(warranty_id, coverage)
    finally:
        vm.value = 0
    return warranty_id, premium


def test_withdrawal_moves_credit_into_an_auditable_in_flight_record(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Phase one debits credit and tracks the amount as in-flight, never as lost."""
    contract = direct_deploy
    _, premium = credit_publisher(direct_vm, contract, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    withdrawal_id = contract.withdraw_credit(addr(direct_alice))

    record = contract.get_withdrawal(withdrawal_id)
    assert record["status"] == "PENDING"
    assert record["amount_atto"] == str(premium)

    stats = contract.get_stats()
    assert stats["claimable_atto"] == "0"
    assert stats["withdrawal_in_flight_atto"] == str(premium)
    assert stats["withdrawn_atto"] == "0"
    assert stats["accounting_balanced"] is True
    assert contract.get_credit(addr(direct_alice)) == "0"


def test_successful_dispatch_settles_the_withdrawal(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Phase two moves the in-flight amount into withdrawn, keeping books balanced."""
    contract = direct_deploy
    _, premium = credit_publisher(direct_vm, contract, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    withdrawal_id = contract.withdraw_credit(addr(direct_alice))

    direct_vm.sender = direct_vm._contract_address
    contract.dispatch_withdrawal(withdrawal_id)

    record = contract.get_withdrawal(withdrawal_id)
    assert record["status"] == "SETTLED"

    stats = contract.get_stats()
    assert stats["withdrawal_in_flight_atto"] == "0"
    assert stats["withdrawn_atto"] == str(premium)
    assert stats["accounting_balanced"] is True


def test_ambiguous_dispatch_is_reconciled_back_into_credit(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """If dispatch never reports an outcome, the value returns to withdrawable credit."""
    contract = direct_deploy
    _, premium = credit_publisher(direct_vm, contract, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    withdrawal_id = contract.withdraw_credit(addr(direct_alice))
    assert contract.get_withdrawal(withdrawal_id)["status"] == "PENDING"

    # Too early: the reconciliation window has not opened yet.
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="reconciliation window has not opened"):
        contract.reconcile_withdrawal(withdrawal_id)

    warp(direct_vm, NOW + WITHDRAWAL_TIMEOUT + 1)
    direct_vm.sender = direct_bob
    contract.reconcile_withdrawal(withdrawal_id)

    record = contract.get_withdrawal(withdrawal_id)
    assert record["status"] == "FAILED"

    stats = contract.get_stats()
    assert stats["withdrawal_in_flight_atto"] == "0"
    assert stats["withdrawn_atto"] == "0"
    assert stats["claimable_atto"] == str(premium)
    assert stats["accounting_balanced"] is True
    # The owner can simply withdraw again.
    assert contract.get_credit(addr(direct_alice)) == str(premium)


def test_reconciled_withdrawal_cannot_be_double_spent(direct_vm, direct_deploy, direct_alice, direct_bob):
    """A reconciled record is terminal: neither dispatch nor reconcile may re-run."""
    contract = direct_deploy
    credit_publisher(direct_vm, contract, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    withdrawal_id = contract.withdraw_credit(addr(direct_alice))
    warp(direct_vm, NOW + WITHDRAWAL_TIMEOUT + 1)
    direct_vm.sender = direct_bob
    contract.reconcile_withdrawal(withdrawal_id)

    with pytest.raises(Exception, match="withdrawal is not pending"):
        contract.reconcile_withdrawal(withdrawal_id)

    direct_vm.sender = direct_vm._contract_address
    with pytest.raises(Exception, match="withdrawal is not pending"):
        contract.dispatch_withdrawal(withdrawal_id)

    assert contract.get_stats()["accounting_balanced"] is True

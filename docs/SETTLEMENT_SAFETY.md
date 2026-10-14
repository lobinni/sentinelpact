# Settlement safety — corrected lifecycle response

This document addresses the security review for SentinelPact
`2.1.0-studionet`. The canonical deployment is
[`0xD61eFb765F260F4D191C359D7a7413fcb59162Bf`](https://explorer-studio.genlayer.com/address/0xD61eFb765F260F4D191C359D7a7413fcb59162Bf)
on GenLayer Studionet (chain `61999`).

The release closes both issues raised in the follow-up review:

1. Incident expiry has **no time-based bypass** for pending evidence.
2. Replay identity is **not a raw URL hash**; it combines aggressive URL
   canonicalization with a semantic advisory fingerprint.

---

## 1. Irreversible settlement and expiry both require a complete evidence set

### Adjudication gate

`adjudicate_incident` is irreversible when it returns `BREACHED` or
`NOT_AFFECTED`. It therefore requires:

- the incident is still `OPEN`;
- the evidence window has closed; and
- `pending_evidence == 0`.

`pending_evidence` counts every timely item that is still `COMMITTED` or
`PENDING_SOURCE`. It increments on commit/retry and decrements exactly once when
an item reaches a terminal state.

### Expiry gate — no grace bypass

`expire_incident` enforces the same completeness condition:

```python
_require(
    int(incident.pending_evidence) > 0,
    "[EXPECTED] pending evidence must be resolved individually before expiry",
)
```

This condition has no timestamp exception. Waiting 5 minutes, 30 minutes, one
day, or longer never makes pending evidence silently discardable. The targeted
regression test advances beyond the former 30-minute boundary and proves that
expiry still rejects.

### Explicit liveness path for a stalled callback

A pending callback must be resolved as its own transaction:

```text
expire_stalled_evidence(evidence_id)
```

It is available five minutes after `revealed_at` and only for
`PENDING_SOURCE`. It:

1. records `STALLED_SOURCE` permanently on that evidence item;
2. records an examination-timeout basis;
3. refunds any remaining evidence bond to the submitter;
4. releases the evidence-capacity slot; and
5. decrements `pending_evidence` exactly once.

It cannot close an incident, produce a verdict, or create a payout reserve.
Only after every pending item was resolved normally, expired unrevealed, or
explicitly marked stalled may incident expiry proceed.

### Targeted tests

- `test_adjudication_is_blocked_while_the_evidence_window_is_open`
- `test_adjudication_is_blocked_while_an_examination_is_pending`
- `test_expiry_cannot_bypass_a_pending_evaluation`
- `test_even_after_thirty_minutes_expiry_cannot_close_over_pending_evidence`
- `test_settlement_phase_allows_a_single_clean_adjudication`

---

## 2. Authoritative source authentication

A declared family is never accepted by label alone. For authoritative families,
`reveal_evidence` and the commitment-preview view authenticate the URL host
against an immutable on-chain allowlist:

| Family | Operator hosts |
| --- | --- |
| `GITHUB_ADVISORY` | `github.com`, `api.github.com` |
| `NVD` | `nvd.nist.gov`, `services.nvd.nist.gov` |
| `CISA` | `cisa.gov` and true subdomains |
| `PACKAGE_REGISTRY` | npm, PyPI, crates.io, RubyGems, Packagist, NuGet, pkg.go.dev, Hex |

Hostname parsing lowercases, strips credentials, normalizes the `www` alias,
and verifies an exact host or true dot-boundary subdomain. A lookalike such as
`nvd-nist-gov.attacker.example` cannot pass.

`VENDOR` and `SECURITY_RESEARCH` are explicitly self-publishable. They may
corroborate but cannot settle a breach alone; adjudication requires at least one
verified authoritative family.

---

## 3. URL-variant and semantic replay protection

### Why a raw URL hash was insufficient

These spellings can identify the same source while producing different raw
hashes:

```text
https://NVD.NIST.GOV:443/vuln/detail/CVE-2099-0001
https://www.nvd.nist.gov/vuln//detail/./CVE%2d2099%2d0001/?utm_source=x#summary
```

### Canonical source identity

Before reserving a warranty-wide source key, the contract deterministically:

- lowercases and normalizes the host;
- removes `www` aliases and ports;
- drops query strings and fragments;
- repeatedly decodes percent encodings, closing double-encoding variants;
- rejects encoded control/non-visible characters;
- converts backslashes to slashes only after rejecting them in the original URL;
- collapses repeated slashes;
- resolves `.` and `..` path segments;
- removes trailing slashes; and
- lowercases the path for security-conservative identity matching.

The replay key is:

```text
warranty_id + sha256(canonical_source_url)
```

This identity is warranty-scoped, so closing an incident and opening another
cannot buy another attempt through a URL variant.

### Semantic advisory fingerprint

Different legitimate paths can still resolve to one advisory. After source
examination, the contract normalizes the extracted advisory identifier and
reserves:

```text
warranty_id + source_family + normalized(advisory_id)
```

A second URL in the same family that validators identify as the same advisory
becomes `DUPLICATE_SOURCE`, releases capacity, never increments
`verified_count`, and its bond credits the publisher. Authoritative evidence
without a stable advisory identifier is `INVALID_SOURCE`, because it cannot be
safely deduplicated.

### Targeted tests

- `test_same_evidence_cannot_be_replayed_into_a_new_incident`
- `test_url_spelling_variants_share_one_canonical_replay_key`
- `test_alternate_urls_for_the_same_advisory_are_semantically_deduplicated`
- `test_repeated_adjudication_requires_new_verified_evidence`
- `test_spoofed_authoritative_host_is_rejected_on_reveal`

The existing per-incident watermark, three-round incident cap, and six-attempt
warranty-wide cap remain defense-in-depth controls.

---

## 4. Safe GEN withdrawal reconciliation

Withdrawals remain two-phase:

| Phase | Accounting transition |
| --- | --- |
| request | `credit → withdrawal_in_flight` (`PENDING`) |
| successful dispatch | `withdrawal_in_flight → total_withdrawn` (`SETTLED`) |
| failed dispatch | `withdrawal_in_flight → credit` (`FAILED`) |
| unobserved dispatch after 15 minutes | explicit `reconcile_withdrawal` returns `withdrawal_in_flight → credit` |

No branch can erase a claimable balance without placing the same amount in a
tracked accounting bucket. Terminal status guards prevent double dispatch or
double reconciliation.

The invariant is:

```text
total_deposited = warranty_escrow + evidence_escrow + payout_reserve
                + total_claimable + withdrawal_in_flight + total_withdrawn
```

Targeted tests:

- `test_withdrawal_moves_credit_into_an_auditable_in_flight_record`
- `test_successful_dispatch_settles_the_withdrawal`
- `test_ambiguous_dispatch_is_reconciled_back_into_credit`
- `test_reconciled_withdrawal_cannot_be_double_spent`

---

## 5. Verification and evidence

Read-only live verification:

```bash
node scripts/verify_live.mjs
```

It must report:

```text
version = 2.1.0-studionet
expiryRequiresZeroPending = true
pendingEvidenceTimeoutSeconds = 300
sourceReplayProtection = CANONICAL_URL_PLUS_FAMILY_ADVISORY_FINGERPRINT
accountingBalanced = true
```

Targeted adversarial suite (Python 3.12):

```bash
python -m pytest tests/direct/test_sentinelpact_adversarial.py -v
```

Finalized deployment evidence and corrected-lifecycle transactions are recorded
in [`evidence/`](evidence/). No synthetic live `BREACHED` payout is manufactured;
positive reserve/claim behavior is covered deterministically in Direct Mode.

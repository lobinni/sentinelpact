#!/usr/bin/env node

/**
 * Read-only verification of the canonical SentinelPact deployment.
 * Makes no transaction, needs no wallet/private key, and spends no GEN.
 *
 * Run from the repository root:
 *   node scripts/verify_live.mjs
 */

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";

const ADDRESS = "0xD61eFb765F260F4D191C359D7a7413fcb59162Bf";
const RPC = "https://studio.genlayer.com/api";
const client = createClient({ chain: studionet, endpoint: RPC });

async function read(functionName, args = []) {
  return client.readContract({
    address: ADDRESS,
    functionName,
    args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

function plain(value) {
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), plain(v)]));
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Verification failed: ${message}`);
}

const [statsRaw, releasesRaw, warrantiesRaw] = await Promise.all([
  read("get_stats"),
  read("list_releases", [0, 25]),
  read("list_warranties", [0, 25]),
]);

const stats = plain(statsRaw);
const releases = plain(releasesRaw);
const warranties = plain(warrantiesRaw);

assert(stats.product === "SentinelPact", "unexpected product identity");
assert(stats.version === "2.1.0-studionet", "unexpected contract version");
assert(stats.chain_id === "61999", "unexpected chain id");
assert(stats.rpc === RPC, "unexpected contract RPC identity");
assert(stats.admin_controls === false, "admin controls must be disabled");
assert(stats.accounting_balanced === true, "accounting invariant is not balanced");
assert(stats.max_adjudication_rounds === "3", "adjudication cap is not active");
assert(
  stats.authoritative_families === "GITHUB_ADVISORY,NVD,CISA,PACKAGE_REGISTRY",
  "authoritative-family guard is not active"
);
assert(stats.max_warranty_adjudications === "6", "warranty-wide verdict ceiling is not active");
assert(stats.expiry_requires_zero_pending === true, "incident expiry still has a pending-evidence bypass");
assert(stats.pending_evidence_timeout_seconds === "300", "explicit stalled-evidence timeout is not configured");
assert(
  stats.source_replay_protection === "CANONICAL_URL_PLUS_FAMILY_ADVISORY_FINGERPRINT",
  "canonical + semantic replay protection is not active"
);
assert(stats.withdrawal_timeout_seconds === "900", "withdrawal reconciliation window is not configured");
assert(stats.withdrawal_in_flight_atto !== undefined, "withdrawal in-flight accounting bucket is missing");
assert(Array.isArray(releases.items), "release registry response is malformed");
assert(Array.isArray(warranties.items), "warranty registry response is malformed");

console.log("SentinelPact live verification passed");
console.log(JSON.stringify({
  contract: ADDRESS,
  network: stats.network,
  chainId: stats.chain_id,
  version: stats.version,
  releases: releases.total,
  warranties: warranties.total,
  incidents: stats.incidents,
  accountingBalanced: stats.accounting_balanced,
  maxAdjudicationRounds: stats.max_adjudication_rounds,
  maxWarrantyAdjudications: stats.max_warranty_adjudications,
  expiryRequiresZeroPending: stats.expiry_requires_zero_pending,
  pendingEvidenceTimeoutSeconds: stats.pending_evidence_timeout_seconds,
  sourceReplayProtection: stats.source_replay_protection,
  withdrawalTimeoutSeconds: stats.withdrawal_timeout_seconds,
  withdrawalInFlight: stats.withdrawal_in_flight_atto,
  authoritativeFamilies: stats.authoritative_families,
}, null, 2));

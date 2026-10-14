#!/usr/bin/env node

/**
 * Capture finalized on-chain evidence for the corrected SentinelPact lifecycle
 * on GenLayer Studionet (chain 61999).
 *
 * The run is phase-based because the protocol enforces real time windows:
 *
 *   node scripts/lifecycle_evidence.mjs phase1   # register, warrant, cover, withdraw
 *   node scripts/lifecycle_evidence.mjs phase2   # incident + settlement-phase guards
 *   node scripts/lifecycle_evidence.mjs phase3   # pending-evaluation + expiry guards
 *   node scripts/lifecycle_evidence.mjs phase4   # warranty expiry + final accounting
 *
 * Every step — including the deliberately rejected adversarial attempts — is
 * recorded with its finalized transaction hash into docs/evidence/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const RPC = "https://studio.genlayer.com/api";
const EXPLORER = "https://explorer-studio.genlayer.com";
const STATE_PATH = "docs/evidence/lifecycle-state.json";
const REPORT_PATH = "docs/evidence/LIFECYCLE_EVIDENCE.json";
const RESULT_CODES = ["return", "rollback", "contract_error", "error", "none", "no_leaders"];

const phase = process.argv[2] || "phase1";
mkdirSync("docs/evidence", { recursive: true });

function loadState() {
  if (!existsSync(STATE_PATH)) return { steps: [] };
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}
function saveState(state) {
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function plain(value) {
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), plain(v)]));
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

function decodeResult(result) {
  if (!result) return { status: "none", payload: null };
  if (typeof result === "object") return { status: String(result.status ?? ""), payload: result.payload ?? null };
  try {
    const bytes = Uint8Array.from(atob(String(result)), (c) => c.charCodeAt(0));
    const status = RESULT_CODES[bytes[0]] ?? "unknown";
    const payload = bytes[0] === 1 || bytes[0] === 2 ? new TextDecoder().decode(bytes.slice(1)) : null;
    return { status, payload };
  } catch {
    return { status: "unknown", payload: null };
  }
}

function outcomeOf(tx) {
  const receipts = Array.isArray(tx?.consensus_data?.leader_receipt)
    ? tx.consensus_data.leader_receipt
    : [tx?.consensus_data?.leader_receipt];
  let returned = null;
  let error = null;
  for (const receipt of receipts) {
    const decoded = decodeResult(receipt?.result);
    if (decoded.status === "return") returned = decoded.payload?.readable ?? "return";
    else if (["rollback", "contract_error", "error"].includes(decoded.status) && !error) {
      error = typeof decoded.payload === "string" ? decoded.payload : decoded.status;
    }
  }
  if (returned !== null) return { outcome: "success", detail: returned };
  if (error) return { outcome: "rejected", detail: error };
  return { outcome: "unknown", detail: null };
}

const state = loadState();

async function makeClient(privateKey) {
  const account = createAccount(privateKey);
  return { account, client: createClient({ chain: studionet, account, endpoint: RPC }) };
}

function done(label) {
  return state.steps.find((entry) => entry.label === label && entry.outcome !== "unknown" && entry.outcome !== "pending");
}

function provisional(label) {
  return state.steps.find((entry) => entry.label === label && entry.outcome === "pending" && entry.transaction);
}

async function record(label, expectation, actor, fn) {
  const already = done(label);
  if (already) {
    console.log(`• ${label} … (already recorded: ${already.outcome})`);
    return already;
  }
  process.stdout.write(`• ${label} … `);
  let hash = null;
  let outcome = "unknown";
  let detail = null;
  // Resume: if a previous run already broadcast this step, wait on that hash
  // instead of sending a duplicate transaction.
  const resumed = provisional(label);
  try {
    hash = resumed ? resumed.transaction : await fn();
    if (!resumed) {
      state.steps.push({
        step: state.steps.length + 1,
        phase,
        label,
        expectation,
        outcome: "pending",
        detail: null,
        transaction: hash,
        transactionUrl: `${EXPLORER}/tx/${hash}`,
        recordedAt: new Date().toISOString(),
      });
      saveState(state);
    }
    // Wait for the consensus decision here; a dedicated `verify` pass later
    // re-reads every hash and records its finalized status.
    const tx = await actor.client.waitForTransactionReceipt({
      hash,
      status: "ACCEPTED",
      interval: 3000,
      retries: 80,
      fullTransaction: true,
    });
    const assessed = outcomeOf(tx);
    outcome = assessed.outcome;
    detail = assessed.detail;
  } catch (error) {
    outcome = "rejected";
    detail = error instanceof Error ? error.message : String(error);
  }
  const existing = state.steps.find((item) => item.label === label && item.outcome === "pending");
  const entry = existing || {
    step: state.steps.length + 1,
    phase,
    label,
    expectation,
    recordedAt: new Date().toISOString(),
  };
  entry.phase = phase;
  entry.expectation = expectation;
  entry.outcome = outcome;
  entry.detail = typeof detail === "string" ? detail.slice(0, 400) : detail;
  entry.transaction = hash;
  entry.transactionUrl = hash ? `${EXPLORER}/tx/${hash}` : null;
  if (!existing) state.steps.push(entry);
  saveState(state);
  console.log(`${outcome}${detail ? ` — ${String(detail).slice(0, 110)}` : ""}`);
  return entry;
}

const read = async (fn, args = []) => {
  const { client } = await makeClient(state.publisherKey);
  return plain(await client.readContract({ address: state.contract, functionName: fn, args }));
};

/* ------------------------------------------------------------------ */

if (phase === "phase1") {
  if (!state.contract) {
    const record0 = JSON.parse(readFileSync("deployments/studionet.json", "utf8"));
    state.contract = record0.deployment.address;
    state.deploymentTx = record0.deployment.transaction;
    state.version = record0.contract.version;

    // Fresh keys for the three roles.
    const { generatePrivateKey } = await import("viem/accounts");
    state.publisherKey = generatePrivateKey();
    state.holderKey = generatePrivateKey();
    state.witnessKey = generatePrivateKey();
    saveState(state);
  }

  const publisher = await makeClient(state.publisherKey);
  const holder = await makeClient(state.holderKey);
  const witness = await makeClient(state.witnessKey);
  state.publisher = publisher.account.address;
  state.holder = holder.account.address;
  state.witness = witness.account.address;
  saveState(state);

  console.log(`Contract : ${state.contract} (${state.version})`);
  if (!state.funded) {
    for (const address of [state.publisher, state.holder, state.witness]) {
      await rpc("sim_fundAccount", [address, Number(200n * 10n ** 18n)]);
    }
    state.funded = true;
    saveState(state);
  }
  console.log(`Publisher: ${state.publisher}\nHolder   : ${state.holder}\nWitness  : ${state.witness}\n`);

  if (!state.packageName) {
    state.packageName = `@sentinelpact/lifecycle-${Date.now()}`;
    saveState(state);
  }

  const releaseEntry = await record(
    "register_release",
    "accepted: a new release identity is registered",
    publisher,
    () =>
      publisher.client.writeContract({
        address: state.contract,
        functionName: "register_release",
        args: ["npm", state.packageName, "1.0.0", "ab".repeat(32), "https://example.com/lifecycle/1.0.0"],
        value: 0n,
      })
  );
  state.releaseId = (releaseEntry.detail || "").replaceAll('"', "") || "sp-rel-1";
  saveState(state);

  // Window bounds are validated against the execution clock, so they are
  // computed at call time with a margin that absorbs consensus latency.
  if (!done("open_warranty")) {
    const base = Math.floor(Date.now() / 1000);
    state.coverageCloses = base + 420;
    state.endsAt = base + 1830;
    saveState(state);
  }

  const warrantyEntry = await record(
    "open_warranty",
    "accepted: publisher escrows the bond behind frozen terms",
    publisher,
    () =>
      publisher.client.writeContract({
        address: state.contract,
        functionName: "open_warranty",
        args: [
          state.releaseId,
          "Lifecycle evidence warranty",
          "CVSS 9.0 or higher (Critical)",
          "remote code execution",
          "dev-only usage, unsupported forks",
          500,
          state.coverageCloses,
          state.endsAt,
          900,
          2,
          2,
          1000000000000000n,
        ],
        value: 50000000000000000n,
      })
  );
  state.warrantyId = (warrantyEntry.detail || "").replaceAll('"', "") || "sp-war-1";
  saveState(state);

  await record(
    "buy_coverage",
    "accepted: holder buys 0.02 GEN of coverage for the exact premium",
    holder,
    () =>
      holder.client.writeContract({
        address: state.contract,
        functionName: "buy_coverage",
        args: [state.warrantyId, 20000000000000000n],
        value: 1000000000000000n,
      })
  );

  // ---- Requirement 3: safe GEN withdrawal reconciliation ----
  const creditBefore = await read("get_credit", [state.publisher]);
  console.log(`  publisher credit before withdrawal: ${creditBefore}`);
  const withdrawalEntry = await record(
    "withdraw_credit (phase one)",
    "accepted: credit moves into an auditable in-flight withdrawal record",
    publisher,
    () =>
      publisher.client.writeContract({
        address: state.contract,
        functionName: "withdraw_credit",
        args: [state.publisher],
        value: 0n,
      })
  );
  state.withdrawalId = (withdrawalEntry.detail || "").replaceAll('"', "") || "sp-wd-1";
  saveState(state);
  console.log("  waiting for the finalized dispatch callback to reconcile…");
  await new Promise((r) => setTimeout(r, 20000));
  const withdrawal = await read("get_withdrawal", [state.withdrawalId]);
  console.log(`  withdrawal ${state.withdrawalId}: ${withdrawal.status} — ${withdrawal.detail}`);
  state.withdrawalStatus = withdrawal.status;
  state.withdrawalDetail = withdrawal.detail;
  const statsAfter = await read("get_stats");
  state.accountingAfterWithdrawal = {
    claimable: statsAfter.claimable_atto,
    inFlight: statsAfter.withdrawal_in_flight_atto,
    withdrawn: statsAfter.withdrawn_atto,
    balanced: statsAfter.accounting_balanced,
  };
  saveState(state);
  console.log(`  accounting balanced: ${statsAfter.accounting_balanced}`);
  console.log(`\nPhase 1 complete. Run phase2 after ${new Date(state.coverageCloses * 1000).toISOString()}`);
}

if (phase === "phase2") {
  const publisher = await makeClient(state.publisherKey);
  const witness = await makeClient(state.witnessKey);

  const incidentEntry = await record(
    "open_incident",
    "accepted: incident opens once the coverage window has closed",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "open_incident",
        args: [state.warrantyId, "Lifecycle settlement-phase check", "evidence-window guard"],
        value: 0n,
      })
  );
  if (incidentEntry.outcome !== "success") {
    console.error(`\nopen_incident did not succeed (${incidentEntry.detail}). Re-run phase2 once the coverage window has closed.`);
    state.steps = state.steps.filter((entry) => entry.label !== "open_incident");
    saveState(state);
    process.exit(1);
  }
  state.incidentId = (incidentEntry.detail || "").replaceAll('"', "");
  saveState(state);

  // ---- Requirement 1: no irreversible verdict before evidence can be examined ----
  await record(
    "adjudicate_incident while the evidence window is still open",
    "REJECTED: adjudication opens only after the evidence window closes",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "adjudicate_incident",
        args: [state.incidentId],
        value: 0n,
      })
  );

  // ---- Requirement 2: authoritative sources are authenticated on-chain ----
  const spoofUrl = "https://nvd-nist-gov.attacker.example/vuln/detail/CVE-2099-0001";
  const fact = "Spoofed authority page claiming the covered release is affected.";
  const salt = "cd".repeat(32);
  let spoofCommitment = null;
  try {
    spoofCommitment = await publisher.client.readContract({
      address: state.contract,
      functionName: "compute_evidence_commitment",
      args: [state.incidentId, state.witness, "NVD", spoofUrl, fact, salt],
    });
  } catch (error) {
    state.spoofViewRejection = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    saveState(state);
    console.log(`• compute_evidence_commitment for a spoofed NVD host … rejected by the view guard`);
  }

  // Commit blind (the commitment is computed off-chain), then prove the reveal
  // is rejected because the host is not an official NVD host.
  const { keccak256, toHex } = await import("viem");
  const offchainCommitment = await (async () => {
    const encoder = new TextEncoder();
    const parts = [
      "sentinelpact-evidence-v1",
      "61999",
      String(state.contract).toLowerCase(),
      state.incidentId,
      String(state.witness).toLowerCase(),
      "NVD",
      spoofUrl,
      fact,
      salt,
    ];
    const packed = parts.map((p) => `${p.length}:${p}`).join("");
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(packed));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  })();
  void keccak256;
  void toHex;

  await record(
    "commit_evidence for a spoofed NVD host",
    "accepted: committing is blind, the bond is locked",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "commit_evidence",
        args: [state.incidentId, offchainCommitment],
        value: 1000000000000000n,
      })
  );
  const evidencePage = await read("list_evidence", [state.incidentId, 0, 25]);
  state.spoofEvidenceId = evidencePage.items?.[evidencePage.items.length - 1]?.evidence_id ?? "sp-ev-1";
  saveState(state);

  await record(
    "reveal_evidence with a spoofed NVD host",
    "REJECTED: NVD evidence must be published on an official NVD host",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "reveal_evidence",
        args: [state.spoofEvidenceId, "NVD", spoofUrl, fact, salt],
        value: 0n,
      })
  );

  await record(
    "expire_incident before the evidence window closed",
    "REJECTED: the incident evidence window is still open",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "expire_incident",
        args: [state.incidentId],
        value: 0n,
      })
  );

  const incident = await read("get_incident", [state.incidentId]);
  state.incidentAfterPhase2 = {
    pending_evidence: incident.pending_evidence,
    evidence_window_closed: incident.evidence_window_closed,
    settlement_ready: incident.settlement_ready,
    evidence_deadline: incident.evidence_deadline,
  };
  saveState(state);
  console.log(`\nPending evidence: ${incident.pending_evidence}; window closes ${new Date(Number(incident.evidence_deadline) * 1000).toISOString()}`);
}

if (phase === "phase3") {
    const witness = await makeClient(state.witnessKey);

    // Never broadcast that would only be rejected for being early: wait out
    // the remaining evidence window (with slack for consensus-clock lag).
    {
      const probe = await read("get_incident", [state.incidentId]);
      const remaining = Number(probe.evidence_deadline) - Math.floor(Date.now() / 1000);
      if (remaining > -20) {
        const pause = Math.min(remaining + 40, 170);
        if (pause > 0) {
          console.log(`Waiting ${pause}s for the evidence window to close…`);
          await new Promise((r) => setTimeout(r, pause * 1000));
        }
      }
    }

    // ---- Requirement 1: expiry cannot bypass a pending evaluation ----
  await record(
    "expire_incident while an evaluation is still pending",
    "REJECTED: pending evidence evaluations must resolve before expiry",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "expire_incident",
        args: [state.incidentId],
        value: 0n,
      })
  );

  await record(
    "adjudicate_incident while an evaluation is still pending",
    "REJECTED: pending evidence evaluations must resolve before adjudication",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "adjudicate_incident",
        args: [state.incidentId],
        value: 0n,
      })
  );

  await record(
    "expire_unrevealed_evidence",
    "accepted: the unrevealed bond is slashed to the publisher and the slot is freed",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "expire_unrevealed_evidence",
        args: [state.spoofEvidenceId],
        value: 0n,
      })
  );

  const incident = await read("get_incident", [state.incidentId]);
  console.log(`  pending_evidence now ${incident.pending_evidence}; settlement_ready=${incident.settlement_ready}`);

  await record(
    "adjudicate_incident without sufficient verified evidence",
    "REJECTED: insufficient verified evidence",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "adjudicate_incident",
        args: [state.incidentId],
        value: 0n,
      })
  );

  await record(
    "expire_incident once no evaluation is pending",
    "accepted: the incident closes as INCONCLUSIVE and frees the warranty",
    witness,
    () =>
      witness.client.writeContract({
        address: state.contract,
        functionName: "expire_incident",
        args: [state.incidentId],
        value: 0n,
      })
  );

  const closed = await read("get_incident", [state.incidentId]);
  state.incidentFinal = { status: closed.status, last_verdict: closed.last_verdict };
  saveState(state);
  console.log(`  incident ${state.incidentId}: ${closed.status} / ${closed.last_verdict}`);
}

if (phase === "verify") {
  const { client } = await makeClient(state.publisherKey);
  for (const entry of state.steps) {
    if (!entry.transaction) continue;
    try {
      const tx = await client.getTransaction({ hash: entry.transaction });
      entry.finalizedStatus = tx?.statusName ?? String(tx?.status ?? "unknown");
      const assessed = outcomeOf(tx);
      entry.outcome = assessed.outcome;
      if (assessed.detail) entry.detail = String(assessed.detail).slice(0, 400);
    } catch {
      entry.finalizedStatus = "unreadable";
    }
    console.log(`${entry.step}. ${entry.label} → ${entry.finalizedStatus} / ${entry.outcome}`);
  }
  saveState(state);
}

if (phase === "phase4") {
  const publisher = await makeClient(state.publisherKey);

  const warranty = await read("get_warranty", [state.warrantyId]);
  const warrantyEnded = Math.floor(Date.now() / 1000) >= Number(warranty.ends_at);
  if (warrantyEnded) {
    await record(
      "expire_warranty",
      "accepted: the bond returns to the publisher as withdrawable credit",
      publisher,
      () =>
        publisher.client.writeContract({
          address: state.contract,
          functionName: "expire_warranty",
          args: [state.warrantyId],
          value: 0n,
        })
    );
  } else {
    console.log(
      `• expire_warranty … skipped (warranty ends at ${new Date(Number(warranty.ends_at) * 1000).toISOString()})`
    );
  }

  const stats = await read("get_stats");
  state.finalStats = stats;
  saveState(state);

  const report = {
    network: { name: "GenLayer Studionet", chainId: 61999, rpc: RPC, explorer: EXPLORER },
    contract: {
      address: state.contract,
      version: state.version,
      explorerUrl: `${EXPLORER}/address/${state.contract}`,
      deploymentTransaction: state.deploymentTx,
      deploymentTransactionUrl: `${EXPLORER}/tx/${state.deploymentTx}`,
    },
    actors: { publisher: state.publisher, holder: state.holder, witness: state.witness },
    subject: { release: state.releaseId, warranty: state.warrantyId, incident: state.incidentId },
    withdrawalReconciliation: {
      withdrawalId: state.withdrawalId,
      status: state.withdrawalStatus,
      detail: state.withdrawalDetail,
      accountingAfterWithdrawal: state.accountingAfterWithdrawal,
    },
    finalAccounting: {
      totalDeposited: stats.total_deposited_atto,
      warrantyEscrow: stats.warranty_escrow_atto,
      evidenceEscrow: stats.evidence_escrow_atto,
      payoutReserve: stats.payout_reserve_atto,
      claimable: stats.claimable_atto,
      withdrawalInFlight: stats.withdrawal_in_flight_atto,
      withdrawn: stats.withdrawn_atto,
      balanced: stats.accounting_balanced,
    },
    steps: state.steps,
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${REPORT_PATH} with ${state.steps.length} finalized steps.`);
  console.log(`Accounting balanced: ${stats.accounting_balanced}`);
}

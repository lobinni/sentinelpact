"use client";

import { CONTRACT_ADDRESS, latestFinalRead, preflightWallet, readClient, writeClient } from "./client";
import { estimateWriteFees } from "./fees";
import { asPlain } from "@/lib/format";
import { TransactionStatus } from "genlayer-js/types";
import type {
  CoverageRecord,
  EvidencePage,
  IncidentRecord,
  ProtocolStats,
  ReleaseRecord,
  TxState,
  WarrantyRecord,
} from "@/lib/types";

export const SOURCE_FAMILIES = [
  "VENDOR",
  "GITHUB_ADVISORY",
  "NVD",
  "CISA",
  "PACKAGE_REGISTRY",
  "SECURITY_RESEARCH",
] as const;

/* ------------------------------------------------------------------ */
/* Receipt helpers                                                     */
/*                                                                     */
/* genlayer-js 1.1.8 notes:                                            */
/* - waitForTransactionReceipt accepts `status` (NOT waitUntil). The   */
/*   "ACCEPTED" wait resolves on ANY decided state.                    */
/* - Studionet returns localnet-shaped receipts WITHOUT the            */
/*   txExecutionResult field; execution outcome lives inside           */
/*   consensus_data.leader_receipt[].result ("return"/"rollback"/…).   */
/* ------------------------------------------------------------------ */

const STATUS_NAMES: Record<string, string> = {
  "0": "UNINITIALIZED",
  "1": "PENDING",
  "2": "PROPOSING",
  "3": "COMMITTING",
  "4": "REVEALING",
  "5": "ACCEPTED",
  "6": "UNDETERMINED",
  "7": "FINALIZED",
  "8": "CANCELED",
  "9": "APPEAL_REVEALING",
  "10": "APPEAL_COMMITTING",
  "11": "READY_TO_FINALIZE",
  "12": "VALIDATORS_TIMEOUT",
  "13": "LEADER_TIMEOUT",
};

const DECISION_FAILURES = new Set(["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"]);

const RESULT_CODES = ["return", "rollback", "contract_error", "error", "none", "no_leaders"];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usefulError(error: unknown) {
  const raw = error as any;
  // MetaMask / EIP-1193 rejection codes — surface human guidance first.
  if (raw?.code === 4001) return "You rejected the request in MetaMask.";
  if (raw?.code === -32002) return "A MetaMask request is already pending — open MetaMask to continue.";
  if (error instanceof Error && error.message) {
    const message = error.message;
    if (message.toLowerCase().includes("user rejected")) return "You rejected the request in MetaMask.";
    if (message.toLowerCase().includes("chain") && message.toLowerCase().includes("match")) {
      return "MetaMask is not on Studionet (chain 61999) — switch networks and retry.";
    }
    return message;
  }
  if (typeof error === "string" && error) return error;
  try {
    const encoded = JSON.stringify(error);
    if (encoded && encoded !== "{}") return encoded;
  } catch {
    // Fall through to a stable user-facing message.
  }
  return "GenLayer transaction failed.";
}

/** Normalized, uppercase status name for both numeric and named status fields.
 * Unknown tokens are returned uppercased; only recognized names drive logic. */
function txStatus(transaction: any) {
  const value = transaction?.statusName ?? transaction?.status;
  const raw = String(value ?? "unknown");
  return STATUS_NAMES[raw] ?? raw.toUpperCase();
}

const PENDING_STATUSES = new Set([
  "UNINITIALIZED",
  "PENDING",
  "ACTIVATED",
  "PROPOSING",
  "COMMITTING",
  "REVEALING",
  "APPEAL_REVEALING",
  "APPEAL_COMMITTING",
  "READY_TO_FINALIZE",
  "UNKNOWN",
  "NAN",
]);

type ExecutionEvidence = { state: "success" | "failure" | "unknown"; detail?: string };

/** Decode a raw base64 leader-receipt result the way genlayer-js does. */
function decodeRawResult(encoded: string): { status: string; payload: string | null } {
  try {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const status = RESULT_CODES[bytes[0]] ?? "<unknown>";
    const payload =
      bytes[0] === 1 || bytes[0] === 2 ? new TextDecoder("utf-8").decode(bytes.slice(1)) : null;
    return { status, payload };
  } catch {
    return { status: "unknown", payload: null };
  }
}

// Consensus vote outcomes (shared across shapes).
// 1 AGREE / 6 MAJORITY_AGREE → success, 2 DISAGREE / 7 MAJORITY_DISAGREE → failure.
const VOTE_AGREE = new Set([1, 6]);
const VOTE_DISAGREE = new Set([2, 7]);

/**
 * Determine GenVM execution outcome from any receipt shape:
 * A) testnet-shaped  → txExecutionResult (NOT_VOTED/FINISHED_WITH_RETURN/…)
 * B) studionet-shaped → consensus_data.leader_receipt[].result.status
 *
 * A FINALIZED studio transaction may carry MULTIPLE leader receipts: the
 * canonical consensus output, then re-evaluation entries from monitoring
 * (e.g. a spurious post-finalize error). Semantics: any "return" receipt is
 * proof of success, a consensus AGREE vote is proof of success, and only an
 * explicit error WITHOUT any success proof is a failure.
 */
function executionEvidence(transaction: any): ExecutionEvidence {
  const exec = transaction?.txExecutionResultName ?? transaction?.txExecutionResult;
  if (exec !== undefined && exec !== null) {
    const value = String(exec);
    if (value === "FINISHED_WITH_RETURN" || value === "1") return { state: "success" };
    if (value === "FINISHED_WITH_ERROR" || value === "2") {
      return { state: "failure", detail: "GenVM execution finished with an error." };
    }
    return { state: "unknown" };
  }

  const voteResult = Number(transaction?.result ?? NaN);
  const leaderReceipt = transaction?.consensus_data?.leader_receipt;
  let sawReturn = false;
  let errorDetail: string | null = null;
  if (leaderReceipt) {
    const receipts = Array.isArray(leaderReceipt) ? leaderReceipt : [leaderReceipt];
    for (const receipt of receipts) {
      const result = receipt?.result;
      if (!result) continue;
      const decoded =
        typeof result === "object" ? { status: String(result.status ?? ""), payload: result.payload ?? null } : decodeRawResult(String(result));
      if (decoded.status === "return") {
        // Canonical consensus output — the contract executed and returned.
        sawReturn = true;
      } else if (decoded.status === "rollback" || decoded.status === "contract_error" || decoded.status === "error") {
        if (!errorDetail) {
          errorDetail =
            typeof decoded.payload === "string" && decoded.payload.trim()
              ? decoded.payload.trim()
              : `Execution ended with status "${decoded.status}".`;
        }
      }
      // "none"/pending entries carry no outcome and are ignored.
    }
  }

  // Order matters: a "return" receipt proves success; an explicit error
  // without any return proves failure (validators also aggregate OVER error
  // outcomes, so the vote can never outrank an explicit error).
  if (sawReturn) return { state: "success" };
  if (errorDetail) return { state: "failure", detail: errorDetail };
  if (VOTE_DISAGREE.has(voteResult)) {
    return { state: "failure", detail: "Validators disagreed with the leader result." };
  }
  if (VOTE_AGREE.has(voteResult)) return { state: "success" };

  return { state: "unknown" };
}

function isAccepted(transaction: any) {
  const status = txStatus(transaction);
  return status === TransactionStatus.ACCEPTED || status === TransactionStatus.FINALIZED;
}

/** Poll the transaction until FINALIZED or a terminal failure decision. */
async function pollUntilFinal(client: any, hash: string, onTick?: (status: string) => void) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const tx = await client.getTransaction({ hash });
      const status = txStatus(tx);
      onTick?.(status);
      if (status === "FINALIZED" || DECISION_FAILURES.has(status)) return tx;
    } catch {
      // Transaction may not be indexed yet right after submission.
    }
    await sleep(4000);
  }
  return null;
}

async function executeWrite(
  account: `0x${string}`,
  functionName: string,
  args: any[],
  value: bigint,
  onState?: (state: TxState) => void
) {
  if (!CONTRACT_ADDRESS) throw new Error("SentinelPact contract address is not configured.");
  let hash: `0x${string}` | undefined;
  try {
    // Plugin-free preflight: MetaMask grants access + sits on chain 61999
    // (auto-switches when possible). Signing always uses MetaMask's active
    // account, so prefer it over the address the UI cached.
    const activeAccount = (await preflightWallet(account)) ?? account;
    const client: any = await writeClient(activeAccount);
    const write = { address: CONTRACT_ADDRESS as `0x${string}`, functionName, args, value };
    onState?.({ stage: "signing", message: "Confirm this transaction in MetaMask (Studionet 61999)." });
    const fees = await estimateWriteFees(client, write as any);
    hash = await client.writeContract({ ...write, ...(fees ? { fees } : {}) } as any);
    onState?.({ stage: "submitted", hash, message: "Submitted to GenLayer consensus." });

    // 1) Wait until consensus decides (the ACCEPTED wait resolves on any
    //    decided state: accepted, finalized, or a failure decision).
    const decided = await client.waitForTransactionReceipt({
      hash,
      status: "ACCEPTED",
      retries: 150,
      interval: 4000,
      fullTransaction: true,
    });
    let decidedStatus = txStatus(decided);
    if (DECISION_FAILURES.has(decidedStatus)) {
      throw new Error(`Consensus rejected the operation (${decidedStatus.toLowerCase().replace("_", " ")}).`);
    }
    // Never treat an unfamiliar/pending status token as a failure: keep
    // polling until a final or failure state instead of throwing early.
    if (PENDING_STATUSES.has(decidedStatus)) {
      onState?.({ stage: "submitted", hash, message: "Consensus is assembling — tracking the transaction…" });
      const progressed = await pollUntilFinal(client, hash!);
      if (!progressed) {
        onState?.({ stage: "submitted", hash, message: "Submitted — the network is slow to index. Refresh shortly to confirm." });
        return hash;
      }
      decidedStatus = txStatus(progressed);
      if (DECISION_FAILURES.has(decidedStatus)) {
        throw new Error(`Consensus rejected the operation (${decidedStatus.toLowerCase().replace("_", " ")}).`);
      }
      if (!isAccepted(progressed)) {
        // Still nothing terminal — treat as accepted-pending rather than error.
        onState?.({ stage: "submitted", hash, message: "Submitted — confirm the final state from the explorer shortly." });
        return hash;
      }
      Object.assign(decided, progressed);
    }
    onState?.({ stage: "decided", hash, message: `Consensus decision reached (${decidedStatus.toLowerCase()}).` });

    // Execution evidence can already be final at decision time — and carries
    // the real contract error text when the call reverted.
    let evidence = executionEvidence(decided);
    if (evidence.state === "failure") {
      throw new Error(evidence.detail || "The contract rejected this call.");
    }

    // 2) Wait for finality (manual poll — the SDK only exposes an "ACCEPTED"
    //    wait). Terminal failures are honored immediately.
    let finalTx: any = decidedStatus === "FINALIZED" ? decided : null;
    if (!finalTx) {
      onState?.({ stage: "finalizing", hash, message: "Accepted — waiting for finality." });
      finalTx = await pollUntilFinal(client, hash!);
    }

    if (finalTx) {
      const finalStatus = txStatus(finalTx);
      if (DECISION_FAILURES.has(finalStatus)) {
        throw new Error(`Consensus rejected the operation (${finalStatus.toLowerCase().replace("_", " ")}).`);
      }
      const finalEvidence = executionEvidence(finalTx);
      if (finalEvidence.state !== "unknown") evidence = finalEvidence;
    }

    if (evidence.state === "failure") {
      throw new Error(evidence.detail || "The contract rejected this call.");
    }

    const finalMessage =
      finalTx && txStatus(finalTx) === "FINALIZED"
        ? evidence.state === "success"
          ? "Finalized — GenVM execution returned successfully."
          : "Finalized by consensus."
        : evidence.state === "success"
          ? "Accepted by consensus — execution returned successfully."
          : "Accepted by consensus — refresh the page to confirm the final state.";

    onState?.({ stage: "successful", hash, message: finalMessage });
    return hash;
  } catch (error) {
    const message = usefulError(error);
    // The chain is the source of truth: before surfacing any error once a
    // hash exists, re-read the transaction. A decided/final transaction with
    // successful (or indeterminate) execution is NOT an error — wallets and
    // RPC layers sometimes report transient failures for settled work.
    if (hash) {
      try {
        const settled = await (readClient() as any)
          .getTransaction({ hash })
          .catch(() => null);
        const settledStatus = txStatus(settled);
        const settledEvidence = executionEvidence(settled);
        if (settled && DECISION_FAILURES.has(settledStatus)) {
          const finalMessage = `Consensus rejected the operation (${settledStatus.toLowerCase().replace("_", " ")}).`;
          onState?.({ stage: "error", hash, message: finalMessage });
          const wrapped = new Error(finalMessage) as Error & { hash?: `0x${string}` };
          wrapped.hash = hash;
          throw wrapped;
        }
        if (settled && settledEvidence.state === "failure") {
          const finalMessage = settledEvidence.detail || message;
          onState?.({ stage: "error", hash, message: finalMessage });
          const wrapped = new Error(finalMessage) as Error & { hash?: `0x${string}` };
          wrapped.hash = hash;
          throw wrapped;
        }
        if (settled && isAccepted(settled)) {
          const finalMessage = "Submitted and accepted on-chain — refresh shortly to see the final state.";
          onState?.({ stage: "successful", hash, message: finalMessage });
          return hash;
        }
        // Hash exists ⇒ the wallet broadcast the transaction. If the node has
        // not indexed it yet, present a pending note rather than an error.
        onState?.({ stage: "submitted", hash, message: "Submitted — indexing is slower than usual. Confirm from the explorer shortly." });
        return hash;
      } catch (rethrown) {
        if (rethrown instanceof Error && (rethrown as any).hash) throw rethrown;
        // Fall through to the original error below.
      }
    }
    onState?.({ stage: "error", ...(hash ? { hash } : {}), message });
    const wrapped = new Error(message) as Error & { hash?: `0x${string}` };
    if (hash) wrapped.hash = hash;
    throw wrapped;
  }
}

/**
 * Typed facade over the SentinelPact intelligent contract. All reads use the
 * latest finalized state; all writes flow through consensus staging.
 */
export const SentinelPact = {
  configured: () => !!CONTRACT_ADDRESS,

  async listWarranties(): Promise<WarrantyRecord[]> {
    const raw = asPlain(await latestFinalRead("list_warranties", [0, 25]));
    return (raw?.items || []) as WarrantyRecord[];
  },
  async listReleases(): Promise<ReleaseRecord[]> {
    const raw = asPlain(await latestFinalRead("list_releases", [0, 25]));
    return (raw?.items || []) as ReleaseRecord[];
  },
  async warranty(id: string): Promise<WarrantyRecord> {
    return asPlain(await latestFinalRead("get_warranty", [id]));
  },
  async release(id: string): Promise<ReleaseRecord> {
    return asPlain(await latestFinalRead("get_release", [id]));
  },
  async incidents(warrantyId: string): Promise<IncidentRecord[]> {
    return asPlain(await latestFinalRead("list_incidents", [warrantyId]));
  },
  async incident(id: string): Promise<IncidentRecord> {
    return asPlain(await latestFinalRead("get_incident", [id]));
  },
  async evidence(incidentId: string, offset = 0, count = 25): Promise<EvidencePage> {
    return asPlain(await latestFinalRead("list_evidence", [incidentId, offset, count]));
  },
  async stats(): Promise<ProtocolStats> {
    return asPlain(await latestFinalRead("get_stats", []));
  },
  async credit(address: string): Promise<string> {
    return String(await latestFinalRead("get_credit", [address]));
  },
  async coverage(warrantyId: string, address: string): Promise<CoverageRecord> {
    return asPlain(await latestFinalRead("get_coverage", [warrantyId, address]));
  },
  async commitment(
    incidentId: string,
    submitter: string,
    sourceFamily: string,
    sourceUrl: string,
    claimedFact: string,
    salt: string
  ): Promise<string> {
    return String(
      await latestFinalRead("compute_evidence_commitment", [
        incidentId,
        submitter,
        sourceFamily,
        sourceUrl,
        claimedFact,
        salt,
      ])
    );
  },

  write: (account: `0x${string}`, name: string, args: any[], value = 0n, onState?: (state: TxState) => void) =>
    executeWrite(account, name, args, value, onState),
};

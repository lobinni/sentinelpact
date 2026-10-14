export type FeeEstimate = {
  distribution?: Record<string, unknown>;
  messageAllocations?: Record<string, unknown>[];
  feeValue?: bigint | number | string;
  fee_value?: bigint | number | string;
};

function toFees(estimate?: FeeEstimate) {
  if (!estimate?.distribution) return undefined;
  const fees: Record<string, unknown> = { distribution: estimate.distribution };
  if (estimate.messageAllocations) fees.messageAllocations = estimate.messageAllocations;
  const feeValue = estimate.feeValue ?? estimate.fee_value;
  if (feeValue !== undefined) fees.feeValue = feeValue;
  return fees;
}

/**
 * Best-effort write-fee estimation for GenLayer consensus transactions.
 * Prefers the dedicated write-path estimator, then falls back to a generic
 * estimate refined through simulation when the SDK exposes it.
 */
export async function estimateWriteFees(client: any, write: Record<string, unknown>) {
  try {
    if (typeof client?.estimateTransactionFeesForWrite === "function") {
      const estimate = await client.estimateTransactionFeesForWrite(write);
      const fees = toFees(estimate as FeeEstimate);
      if (fees) return fees;
    }

    if (typeof client?.estimateTransactionFees !== "function") return undefined;

    const options = { appealRounds: 1n, rotations: [0n, 0n] };
    const initial = await client.estimateTransactionFees(options);
    let estimate = initial;

    if (
      typeof client?.simulateWriteContract === "function" &&
      typeof client?.estimateTransactionFeesFromSimulation === "function"
    ) {
      const simulation = await client.simulateWriteContract({
        ...write,
        includeReceipt: true,
        fees: toFees(initial),
      });
      estimate = await client.estimateTransactionFeesFromSimulation({ ...options, simulation });
    }

    return toFees(estimate);
  } catch {
    // Fee estimation is advisory only — with plain MetaMask the wallet computes
    // gas itself, so a failing estimator must never block the transaction.
    return undefined;
  }
}

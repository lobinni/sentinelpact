import { AlertTriangle, ArrowUpRight, Check, CircleDashed, Loader2 } from "lucide-react";
import { transactionExplorer } from "@/lib/genlayer/client";
import type { TxStage, TxState } from "@/lib/types";

const ORDER: TxStage[] = ["signing", "submitted", "decided", "finalizing", "successful"];

function rank(stage: TxStage) {
  if (stage === "error") return Number.MAX_SAFE_INTEGER;
  return ORDER.indexOf(stage);
}

export function TxRail({ state }: { state: TxState }) {
  if (state.stage === "idle") return null;
  const failed = state.stage === "error";
  const reached = failed ? 1 : rank(state.stage);
  return (
    <div className="tx-rail enter">
      {ORDER.map((step, index) => {
        const done = !failed && reached >= index;
        const active = !failed && reached === index && step !== "successful";
        return (
          <div key={step} className={`tx-step ${done ? "tx-step-done" : ""}`}>
            {failed && index === reached ? (
              <AlertTriangle className="tx-ico text-[var(--danger)]" />
            ) : done ? (
              <Check className="tx-ico text-[var(--mint-deep)]" />
            ) : active ? (
              <Loader2 className="tx-ico spin" />
            ) : (
              <CircleDashed className="tx-ico" />
            )}
            <span className="mono text-[10px] uppercase tracking-[0.2em]">{step}</span>
          </div>
        );
      })}
      <p className={`mono mt-2 text-[11px] leading-relaxed ${failed ? "text-[var(--danger)]" : "text-[var(--muted-fg)]"}`}>
        {state.message}
      </p>
      {state.hash && (
        <a
          className="mono mt-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-[var(--mint-deep)] underline underline-offset-4"
          href={transactionExplorer(state.hash)}
          target="_blank"
          rel="noreferrer"
        >
          View consensus record <ArrowUpRight className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

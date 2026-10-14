import { Mark } from "./Mark";
import { contractExplorer } from "@/lib/genlayer/client";

export function Footer() {
  return (
    <footer className="band-dark mt-24">
      <div className="container-x grid gap-10 py-14 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3 text-[#f8fcf9]">
            <Mark />
            <span className="display text-lg">SentinelPact</span>
          </div>
          <p className="mono mt-4 max-w-xs text-[11px] leading-relaxed tracking-[0.08em] text-[rgba(248,252,249,0.55)]">
            Bonded software-release warranties resolved by decentralized consensus on GenLayer Studionet.
          </p>
        </div>
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--mint)]">Network</p>
          <ul className="mono mt-4 space-y-2 text-[12px] text-[rgba(248,252,249,0.7)]">
            <li>GenLayer Studionet</li>
            <li>Chain 61999</li>
            <li>Native asset GEN</li>
          </ul>
        </div>
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--mint)]">Settlement</p>
          <ul className="mono mt-4 space-y-2 text-[12px] text-[rgba(248,252,249,0.7)]">
            <li>Two-stage consensus adjudication</li>
            <li>Deterministic payout reserves</li>
            <li>No admin keys</li>
            <li>
              <a className="underline underline-offset-4 hover:text-[var(--mint)]" href={contractExplorer()} target="_blank" rel="noreferrer">
                Explorer
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="hairline-t border-[rgba(248,252,249,0.14)]">
        <div className="container-x mono flex flex-wrap items-center justify-between gap-3 py-4 text-[10px] uppercase tracking-[0.2em] text-[rgba(248,252,249,0.45)]">
          <span>SentinelPact Protocol</span>
          <span>Trust is escrowed</span>
        </div>
      </div>
    </footer>
  );
}

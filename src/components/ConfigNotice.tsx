import { Settings2 } from "lucide-react";

export function ConfigNotice() {
  return (
    <div className="card card-pad flex items-start gap-3 border-[rgba(147,104,0,0.5)]">
      <Settings2 className="mt-0.5 h-4 w-4 flex-none text-[var(--amber)]" />
      <div>
        <p className="font-semibold">Contract address not configured</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted-fg)]">
          Set the deployed contract address in the environment and rebuild the app. On-chain sections will activate
          automatically once the address is present.
        </p>
      </div>
    </div>
  );
}

import { Panel } from "@/components/ui/Panel";

// Module shell for surfaces specified in the architecture but built in a later phase.
export function Placeholder({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">{title}</h1>
        <span className="rounded-full border border-line px-3 py-1 text-xs text-ink-3">
          {phase}
        </span>
      </header>
      <Panel>
        <p className="text-sm text-ink-3">
          {children ??
            `Specified in the architecture (Personal-OS-V2-Architecture.md). Arrives in ${phase}.`}
        </p>
      </Panel>
    </div>
  );
}

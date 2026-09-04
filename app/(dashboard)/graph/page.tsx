import { createClient } from "@/lib/supabase/server";
import { getGraph } from "@/lib/domains/entities";
import { GraphView } from "@/components/graph/GraphView";
import { Panel } from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

// Phase 6 — relationship/entity graph. Nodes come from entity extraction in the
// capture pipeline (plus manual POST /api/entities); importance is recomputed
// nightly. Clicking a node shows its contact, connections, opportunities and tasks.
export default async function GraphPage() {
  const supabase = await createClient();
  const graph = await getGraph(supabase);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">Relationship Graph</h1>
        <span className="rounded-full border border-line px-3 py-1 text-xs text-ink-3">
          {graph.nodes.length} entities
        </span>
      </header>
      {graph.nodes.length === 0 ? (
        <Panel>
          <p className="text-sm text-ink-3">
            No entities yet. The graph builds itself as you capture — mention people, companies
            or projects in the Command Center (e.g. &ldquo;call Sam Rivera about the Acme
            retainer&rdquo;) and they&rsquo;ll appear here, linked to the tasks and opportunities
            they relate to. You can also add nodes directly via{" "}
            <code className="text-xs">POST /api/entities</code>, or run{" "}
            <code className="text-xs">supabase/seed.sql</code> for a demo graph.
          </p>
        </Panel>
      ) : (
        <GraphView initial={graph} />
      )}
    </div>
  );
}

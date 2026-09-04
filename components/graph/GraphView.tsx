"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type EdgeSingular, type NodeSingular } from "cytoscape";
import type { GraphPayload } from "@/lib/db/graph-types";
import type { EntityType } from "@/lib/ai/types";
import { EntityPanel, type EntityDetailData } from "@/components/graph/EntityPanel";

// One stable color per entity type (hex — cytoscape can't read CSS variables).
export const TYPE_COLORS: Record<EntityType, string> = {
  person: "#60a5fa",
  company: "#f59e0b",
  project: "#34d399",
  organization: "#f97316",
  tool: "#a78bfa",
  location: "#22d3ee",
  event: "#f472b6",
  asset: "#facc15",
};
const ALL_TYPES = Object.keys(TYPE_COLORS) as EntityType[];

// importance 0..100 → node diameter 22..58px
function nodeSize(importance: number): number {
  return 22 + Math.min(100, Math.max(0, importance)) * 0.36;
}

export function GraphView({ initial }: { initial: GraphPayload }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<EntityType>>(new Set(ALL_TYPES));
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const presentTypes = useMemo(
    () => ALL_TYPES.filter((t) => initial.nodes.some((n) => n.entity_type === t)),
    [initial.nodes],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nodes = initial.nodes.filter(
      (n) => activeTypes.has(n.entity_type) && (!q || n.name.toLowerCase().includes(q)),
    );
    const ids = new Set(nodes.map((n) => n.id));
    const edges = initial.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges };
  }, [initial, activeTypes, search]);

  // (Re)build the cytoscape instance whenever the visible subgraph changes.
  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...filtered.nodes.map((n) => ({
          data: { id: n.id, label: n.name, type: n.entity_type, importance: n.importance_score },
        })),
        ...filtered.edges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            rel: e.relationship_type,
            strength: e.strength ?? 0.3,
          },
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-size": "10px",
            color: "#9ca3af",
            "text-valign": "bottom",
            "text-margin-y": 4,
            "background-color": (el: NodeSingular) =>
              TYPE_COLORS[el.data("type") as EntityType] ?? "#64748b",
            width: (el: NodeSingular) => nodeSize(Number(el.data("importance")) || 0),
            height: (el: NodeSingular) => nodeSize(Number(el.data("importance")) || 0),
            "border-width": 1.5,
            "border-color": "#1f2937",
          },
        },
        {
          selector: "node:selected",
          style: { "border-width": 3, "border-color": "#e5e7eb" },
        },
        {
          selector: "edge",
          style: {
            width: (el: EdgeSingular) => 1 + (Number(el.data("strength")) || 0.3) * 3,
            "line-color": "#374151",
            "curve-style": "bezier",
            opacity: 0.8,
          },
        },
      ],
      layout: {
        name: "cose",
        animate: false,
        nodeRepulsion: () => 8000,
        idealEdgeLength: () => 80,
        padding: 30,
      },
      wheelSensitivity: 0.2,
    });

    cy.on("tap", "node", (evt) => {
      setSelectedId(evt.target.id() as string);
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelectedId(null);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [filtered]);

  // Fetch detail when a node is selected.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    fetch(`/api/entities/${selectedId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (!cancelled) setDetail(j.data as EntityDetailData);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const toggleType = (t: EntityType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const selectFromPanel = (id: string) => {
    setSelectedId(id);
    const cy = cyRef.current;
    if (cy) {
      cy.$("node:selected").unselect();
      const node = cy.$id(id);
      if (node.nonempty()) {
        node.select();
        cy.animate({ center: { eles: node } }, { duration: 250 });
      }
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities…"
            className="w-48 rounded-lg border border-line bg-ink-0 px-3 py-1.5 text-sm text-ink-4 placeholder:text-ink-2 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {presentTypes.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-opacity ${
                activeTypes.has(t) ? "border-line text-ink-4" : "border-line text-ink-2 opacity-40"
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[t] }}
              />
              {t}
            </button>
          ))}
        </div>
        <div
          ref={containerRef}
          className="h-[560px] rounded-2xl border border-line bg-ink-0"
        />
        <p className="text-xs text-ink-2">
          {filtered.nodes.length} entities · {filtered.edges.length} connections — node size =
          importance, click a node for details. The graph grows as captures mention people,
          companies and projects.
        </p>
      </div>
      <EntityPanel
        detail={detail}
        loading={loadingDetail}
        selected={Boolean(selectedId)}
        onSelectEntity={selectFromPanel}
      />
    </div>
  );
}

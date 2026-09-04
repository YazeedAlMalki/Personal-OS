import type { EntityType } from "@/lib/ai/types";

// Row shapes for the graph tables (migration 0006).

export type EntityMetadata = {
  mention_count?: number;
  last_mentioned_at?: string; // ISO timestamp
  [key: string]: unknown;
};

export type EntityRow = {
  id: string;
  user_id: string;
  name: string;
  entity_type: EntityType;
  description: string | null;
  importance_score: number;
  metadata: EntityMetadata;
  created_at: string;
  updated_at: string;
};

export type EntityRelationshipRow = {
  id: string;
  user_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// /api/graph payload — what Cytoscape renders.
export type GraphNode = {
  id: string;
  name: string;
  entity_type: EntityType;
  importance_score: number;
  degree: number;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relationship_type: string;
  strength: number | null;
};

export type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[] };

// /api/entities/[id] payload — node + everything connected to it.
export type EntityNeighbor = {
  relationship_id: string;
  relationship_type: string;
  strength: number | null;
  direction: "out" | "in";
  entity: Pick<EntityRow, "id" | "name" | "entity_type" | "importance_score">;
};

export type EntityDetail = {
  entity: EntityRow;
  neighbors: EntityNeighbor[];
  contact: {
    id: string;
    name: string;
    company: string | null;
    role: string | null;
    email: string | null;
    last_contacted_at: string | null;
  } | null;
  tasks: Array<{ id: string; title: string; status: string; due_date: string | null }>;
  opportunities: Array<{
    id: string;
    title: string;
    status: string;
    estimated_value: number | null;
  }>;
};

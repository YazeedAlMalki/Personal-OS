import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGraph } from "@/lib/domains/entities";
import { ENTITY_TYPES, type EntityType } from "@/lib/ai/types";

// GET /api/graph?types=person,company — nodes + edges for the Cytoscape view.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const typesParam = searchParams.get("types");
  const types = typesParam
    ? (typesParam
        .split(",")
        .map((t) => t.trim())
        .filter((t) => (ENTITY_TYPES as readonly string[]).includes(t)) as EntityType[])
    : undefined;
  try {
    const data = await getGraph(supabase, types && types.length ? types : undefined);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/graph]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

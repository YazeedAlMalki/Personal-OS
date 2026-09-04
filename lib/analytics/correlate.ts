import { round } from "@/lib/scoring/util";

// Cross-domain analytics (architecture §9.3). Rank correlation + cautious wording.
// Honesty guardrails: min sample size, Spearman (rank) not Pearson to resist outliers,
// explicit "association not causation" language. NO causal or medical claims.

export const MIN_PAIRS = 14;

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i] ?? 0;
    sy += ys[i] ?? 0;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = (xs[i] ?? 0) - mx;
    const b = (ys[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

// Tie-aware average ranks (1-based).
export function rank(values: number[]): number[] {
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1]?.v ?? NaN) === (order[i]?.v ?? NaN)) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      const entry = order[k];
      if (entry) ranks[entry.i] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

export function spearman(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  return pearson(rank(xs.slice(0, n)), rank(ys.slice(0, n)));
}

// Align two date-keyed series on shared dates.
export function pairByDate(
  a: { date: string; value: number }[],
  b: { date: string; value: number }[],
): { xs: number[]; ys: number[] } {
  const mb = new Map(b.map((p) => [p.date, p.value]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of a) {
    const y = mb.get(p.date);
    if (y !== undefined) {
      xs.push(p.value);
      ys.push(y);
    }
  }
  return { xs, ys };
}

export type CorrelationStrength = "negligible" | "weak" | "moderate" | "strong";

export function strengthOf(rho: number): CorrelationStrength {
  const a = Math.abs(rho);
  if (a < 0.2) return "negligible";
  if (a < 0.4) return "weak";
  if (a < 0.6) return "moderate";
  return "strong";
}

export type CorrelationResult = {
  label: string;
  n: number;
  rho: number | null;
  strength: CorrelationStrength | null;
  sentence: string;
};

// label should read like "more sleep" / "more tasks completed" for a natural sentence.
export function summarizeCorrelation(
  labelA: string,
  labelB: string,
  xs: number[],
  ys: number[],
): CorrelationResult {
  const n = Math.min(xs.length, ys.length);
  if (n < MIN_PAIRS) {
    return {
      label: `${labelA} vs ${labelB}`,
      n,
      rho: null,
      strength: null,
      sentence: `Not enough data yet to compare ${labelA} and ${labelB} (need ${MIN_PAIRS}+ paired days, have ${n}).`,
    };
  }
  const rho = round(spearman(xs, ys), 2);
  const strength = strengthOf(rho);
  const dir = rho >= 0 ? "also tended to be higher" : "tended to be lower";
  const sentence =
    strength === "negligible"
      ? `No meaningful association between ${labelA} and ${labelB} (n=${n}).`
      : `Days with more ${labelA} ${dir} in ${labelB} (${strength} association, n=${n} — not necessarily causal).`;
  return { label: `${labelA} vs ${labelB}`, n, rho, strength, sentence };
}

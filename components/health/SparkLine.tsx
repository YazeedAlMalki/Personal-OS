// Inline SVG sparkline — no chart library, no runtime cost. Renders a smooth
// line through values; gaps (null/undefined) leave a break so missing days are
// visible rather than averaged-away.

export function SparkLine({
  values,
  width = 120,
  height = 32,
  stroke = "currentColor",
  fill = "transparent",
}: {
  values: Array<number | null | undefined>;
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}) {
  const cleaned = values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  const has = cleaned.filter((v): v is number => v !== null);
  if (has.length < 2) {
    return (
      <svg width={width} height={height} className="text-ink-3" aria-hidden="true">
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke={stroke}
          strokeWidth={1}
          opacity={0.4}
        />
      </svg>
    );
  }
  const min = Math.min(...has);
  const max = Math.max(...has);
  const span = Math.max(1e-6, max - min);
  const stepX = cleaned.length > 1 ? width / (cleaned.length - 1) : 0;

  // Build a path that breaks across null points via "M" moves.
  let d = "";
  cleaned.forEach((v, i) => {
    if (v === null) return;
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 2) - 1;
    if (d === "" || cleaned[i - 1] === null) d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    else d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} stroke={stroke} strokeWidth={1.5} fill={fill} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

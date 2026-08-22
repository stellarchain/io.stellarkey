"use client";

export function Sparkline({
  values,
  width = 148,
  height = 40,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fdda24" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fdda24" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline
        points={line}
        fill="none"
        stroke="#fdda24"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill="#fdda24" />
    </svg>
  );
}

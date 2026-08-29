"use client";

import { useMemo, useRef, useState } from "react";
import { fmtFiat, type FiatCurrency } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";

export interface ChartPoint {
  t: number;
  p: number;
}

function timeLabel(t: number, range: string): string {
  const d = new Date(t);
  if (range === "1D") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (range === "1Y") {
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PriceChart({
  points,
  range,
  currency,
  rates,
}: {
  points: ChartPoint[];
  range: string;
  currency: FiatCurrency;
  rates: Partial<Record<FiatCurrency, number>>;
}) {
  const W = 500;
  const H = 160;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { coords, rawMin, rawMax } = useMemo(() => {
    if (points.length === 0) {
      return { min: 0, max: 0, coords: [], rawMin: 0, rawMax: 0 };
    }
    const ps = points.map((pt) => pt.p);
    let lo = Math.min(...ps);
    let hi = Math.max(...ps);
    const pad = (hi - lo) * 0.12 || hi * 0.01;
    lo -= pad;
    hi += pad;
    const span = hi - lo || 1;
    const cs = points.map((pt, i) => ({
      x: (i / Math.max(1, points.length - 1)) * W,
      y: H - ((pt.p - lo) / span) * H,
      t: pt.t,
      p: pt.p,
    }));
    return { min: lo, max: hi, coords: cs, rawMin: Math.min(...ps), rawMax: Math.max(...ps) };
  }, [points]);

  if (coords.length === 0) return null;

  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const up = coords[coords.length - 1].p >= coords[0].p;
  const stroke = up ? "#30D158" : "#FF453A";
  const hoverPt = hover !== null ? coords[hover] : null;
  const startPrice = points[0]?.p ?? 1;
  const hoverDeltaPct = hoverPt ? ((hoverPt.p - startPrice) / startPrice) * 100 : null;

  function updateHoverPosition(clientX: number) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const rx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const idx = Math.min(coords.length - 1, Math.max(0, Math.round(rx * (coords.length - 1))));
    if (idx !== hover) {
      setHover(idx);
      triggerHaptic("selection");
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    updateHoverPosition(e.clientX);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches[0]) {
      updateHoverPosition(e.touches[0].clientX);
    }
  }

  return (
    <div className="relative select-none">
      {/* Interactive Price HUD — fixed-height slot so hover never shifts layout */}
      <div className="mb-2 flex h-[30px] items-center justify-between">
        {hoverPt ? (
          <div className="fade-up flex items-baseline gap-2">
            <span className="mono text-[20px] font-semibold text-white">
              {fmtFiat(hoverPt.p, currency, rates)}
            </span>
            <span className="text-[12px] text-neutral-400">
              {timeLabel(hoverPt.t, range)}
            </span>
            {hoverDeltaPct !== null && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                style={{
                  color: hoverDeltaPct >= 0 ? "#30D158" : "#FF453A",
                  background: hoverDeltaPct >= 0 ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)",
                }}
              >
                {hoverDeltaPct >= 0 ? "+" : ""}
                {hoverDeltaPct.toFixed(2)}%
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-[11.5px] text-neutral-400">
            <span>
              Low: <strong className="mono font-semibold text-neutral-200">{fmtFiat(rawMin, currency, rates)}</strong>
            </span>
            <span>
              High: <strong className="mono font-semibold text-neutral-200">{fmtFiat(rawMax, currency, rates)}</strong>
            </span>
          </div>
        )}
      </div>

      {/* SVG Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full overflow-visible cursor-crosshair touch-none"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
        onTouchStart={onTouchMove}
        onTouchMove={onTouchMove}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id="price-chart-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
            <stop offset="85%" stopColor={stroke} stopOpacity="0.02" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.00" />
          </linearGradient>
        </defs>

        {/* Gradient fill */}
        <polygon points={area} fill="url(#price-chart-grad)" />

        {/* Chart line */}
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={line}
        />

        {/* Interactive hover line & dot */}
        {hoverPt && (
          <g>
            <line
              x1={hoverPt.x}
              y1={0}
              x2={hoverPt.x}
              y2={H}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={hoverPt.x}
              cy={hoverPt.y}
              r="4.5"
              fill="#FFFFFF"
              stroke={stroke}
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
    </div>
  );
}

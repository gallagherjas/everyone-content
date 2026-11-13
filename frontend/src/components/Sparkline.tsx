import { useId } from "react";

/** 迷你趋势面积图:纯 SVG 渐变填充,无图表依赖;空值断开,不足两点不绘制。 */
export function Sparkline({ values, color = "var(--color-brand)", width = 140, height = 44 }: {
  values: (number | null)[]; color?: string; width?: number; height?: number;
}) {
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  const gid = useId();
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...points.map(p => p.v)), max = Math.max(...points.map(p => p.v)), span = max - min || 1;
  const x = (i: number) => 1 + (i / (values.length - 1)) * (width - 2);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const line = points.map((p, n) => `${n ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${x(points.at(-1)!.i).toFixed(1)},${height} L${x(points[0].i).toFixed(1)},${height} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

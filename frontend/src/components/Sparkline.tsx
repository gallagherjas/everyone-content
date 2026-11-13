import { useId } from "react";

/** 迷你趋势面积图:纯 SVG 渐变填充,无图表依赖;宽度撑满容器(100%),空值断开,不足两点不绘制。 */
export function Sparkline({ values, color = "var(--color-brand)", height = 44, className = "w-full" }: {
  values: (number | null)[]; color?: string; height?: number; className?: string;
}) {
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  const gid = useId();
  if (points.length < 2) return <svg className={className} height={height} aria-hidden="true" />;
  const min = Math.min(...points.map(p => p.v)), max = Math.max(...points.map(p => p.v)), span = max - min || 1;
  // viewBox 用 100 个横向单位随容器拉伸;non-scaling-stroke 保证线条粗细不随拉伸变化。
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const line = points.map((p, n) => `${n ? "L" : "M"}${x(p.i).toFixed(2)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg className={className} height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${x(points.at(-1)!.i).toFixed(2)},${height} L${x(points[0].i).toFixed(2)},${height} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

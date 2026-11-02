import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';

/**
 * Responsive, zero-dependency SVG analytics chart component supporting:
 * - 'area': Smooth area + line chart for time-series sending activity
 * - 'bar': Grouped bar chart for Replies vs Bounces or Campaign comparisons
 */
export function AnalyticsChart({
  title,
  subtitle,
  type = 'area',
  data = [],
  series = [
    { key: 'sent', label: 'Emails Sent', color: '#059669' },
    { key: 'replies', label: 'Replies', color: '#2563EB' }
  ],
  xKey = 'label',
  height = 240,
  rightHeader = null,
  emptyMessage = 'No activity recorded for the selected time range.'
}) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const hasNonZeroData =
    Array.isArray(data) &&
    data.length > 0 &&
    data.some((d) => series.some((s) => Number(d[s.key] || 0) > 0));

  const maxVal = Math.max(
    4,
    ...data.flatMap((d) => series.map((s) => Number(d[s.key] || 0)))
  );

  // Compute nice Y-axis ticks
  const yTicks = [0, Math.round(maxVal * 0.25), Math.round(maxVal * 0.5), Math.round(maxVal * 0.75), maxVal];
  const uniqueTicks = [...new Set(yTicks)];

  return (
    <div className="saas-card p-5 flex flex-col justify-between">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          {rightHeader}
        </div>
      </div>

      {!hasNonZeroData ? (
        <div
          className="flex flex-col items-center justify-center text-center py-12"
          style={{ minHeight: `${height}px` }}
        >
          <div className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-400 mb-2">
            <BarChart3 className="w-4 h-4" />
          </div>
          <p className="text-xs font-medium text-slate-600">{emptyMessage}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Metrics will populate automatically as campaigns send and receive replies.
          </p>
        </div>
      ) : (
        <div className="relative pt-4 select-none">
          <svg
            viewBox="0 0 640 220"
            className="w-full overflow-visible"
            style={{ height: `${height}px` }}
            onMouseLeave={() => setHoverIndex(null)}
          >
            {/* Horizontal grid lines */}
            {uniqueTicks.map((tick, idx) => {
              const y = 185 - (tick / maxVal) * 155;
              return (
                <g key={idx}>
                  <line
                    x1={36}
                    x2={624}
                    y1={y}
                    y2={y}
                    stroke="#F1F5F9"
                    strokeWidth="1"
                  />
                  <text
                    x={28}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}

            {type === 'area' ? (
              <>
                {series.map((s, sIdx) => {
                  const points = data.map((d, i) => {
                    const x =
                      data.length === 1
                        ? 330
                        : 48 + (i / (data.length - 1)) * 564;
                    const val = Number(d[s.key] || 0);
                    const y = 185 - (val / maxVal) * 155;
                    return { x, y, val };
                  });

                  const linePath = points
                    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                    .join(' ');

                  const areaPath =
                    points.length > 1
                      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} 185 L ${points[0].x.toFixed(1)} 185 Z`
                      : '';

                  return (
                    <g key={s.key}>
                      {sIdx === 0 && areaPath && (
                        <path d={areaPath} fill={s.color} fillOpacity="0.08" />
                      )}
                      <path
                        d={linePath}
                        fill="none"
                        stroke={s.color}
                        strokeWidth="2.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {points.map((p, i) => (
                        <circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={hoverIndex === i ? 4.5 : 2.75}
                          fill="#FFFFFF"
                          stroke={s.color}
                          strokeWidth="2"
                        />
                      ))}
                    </g>
                  );
                })}
              </>
            ) : (
              /* Grouped Bar Chart */
              <>
                {data.map((d, i) => {
                  const slotWidth = 564 / Math.max(1, data.length);
                  const groupX = 48 + i * slotWidth;
                  const barWidth = Math.min(24, Math.max(8, (slotWidth * 0.65) / series.length));
                  const groupTotalWidth = barWidth * series.length + (series.length - 1) * 3;
                  const startX = groupX + (slotWidth - groupTotalWidth) / 2;

                  return (
                    <g key={i}>
                      {series.map((s, sIdx) => {
                        const val = Number(d[s.key] || 0);
                        const barH = Math.max(2, (val / maxVal) * 155);
                        const x = startX + sIdx * (barWidth + 3);
                        const y = 185 - barH;
                        return (
                          <rect
                            key={s.key}
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barH}
                            rx={3}
                            fill={s.color}
                            fillOpacity={hoverIndex === i ? 1 : 0.85}
                          />
                        );
                      })}
                    </g>
                  );
                })}
              </>
            )}

            {/* X-axis labels & interactive hover columns */}
            {data.map((d, i) => {
              const x =
                type === 'area'
                  ? data.length === 1
                    ? 330
                    : 48 + (i / (data.length - 1)) * 564
                  : 48 + (i + 0.5) * (564 / Math.max(1, data.length));
              const showLabel =
                data.length <= 10 || i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 6) === 0;

              return (
                <g key={i}>
                  {showLabel && (
                    <text
                      x={x}
                      y={206}
                      textAnchor="middle"
                      className="fill-slate-400 text-[10px]"
                    >
                      {String(d[xKey] || '').slice(0, 14)}
                    </text>
                  )}
                  <rect
                    x={x - 280 / Math.max(1, data.length)}
                    y={15}
                    width={560 / Math.max(1, data.length)}
                    height={175}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoverIndex(i)}
                  />
                </g>
              );
            })}
          </svg>

          {/* Hover Tooltip */}
          {hoverIndex !== null && data[hoverIndex] && (
            <div className="absolute top-2 right-2 bg-[#0B1324] text-white rounded-lg px-3 py-2 text-xs shadow-elevated pointer-events-none border border-slate-800">
              <div className="font-semibold text-slate-200 mb-1">
                {data[hoverIndex][xKey]}
              </div>
              <div className="space-y-0.5">
                {series.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-4">
                    <span className="text-slate-400">{s.label}:</span>
                    <span className="font-mono font-semibold">{data[hoverIndex][s.key] ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

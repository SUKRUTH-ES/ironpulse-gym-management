// Dependency-free charts rendered on the server as HTML.
// One series each, single teal hue; hover any mark to see its exact value.

// Vertical bars (e.g. revenue per month). rows: [{ label, value }]
export function ColumnChart({ rows, format = (v) => v, height = 180 }) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    const peak = rows.reduce((best, r) => (r.value > (best?.value ?? -1) ? r : best), null);
    const last = rows.at(-1);
    return (
        <div>
            <div className="relative flex items-end gap-[2px] border-b border-slate-300" style={{ height }}>
                {[0.25, 0.5, 0.75, 1].map((f) => (
                    <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-slate-100" style={{ bottom: `${f * 100}%` }} />
                ))}
                {rows.map((r) => {
                    const showLabel = r === peak || r === last;
                    return (
                        <div key={r.label} className="group relative flex h-full flex-1 items-end justify-center">
                            {showLabel && (
                                <span className="absolute text-[11px] font-medium text-slate-600 tabular-nums" style={{ bottom: `calc(${(r.value / max) * 100}% + 4px)` }}>
                                    {format(r.value)}
                                </span>
                            )}
                            <div
                                className="w-full max-w-10 rounded-t-[4px] bg-teal-600 transition-colors group-hover:bg-teal-800"
                                style={{ height: `${(r.value / max) * 100}%`, minHeight: r.value > 0 ? 2 : 0 }}
                            />
                            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow group-hover:block">
                                {r.label}: <span className="font-semibold">{format(r.value)}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="mt-1.5 flex gap-[2px]">
                {rows.map((r) => (
                    <span key={r.label} className="flex-1 truncate text-center text-[11px] text-slate-500">{r.shortLabel ?? r.label}</span>
                ))}
            </div>
        </div>
    );
}

// Weekday x hour heatmap (e.g. gym check-ins). cells: [{ weekday 0-6, hour, value }]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STEPS = ['bg-slate-100', 'bg-teal-100', 'bg-teal-200', 'bg-teal-400', 'bg-teal-600', 'bg-teal-800'];

export function Heatmap({ cells, hours, valueLabel = 'visits' }) {
    const max = Math.max(1, ...cells.map((c) => c.value));
    const lookup = new Map(cells.map((c) => [`${c.weekday}|${c.hour}`, c.value]));
    const step = (v) => (v === 0 ? 0 : Math.min(STEPS.length - 1, 1 + Math.floor((v / max) * (STEPS.length - 1.01))));
    return (
        <div className="overflow-x-auto">
            <table className="border-separate" style={{ borderSpacing: 2 }}>
                <thead>
                    <tr>
                        <th />
                        {hours.map((h) => (
                            <th key={h} className="px-0.5 text-[10px] font-normal text-slate-500">{h % 3 === 0 ? `${h}:00` : ''}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {DAYS.map((d, wd) => (
                        <tr key={d}>
                            <th className="pr-2 text-left text-xs font-normal text-slate-500">{d}</th>
                            {hours.map((h) => {
                                const v = lookup.get(`${wd}|${h}`) ?? 0;
                                return (
                                    <td key={h} className="group relative p-0">
                                        <div className={`h-6 w-6 rounded-[4px] ${STEPS[step(v)]}`} />
                                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow group-hover:block">
                                            {d} {h}:00–{h + 1}:00 · <span className="font-semibold">{v}</span> {valueLabel}
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                Fewer
                {STEPS.map((s) => <span key={s} className={`h-3 w-5 rounded-[3px] ${s}`} />)}
                More
            </div>
        </div>
    );
}

// Line for a single measurement over time (e.g. body weight). points: [{ label, value }]
export function LineChart({ points, format = (v) => v, height = 160 }) {
    if (points.length < 2) return null;
    const w = 600;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.15 || 1;
    const lo = min - pad;
    const hi = max + pad;
    const x = (i) => (i / (points.length - 1)) * (w - 16) + 8;
    const y = (v) => height - 8 - ((v - lo) / (hi - lo)) * (height - 16);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    return (
        <div>
            <div className="relative" style={{ height }}>
                <svg viewBox={`0 0 ${w} ${height}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none" role="img" aria-label="Trend over time">
                    {[0.25, 0.5, 0.75].map((f) => (
                        <line key={f} x1="0" x2={w} y1={height * f} y2={height * f} className="stroke-slate-100" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    ))}
                    <path d={d} fill="none" className="stroke-teal-600" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </svg>
                {points.map((p, i) => (
                    <div key={i} className="group absolute top-0 h-full" style={{ left: `${(x(i) / w) * 100}%`, width: `${100 / points.length}%`, transform: 'translateX(-50%)' }}>
                        <span
                            className="absolute left-1/2 hidden h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-teal-700 group-hover:block"
                            style={{ top: `${(y(p.value) / height) * 100}%` }}
                        />
                        <div className="pointer-events-none absolute left-1/2 z-10 hidden -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow group-hover:block" style={{ top: `calc(${(y(p.value) / height) * 100}% - 34px)` }}>
                            {p.label}: <span className="font-semibold">{format(p.value)}</span>
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                <span>{points[0].label}</span>
                <span>{points.at(-1).label}</span>
            </div>
        </div>
    );
}

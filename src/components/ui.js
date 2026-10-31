// Small presentational building blocks shared by every page.

export function PageHeader({ title, subtitle, children }) {
    return (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
                {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            </div>
            {children && <div className="flex flex-wrap gap-2">{children}</div>}
        </div>
    );
}

export function Card({ title, subtitle, action, children, className = '' }) {
    return (
        <section className={`card ${className}`}>
            {(title || action) && (
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
                        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
                    </div>
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

export function Stat({ label, value, hint, tone = 'default' }) {
    const hintColor = { default: 'text-slate-500', good: 'text-emerald-700', bad: 'text-rose-700', warn: 'text-amber-700' }[tone];
    return (
        <div className="card">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
            {hint && <p className={`mt-1 text-xs ${hintColor}`}>{hint}</p>}
        </div>
    );
}

const BADGE = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    booked: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    attended: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    completed: 'bg-slate-100 text-slate-700 ring-slate-500/20',
    confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    scheduled: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    requested: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    waitlisted: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    frozen: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    expired: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    none: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    no_show: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    cancelled: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    refunded: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    low: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    medium: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    high: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

export function Badge({ status, children }) {
    const cls = BADGE[status] ?? 'bg-slate-100 text-slate-700 ring-slate-500/20';
    return (
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
            {children ?? String(status).replace(/_/g, ' ')}
        </span>
    );
}

export function Empty({ children }) {
    return <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">{children}</p>;
}

// Horizontal bar list: simple, readable comparison of a few values
export function BarList({ rows, format = (v) => v, color = 'bg-teal-600' }) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return (
        <ul className="space-y-2.5">
            {rows.map((r) => (
                <li key={r.label} className="text-sm">
                    <div className="mb-1 flex justify-between gap-3">
                        <span className="truncate text-slate-700">{r.label}</span>
                        <span className="tabular-nums text-slate-900">{format(r.value)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                        <div className={`h-2 rounded-full ${color}`} style={{ width: `${(r.value / max) * 100}%` }} />
                    </div>
                </li>
            ))}
        </ul>
    );
}

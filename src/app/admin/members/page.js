import Link from 'next/link';
import { sql, sqlOne } from '@/lib/db';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { date, label } from '@/lib/format';
import { requireRole } from '@/lib/auth';

export const metadata = { title: 'Members' };

const PAGE_SIZE = 25;
const STATUSES = ['active', 'frozen', 'expired', 'none'];

export default async function MembersPage({ searchParams }) {
    await requireRole('admin');
    const { q = '', status = '', page = '1' } = await searchParams;
    const pageNo = Math.max(1, Number.parseInt(page, 10) || 1);

    const where = [];
    const params = [];
    if (q.trim()) {
        where.push('(full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR member_code LIKE ?)');
        const like = `%${q.trim()}%`;
        params.push(like, like, like, like);
    }
    if (STATUSES.includes(status)) {
        where.push('membership_status = ?');
        params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, total, counts] = await Promise.all([
        sql(`SELECT member_id, member_code, full_name, email, phone, plan_name, membership_status, membership_end, last_visit, is_active
             FROM v_member_overview ${whereSql}
             ORDER BY full_name LIMIT ? OFFSET ?`, [...params, String(PAGE_SIZE), String((pageNo - 1) * PAGE_SIZE)]),
        sqlOne(`SELECT COUNT(*) AS n FROM v_member_overview ${whereSql}`, params),
        sql('SELECT membership_status, COUNT(*) AS n FROM v_member_overview GROUP BY membership_status'),
    ]);
    const pages = Math.max(1, Math.ceil(total.n / PAGE_SIZE));
    const countOf = Object.fromEntries(counts.map((c) => [c.membership_status, c.n]));
    const link = (overrides) => {
        const sp = new URLSearchParams({ q, status, page: String(pageNo), ...overrides });
        for (const [k, v] of [...sp]) if (!v || (k === 'page' && v === '1')) sp.delete(k);
        return `/admin/members${sp.size ? `?${sp}` : ''}`;
    };

    return (
        <>
            <PageHeader title="Members" subtitle={`${total.n} member${total.n === 1 ? '' : 's'}`} />

            <Card>
                <form className="mb-4 flex flex-wrap gap-2" action="/admin/members">
                    <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Search name, e-mail, phone or code" />
                    {status && <input type="hidden" name="status" value={status} />}
                    <button className="btn btn-secondary">Search</button>
                </form>
                <div className="mb-4 flex flex-wrap gap-2">
                    {['', ...STATUSES].map((s) => (
                        <Link key={s || 'all'} href={link({ status: s, page: '1' })}
                            className={`rounded-full border px-3 py-1 text-xs font-medium ${status === s ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                            {s ? `${label(s)} (${countOf[s] ?? 0})` : 'All'}
                        </Link>
                    ))}
                </div>

                {rows.length ? (
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead><tr><th>Member</th><th>Code</th><th>Phone</th><th>Plan</th><th>Status</th><th>Plan ends</th><th>Last visit</th></tr></thead>
                            <tbody>
                                {rows.map((m) => (
                                    <tr key={m.member_id}>
                                        <td>
                                            <Link href={`/admin/members/${m.member_id}`} className="font-medium text-teal-700 hover:underline">{m.full_name}</Link>
                                            {!m.is_active && <span className="ml-2 text-xs text-rose-700">deactivated</span>}
                                            <div className="text-xs text-slate-500">{m.email}</div>
                                        </td>
                                        <td className="font-mono text-xs">{m.member_code}</td>
                                        <td className="tabular-nums">{m.phone}</td>
                                        <td>{m.plan_name ?? '—'}</td>
                                        <td><Badge status={m.membership_status} /></td>
                                        <td>{date(m.membership_end)}</td>
                                        <td>{date(m.last_visit)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <Empty>No members match.</Empty>}

                {pages > 1 && (
                    <div className="mt-4 flex items-center justify-between text-sm">
                        <span className="text-slate-500">Page {pageNo} of {pages}</span>
                        <div className="flex gap-2">
                            {pageNo > 1 && <Link className="btn btn-secondary btn-sm" href={link({ page: String(pageNo - 1) })}>Previous</Link>}
                            {pageNo < pages && <Link className="btn btn-secondary btn-sm" href={link({ page: String(pageNo + 1) })}>Next</Link>}
                        </div>
                    </div>
                )}
            </Card>
        </>
    );
}

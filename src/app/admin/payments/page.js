import Link from 'next/link';
import { sql, sqlOne } from '@/lib/db';
import { PageHeader, Card, Badge, Empty, Stat } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { refundPayment } from '../actions';
import { inr, num, dateTime, label, isoDay, payMethod } from '@/lib/format';

export const metadata = { title: 'Payments' };

const METHODS = ['upi', 'card', 'cash', 'netbanking'];

export default async function PaymentsPage({ searchParams }) {
    const sp = await searchParams;
    const today = new Date();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from : isoDay(new Date(today.getFullYear(), today.getMonth(), 1));
    const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to : isoDay(today);
    const method = METHODS.includes(sp.method) ? sp.method : '';

    const where = ['pay.paid_at >= ?', 'pay.paid_at < ? + INTERVAL 1 DAY'];
    const params = [from, to];
    if (method) {
        where.push('pay.method = ?');
        params.push(method);
    }
    const whereSql = where.join(' AND ');

    const [rows, totals] = await Promise.all([
        sql(`SELECT pay.payment_id, pay.paid_at, pay.amount, pay.method, pay.status, pay.transaction_ref,
                    m.member_id, u.full_name,
                    CASE WHEN pay.membership_id IS NOT NULL THEN p.name ELSE 'Personal training' END AS paid_for
             FROM payments pay
             JOIN members m ON m.member_id = pay.member_id
             JOIN users u   ON u.user_id = m.user_id
             LEFT JOIN memberships ms     ON ms.membership_id = pay.membership_id
             LEFT JOIN membership_plans p ON p.plan_id = ms.plan_id
             WHERE ${whereSql}
             ORDER BY pay.paid_at DESC LIMIT 200`, params),
        sqlOne(`SELECT COUNT(*) AS n,
                       COALESCE(SUM(CASE WHEN status = 'completed' THEN amount END), 0) AS collected,
                       COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount END), 0) AS refunded,
                       COALESCE(AVG(CASE WHEN status = 'completed' THEN amount END), 0) AS average
                FROM payments pay WHERE ${whereSql}`, params),
    ]);

    return (
        <>
            <PageHeader title="Payments" subtitle="Payments are never deleted. A refund keeps the record and marks it refunded." />

            <form className="card mb-6 flex flex-wrap items-end gap-3" action="/admin/payments">
                <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>
                <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
                <div>
                    <label className="label" htmlFor="method">Method</label>
                    <select id="method" name="method" defaultValue={method} className="input">
                        <option value="">All methods</option>
                        {METHODS.map((m) => <option key={m} value={m}>{payMethod(m)}</option>)}
                    </select>
                </div>
                <button className="btn btn-secondary">Apply</button>
            </form>

            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Collected" value={inr(totals.collected)} />
                <Stat label="Refunded" value={inr(totals.refunded)} tone={totals.refunded ? 'bad' : 'default'} />
                <Stat label="Payments" value={num(totals.n)} />
                <Stat label="Average payment" value={inr(totals.average)} />
            </div>

            <Card>
                {rows.length ? (
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead><tr><th>When</th><th>Member</th><th>For</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
                            <tbody>
                                {rows.map((p) => (
                                    <tr key={p.payment_id}>
                                        <td className="whitespace-nowrap">{dateTime(p.paid_at)}</td>
                                        <td><Link href={`/admin/members/${p.member_id}`} className="font-medium text-teal-700 hover:underline">{p.full_name}</Link></td>
                                        <td>{p.paid_for}</td>
                                        <td>{payMethod(p.method)}</td>
                                        <td className="font-mono text-xs text-slate-500">{p.transaction_ref}</td>
                                        <td className="num">{inr(p.amount)}</td>
                                        <td><Badge status={p.status} /></td>
                                        <td className="text-right">
                                            {p.status === 'completed' && (
                                                <ActionForm action={refundPayment} inlineMessage>
                                                    <input type="hidden" name="payment_id" value={p.payment_id} />
                                                    <SubmitButton className="btn btn-danger btn-sm">Refund</SubmitButton>
                                                </ActionForm>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <Empty>No payments in this period.</Empty>}
            </Card>
        </>
    );
}

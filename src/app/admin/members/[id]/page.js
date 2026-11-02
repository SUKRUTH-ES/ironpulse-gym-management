import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { sql, sqlOne } from '@/lib/db';
import { PageHeader, Card, Badge, Empty, Stat } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { sellMembership, refundPayment, setMemberActive } from '../../actions';
import { inr, date, dateTime, label, payMethod, plural } from '@/lib/format';

// Browser tab shows the member's name
export async function generateMetadata({ params }) {
    await requireRole('admin');
    const { id } = await params;
    const m = await sqlOne('SELECT full_name FROM users u JOIN members m ON m.user_id = u.user_id WHERE m.member_id = ?', [Number.parseInt(id, 10)]);
    return { title: m ? m.full_name : 'Member' };
}

export default async function MemberDetail({ params }) {
    await requireRole('admin');
    const { id } = await params;
    const memberId = Number.parseInt(id, 10);
    const m = await sqlOne('SELECT * FROM v_member_overview WHERE member_id = ?', [memberId]);
    if (!m) notFound();

    const [memberships, payments, visits, stats, bookingStats, plans] = await Promise.all([
        sql(`SELECT ms.membership_id, p.name AS plan_name, ms.start_date, ms.end_date, ms.status, ms.freeze_days_used
             FROM memberships ms JOIN membership_plans p ON p.plan_id = ms.plan_id
             WHERE ms.member_id = ? ORDER BY ms.start_date DESC`, [memberId]),
        sql(`SELECT pay.payment_id, pay.amount, pay.method, pay.status, pay.paid_at, pay.transaction_ref,
                    COALESCE(p.name, CONCAT('PT with ', tu.full_name)) AS paid_for
             FROM payments pay
             LEFT JOIN memberships ms     ON ms.membership_id = pay.membership_id
             LEFT JOIN membership_plans p ON p.plan_id = ms.plan_id
             LEFT JOIN pt_sessions ps     ON ps.pt_session_id = pay.pt_session_id
             LEFT JOIN trainers t         ON t.trainer_id = ps.trainer_id
             LEFT JOIN users tu           ON tu.user_id = t.user_id
             WHERE pay.member_id = ? ORDER BY pay.paid_at DESC`, [memberId]),
        sql(`SELECT check_in, check_out, TIMESTAMPDIFF(MINUTE, check_in, check_out) AS minutes
             FROM attendance WHERE member_id = ? ORDER BY check_in DESC LIMIT 8`, [memberId]),
        sqlOne(`SELECT COUNT(*) AS total_visits,
                    SUM(check_in >= CURRENT_DATE - INTERVAL 30 DAY) AS visits_30d,
                    ROUND(AVG(TIMESTAMPDIFF(MINUTE, check_in, check_out))) AS avg_minutes
                FROM attendance WHERE member_id = ?`, [memberId]),
        sql('SELECT status, COUNT(*) AS n FROM class_bookings WHERE member_id = ? GROUP BY status', [memberId]),
        sql('SELECT plan_id, name, price, duration_days FROM membership_plans WHERE is_active ORDER BY price'),
    ]);
    const booked = Object.fromEntries(bookingStats.map((b) => [b.status, b.n]));
    const totalPaid = payments.filter((p) => p.status === 'completed').reduce((s, p) => s + p.amount, 0);

    return (
        <>
            <PageHeader title={m.full_name} subtitle={`${m.member_code} · ${m.email} · ${m.phone}`}>
                <Badge status={m.membership_status} />
            </PageHeader>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Current plan" value={m.plan_name ?? 'None'} hint={m.membership_end ? `Ends ${date(m.membership_end)} (${plural(m.days_left, 'day')})` : 'No active plan'} />
                <Stat label="Visits (30 days)" value={stats.visits_30d ?? 0} hint={`${stats.total_visits} in total · avg ${stats.avg_minutes ?? 0} min`} />
                <Stat label="Classes attended" value={booked.attended ?? 0} hint={`${booked.no_show ?? 0} no-shows · ${booked.cancelled ?? 0} cancelled`} />
                <Stat label="Lifetime value" value={inr(totalPaid)} hint={`Member since ${date(m.joined_on)}`} />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <Card title="Sell or renew a plan" subtitle="A renewal starts the day after the current plan ends.">
                    <ActionForm action={sellMembership} className="space-y-3">
                        <input type="hidden" name="member_id" value={m.member_id} />
                        <div>
                            <label className="label" htmlFor="plan_id">Plan</label>
                            <select id="plan_id" name="plan_id" className="input" required>
                                {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.name} — {inr(p.price)} / {plural(p.duration_days, 'day')}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="label" htmlFor="method">Payment method</label>
                            <select id="method" name="method" className="input">
                                <option value="upi">UPI</option><option value="card">Card</option><option value="cash">Cash</option><option value="netbanking">Net banking</option>
                            </select>
                        </div>
                        <SubmitButton className="btn btn-primary w-full" pendingText="Processing…">Take payment</SubmitButton>
                    </ActionForm>
                    <hr className="my-5 border-slate-200" />
                    <p className="mb-2 text-sm text-slate-600">
                        {m.is_active ? 'Deactivating blocks login and check-in. History is kept.' : 'This account is deactivated.'}
                    </p>
                    <ActionForm action={setMemberActive}
                        confirm={m.is_active ? `Deactivate ${m.full_name}? They will not be able to log in or check in.` : undefined}>
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <input type="hidden" name="active" value={m.is_active ? '0' : '1'} />
                        <SubmitButton className={m.is_active ? 'btn btn-danger w-full' : 'btn btn-secondary w-full'}>
                            {m.is_active ? 'Deactivate account' : 'Re-activate account'}
                        </SubmitButton>
                    </ActionForm>
                </Card>

                <Card title="Membership history" className="lg:col-span-2">
                    {memberships.length ? (
                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead><tr><th>Plan</th><th>From</th><th>To</th><th className="num">Freeze days used</th><th>Status</th></tr></thead>
                                <tbody>
                                    {memberships.map((ms) => (
                                        <tr key={ms.membership_id}>
                                            <td className="font-medium">{ms.plan_name}</td>
                                            <td>{date(ms.start_date)}</td>
                                            <td>{date(ms.end_date)}</td>
                                            <td className="num">{ms.freeze_days_used}</td>
                                            <td><Badge status={ms.status} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : <Empty>No memberships yet.</Empty>}
                </Card>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <Card title="Payments" className="lg:col-span-2">
                    {payments.length ? (
                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead><tr><th>Date</th><th>For</th><th>Method</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
                                <tbody>
                                    {payments.map((p) => (
                                        <tr key={p.payment_id}>
                                            <td>{date(p.paid_at)}</td>
                                            <td>{p.paid_for}</td>
                                            <td>{payMethod(p.method)}</td>
                                            <td className="num">{inr(p.amount)}</td>
                                            <td><Badge status={p.status} /></td>
                                            <td className="text-right">
                                                {/* the form stays mounted after the refund so its message is still shown */}
                                                <ActionForm action={refundPayment} inlineMessage confirm={`Refund ${inr(p.amount)} for ${p.paid_for}? A refunded membership is cancelled.`}>
                                                    <input type="hidden" name="payment_id" value={p.payment_id} />
                                                    {p.status === 'completed' && <SubmitButton className="btn btn-danger btn-sm">Refund</SubmitButton>}
                                                </ActionForm>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : <Empty>No payments yet.</Empty>}
                </Card>
                <Card title="Recent visits">
                    {visits.length ? (
                        <ul className="space-y-2 text-sm">
                            {visits.map((v) => (
                                <li key={v.check_in} className="flex justify-between gap-3">
                                    <span>{dateTime(v.check_in)}</span>
                                    <span className="text-slate-500 tabular-nums">{v.minutes == null ? 'inside now' : `${v.minutes} min`}</span>
                                </li>
                            ))}
                        </ul>
                    ) : <Empty>No visits yet.</Empty>}
                </Card>
            </div>
        </>
    );
}

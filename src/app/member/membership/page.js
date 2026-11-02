import { requireRole } from '@/lib/auth';
import { sql, sqlOne } from '@/lib/db';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { buyMembership, freezeMembership, unfreezeMembership } from '../actions';
import { inr, date, label, payMethod, plural } from '@/lib/format';

export const metadata = { title: 'Membership' };

export default async function MembershipPage({ searchParams }) {
    const me = await requireRole('member');
    const { welcome } = await searchParams;

    const [current, queued, plans, history, payments] = await Promise.all([
        sqlOne('SELECT * FROM v_current_memberships WHERE member_id = ?', [me.member_id]),
        sqlOne(`SELECT p.name, ms.start_date, ms.end_date FROM memberships ms JOIN membership_plans p ON p.plan_id = ms.plan_id
                WHERE ms.member_id = ? AND ms.start_date > CURRENT_DATE AND ms.status = 'active' ORDER BY ms.start_date LIMIT 1`, [me.member_id]),
        sql('SELECT * FROM membership_plans WHERE is_active AND duration_days > 1 ORDER BY duration_days'),
        sql(`SELECT ms.membership_id, p.name, ms.start_date, ms.end_date, ms.status FROM memberships ms
             JOIN membership_plans p ON p.plan_id = ms.plan_id WHERE ms.member_id = ? ORDER BY ms.start_date DESC`, [me.member_id]),
        sql(`SELECT payment_id, paid_at, amount, method, status, transaction_ref,
                    IF(membership_id IS NOT NULL, 'Membership', 'Personal training') AS paid_for
             FROM payments WHERE member_id = ? ORDER BY paid_at DESC LIMIT 10`, [me.member_id]),
    ]);
    const freezeLeft = current ? current.max_freeze_days - current.freeze_days_used : 0;

    return (
        <>
            <PageHeader title="Membership" />
            {welcome && !current && (
                <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
                    Welcome to IronPulse! Your member code is <span className="font-mono font-semibold">{me.member_code}</span>. Pick a plan below to get started.
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-3">
                <Card title="Current plan">
                    {current ? (
                        <div className="space-y-3 text-sm">
                            <div className="flex items-center justify-between"><span className="text-lg font-semibold">{current.plan_name}</span><Badge status={current.status} /></div>
                            <p className="text-slate-600">{date(current.start_date)} – {date(current.end_date)} · {plural(current.days_left, 'day')} left</p>
                            <p className="text-slate-600">
                                {current.classes_per_week ? `${plural(current.classes_per_week, 'class', 'classes')} a week` : 'Unlimited classes'} · {plural(current.pt_sessions_included, 'PT session')} included
                            </p>
                            {queued && <p className="rounded-lg bg-slate-50 p-2 text-slate-600">Next: {queued.name} from {date(queued.start_date)}</p>}
                            {current.status === 'frozen' ? (
                                <ActionForm action={unfreezeMembership}>
                                    <p className="mb-2 text-slate-600">Frozen since {date(current.frozen_from)}.</p>
                                    <input type="hidden" name="membership_id" value={current.membership_id} />
                                    <SubmitButton className="btn btn-primary w-full">Unfreeze</SubmitButton>
                                </ActionForm>
                            ) : current.max_freeze_days > 0 ? (
                                <ActionForm action={freezeMembership}>
                                    <p className="mb-2 text-slate-600">Away for a while? Freeze for up to {plural(freezeLeft, 'more day', 'more days')}; they are added to your end date.</p>
                                    <input type="hidden" name="membership_id" value={current.membership_id} />
                                    <SubmitButton className="btn btn-secondary w-full" disabled={freezeLeft <= 0}>Freeze membership</SubmitButton>
                                </ActionForm>
                            ) : <p className="text-xs text-slate-500">This plan cannot be frozen.</p>}
                        </div>
                    ) : <Empty>No active membership.</Empty>}
                </Card>

                <Card title={current ? 'Renew or upgrade' : 'Choose a plan'} subtitle={current ? 'A new plan starts the day after your current one ends.' : 'Starts today.'} className="lg:col-span-2">
                    <ActionForm action={buyMembership} className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            {plans.map((p, i) => (
                                <label key={p.plan_id} className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50">
                                    <input type="radio" name="plan_id" value={p.plan_id} defaultChecked={i === 0} className="mt-1 accent-teal-700" />
                                    <span>
                                        <span className="block font-medium">{p.name} · {inr(p.price)}</span>
                                        <span className="block text-xs text-slate-500">{plural(p.duration_days, 'day')} · {p.description}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <div>
                                <label className="label" htmlFor="method">Pay with</label>
                                <select id="method" name="method" className="input">
                                    <option value="upi">UPI</option><option value="card">Card</option><option value="netbanking">Net banking</option>
                                </select>
                            </div>
                            <SubmitButton pendingText="Processing payment…">Pay and activate</SubmitButton>
                        </div>
                        <p className="text-xs text-slate-500">Demo payment: no real money is charged.</p>
                    </ActionForm>
                </Card>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card title="History">
                    {history.length ? (
                        <table className="data-table">
                            <thead><tr><th>Plan</th><th>From</th><th>To</th><th>Status</th></tr></thead>
                            <tbody>{history.map((h) => <tr key={h.membership_id}><td>{h.name}</td><td>{date(h.start_date)}</td><td>{date(h.end_date)}</td><td><Badge status={h.status} /></td></tr>)}</tbody>
                        </table>
                    ) : <Empty>No memberships yet.</Empty>}
                </Card>
                <Card title="Payments">
                    {payments.length ? (
                        <table className="data-table">
                            <thead><tr><th>Date</th><th>For</th><th>Method</th><th className="num">Amount</th><th>Status</th></tr></thead>
                            <tbody>{payments.map((p) => <tr key={p.payment_id}><td>{date(p.paid_at)}</td><td>{p.paid_for}</td><td>{payMethod(p.method)}</td><td className="num">{inr(p.amount)}</td><td><Badge status={p.status} /></td></tr>)}</tbody>
                        </table>
                    ) : <Empty>No payments yet.</Empty>}
                </Card>
            </div>
        </>
    );
}

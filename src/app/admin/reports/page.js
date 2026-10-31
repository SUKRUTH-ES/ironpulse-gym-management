import Link from 'next/link';
import { sql } from '@/lib/db';
import { PageHeader, Card, BarList, Empty } from '@/components/ui';
import { inr, num, date, dateTime, label, payMethod } from '@/lib/format';

export const metadata = { title: 'Reports' };

export default async function ReportsPage() {
    const [byPlan, byMethod, classStats, trainers, topMembers, churn, neverBooked, audit] = await Promise.all([
        // Revenue per plan over the last 6 months (JOIN + GROUP BY)
        sql(`SELECT p.name, COUNT(*) AS sold, SUM(pay.amount) AS revenue
             FROM payments pay
             JOIN memberships ms     ON ms.membership_id = pay.membership_id
             JOIN membership_plans p ON p.plan_id = ms.plan_id
             WHERE pay.status = 'completed' AND pay.paid_at >= CURRENT_DATE - INTERVAL 6 MONTH
             GROUP BY p.plan_id, p.name ORDER BY revenue DESC`),
        sql(`SELECT method, COUNT(*) AS n, SUM(amount) AS total FROM payments
             WHERE status = 'completed' AND paid_at >= CURRENT_DATE - INTERVAL 6 MONTH
             GROUP BY method ORDER BY total DESC`),
        // Class popularity: only class types with at least 5 finished sessions (HAVING)
        sql(`SELECT ct.name, COUNT(DISTINCT cs.class_session_id) AS sessions,
                    ROUND(AVG(fill.booked / cs.capacity) * 100, 1) AS avg_fill_pct,
                    ROUND(SUM(fill.no_show) / NULLIF(SUM(fill.booked), 0) * 100, 1) AS no_show_pct
             FROM class_sessions cs
             JOIN class_types ct ON ct.class_type_id = cs.class_type_id
             JOIN (SELECT class_session_id,
                          SUM(status IN ('attended','no_show')) AS booked,
                          SUM(status = 'no_show') AS no_show
                   FROM class_bookings GROUP BY class_session_id) fill
               ON fill.class_session_id = cs.class_session_id
             WHERE cs.status = 'completed'
             GROUP BY ct.class_type_id, ct.name
             HAVING COUNT(DISTINCT cs.class_session_id) >= 5
             ORDER BY avg_fill_pct DESC`),
        sql('SELECT * FROM v_trainer_performance ORDER BY pt_revenue DESC'),
        // Most consistent members in the last 30 days (window function RANK)
        sql(`SELECT * FROM (
                SELECT m.member_id, u.full_name, COUNT(*) AS visits,
                       RANK() OVER (ORDER BY COUNT(*) DESC) AS position
                FROM attendance a
                JOIN members m ON m.member_id = a.member_id
                JOIN users u   ON u.user_id = m.user_id
                WHERE a.check_in >= CURRENT_DATE - INTERVAL 30 DAY
                GROUP BY m.member_id, u.full_name) ranked
             WHERE position <= 10 ORDER BY position, full_name`),
        sql('SELECT * FROM v_churn_risk ORDER BY visits_last_30 / visits_prev_30'),
        // Active members who have never booked a class (NOT EXISTS subquery)
        sql(`SELECT mo.member_id, mo.full_name, mo.plan_name, mo.joined_on
             FROM v_member_overview mo
             WHERE mo.membership_status = 'active'
               AND NOT EXISTS (SELECT 1 FROM class_bookings cb WHERE cb.member_id = mo.member_id)
             ORDER BY mo.joined_on DESC`),
        sql('SELECT audit_id, table_name, record_id, action, old_value, new_value, changed_by, changed_at FROM audit_log ORDER BY audit_id DESC LIMIT 12'),
    ]);

    return (
        <>
            <PageHeader title="Reports" subtitle="Business analysis straight from the database" />

            <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Revenue by plan" subtitle="Last 6 months">
                    {byPlan.length ? <BarList rows={byPlan.map((r) => ({ label: `${r.name} (${r.sold} sold)`, value: r.revenue }))} format={inr} /> : <Empty>No sales yet.</Empty>}
                </Card>
                <Card title="Payment methods" subtitle="Last 6 months">
                    {byMethod.length ? <BarList rows={byMethod.map((r) => ({ label: `${payMethod(r.method)} (${r.n})`, value: r.total }))} format={inr} /> : <Empty>No payments yet.</Empty>}
                </Card>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card title="Class popularity" subtitle="Finished classes only; types with 5+ sessions">
                    <table className="data-table">
                        <thead><tr><th>Class</th><th className="num">Sessions</th><th className="num">Avg full</th><th className="num">No-shows</th></tr></thead>
                        <tbody>
                            {classStats.map((c) => (
                                <tr key={c.name}><td className="font-medium">{c.name}</td><td className="num">{c.sessions}</td><td className="num">{c.avg_fill_pct}%</td><td className="num">{c.no_show_pct ?? 0}%</td></tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
                <Card title="Trainer performance">
                    <table className="data-table">
                        <thead><tr><th>Trainer</th><th className="num">Classes</th><th className="num">Avg full</th><th className="num">PT done</th><th className="num">PT revenue</th></tr></thead>
                        <tbody>
                            {trainers.map((t) => (
                                <tr key={t.trainer_id}>
                                    <td><div className="font-medium">{t.trainer_name}</div><div className="text-xs text-slate-500">{t.specialization}</div></td>
                                    <td className="num">{t.classes_taught}</td><td className="num">{t.avg_occupancy_pct}%</td>
                                    <td className="num">{t.pt_sessions_completed}</td><td className="num">{inr(t.pt_revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card title="Most consistent members" subtitle="Ranked by visits in the last 30 days">
                    <table className="data-table">
                        <thead><tr><th className="num">#</th><th>Member</th><th className="num">Visits</th></tr></thead>
                        <tbody>
                            {topMembers.map((m) => (
                                <tr key={m.member_id}>
                                    <td className="num">{m.position}</td>
                                    <td><Link href={`/admin/members/${m.member_id}`} className="text-teal-700 hover:underline">{m.full_name}</Link></td>
                                    <td className="num">{m.visits}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
                <Card title="Active members who never booked a class" subtitle="Good people to invite to a free trial class">
                    {neverBooked.length ? (
                        <table className="data-table">
                            <thead><tr><th>Member</th><th>Plan</th><th>Joined</th></tr></thead>
                            <tbody>
                                {neverBooked.map((m) => (
                                    <tr key={m.member_id}>
                                        <td><Link href={`/admin/members/${m.member_id}`} className="text-teal-700 hover:underline">{m.full_name}</Link></td>
                                        <td>{m.plan_name}</td><td>{date(m.joined_on)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <Empty>Every active member has booked at least one class.</Empty>}
                </Card>
            </div>

            <Card title="Churn risk" subtitle="Members with a plan whose visits fell to under half of the previous month" className="mt-6">
                <div id="churn" className="overflow-x-auto">
                    <table className="data-table">
                        <thead><tr><th>Member</th><th>Phone</th><th>Plan ends</th><th className="num">Visits before</th><th className="num">Last 30 days</th><th className="num">Days since visit</th></tr></thead>
                        <tbody>
                            {churn.map((m) => (
                                <tr key={m.member_id}>
                                    <td><Link href={`/admin/members/${m.member_id}`} className="font-medium text-teal-700 hover:underline">{m.full_name}</Link></td>
                                    <td className="tabular-nums">{m.phone}</td><td>{date(m.membership_end)}</td>
                                    <td className="num">{m.visits_prev_30}</td><td className="num">{m.visits_last_30}</td><td className="num">{m.days_since_last_visit}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card title="Audit log" subtitle={`Written by triggers on payments and memberships · latest ${num(audit.length)}`} className="mt-6">
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead><tr><th>When</th><th>Table</th><th>Record</th><th>Action</th><th>Change</th><th>By</th></tr></thead>
                        <tbody>
                            {audit.map((a) => (
                                <tr key={a.audit_id}>
                                    <td className="whitespace-nowrap">{dateTime(a.changed_at)}</td>
                                    <td className="font-mono text-xs">{a.table_name}</td>
                                    <td className="num">{a.record_id}</td>
                                    <td>{a.action}</td>
                                    <td className="font-mono text-xs text-slate-600">
                                        {a.old_value && <span>{JSON.stringify(a.old_value)} → </span>}{JSON.stringify(a.new_value)}
                                    </td>
                                    <td className="text-xs text-slate-500">{a.changed_by}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </>
    );
}

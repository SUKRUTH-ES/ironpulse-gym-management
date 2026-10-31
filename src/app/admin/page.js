import Link from 'next/link';
import { sql, sqlOne } from '@/lib/db';
import { PageHeader, Card, Stat, Badge, Empty } from '@/components/ui';
import { ColumnChart, Heatmap } from '@/components/charts';
import { inr, num, date, time } from '@/lib/format';

export const metadata = { title: 'Dashboard' };

export default async function AdminDashboard() {
    const [kpi, revenue, heat, expiring, churn, todayClasses] = await Promise.all([
        sqlOne(`SELECT
            (SELECT COUNT(*) FROM v_current_memberships WHERE status = 'active') AS active_members,
            (SELECT COUNT(*) FROM v_current_memberships WHERE status = 'frozen') AS frozen_members,
            (SELECT COUNT(*) FROM attendance WHERE check_out IS NULL) AS in_gym,
            (SELECT COUNT(*) FROM attendance WHERE check_in >= CURRENT_DATE) AS visits_today,
            (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'completed'
               AND paid_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')) AS revenue_this_month,
            (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'completed'
               AND paid_at >= DATE_FORMAT(CURRENT_DATE - INTERVAL 1 MONTH, '%Y-%m-01')
               AND paid_at <  DATE_FORMAT(CURRENT_DATE - INTERVAL 1 MONTH, '%Y-%m-01') + INTERVAL DAY(CURRENT_DATE) DAY) AS revenue_last_month_to_date,
            (SELECT COUNT(*) FROM members WHERE joined_on >= CURRENT_DATE - INTERVAL 30 DAY) AS new_members_30d`),
        sql(`SELECT month, total_revenue FROM v_monthly_revenue
             WHERE month >= DATE_FORMAT(CURRENT_DATE - INTERVAL 11 MONTH, '%Y-%m') ORDER BY month`),
        // Peak hours: check-ins in the last 30 days grouped by weekday and hour
        sql(`SELECT WEEKDAY(check_in) AS weekday, HOUR(check_in) AS hour, COUNT(*) AS value
             FROM attendance WHERE check_in >= CURRENT_DATE - INTERVAL 30 DAY
             GROUP BY WEEKDAY(check_in), HOUR(check_in)`),
        sql('SELECT member_id, full_name, phone, plan_name, end_date, days_left FROM v_expiring_memberships ORDER BY days_left'),
        sql('SELECT member_id, full_name, visits_prev_30, visits_last_30, days_since_last_visit FROM v_churn_risk ORDER BY visits_last_30 / visits_prev_30 LIMIT 6'),
        sql(`SELECT class_session_id, starts_at, class_name, trainer_name, room_name, capacity, booked_count, waitlist_count, status
             FROM v_class_schedule WHERE DATE(starts_at) = CURRENT_DATE ORDER BY starts_at`),
    ]);

    const change = kpi.revenue_last_month_to_date
        ? Math.round(((kpi.revenue_this_month - kpi.revenue_last_month_to_date) / kpi.revenue_last_month_to_date) * 100)
        : null;
    const monthRows = revenue.map((r) => {
        const d = new Date(`${r.month}-01T00:00:00`);
        return { label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }), shortLabel: d.toLocaleDateString('en-IN', { month: 'short' }), value: r.total_revenue };
    });

    return (
        <>
            <PageHeader title="Dashboard" subtitle={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
                <Link href="/admin/check-in" className="btn btn-primary">Open front desk</Link>
            </PageHeader>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Active members" value={num(kpi.active_members)} hint={`${kpi.frozen_members} frozen · ${kpi.new_members_30d} joined in 30 days`} />
                <Stat label="In the gym now" value={num(kpi.in_gym)} hint={`${kpi.visits_today} check-ins today`} />
                <Stat label="Revenue this month" value={inr(kpi.revenue_this_month)}
                    hint={change === null ? 'No data for last month' : `${change >= 0 ? '+' : ''}${change}% vs same days last month`}
                    tone={change === null ? 'default' : change >= 0 ? 'good' : 'bad'} />
                <Stat label="Renewals due (7 days)" value={num(expiring.length)} hint={`${churn.length} members at churn risk`} tone={expiring.length ? 'warn' : 'default'} />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-5">
                <Card title="Revenue by month" subtitle="Memberships + personal training, last 12 months" className="xl:col-span-3">
                    <ColumnChart rows={monthRows} format={inr} />
                </Card>
                <Card title="Peak hours" subtitle="Check-ins over the last 30 days" className="xl:col-span-2">
                    <Heatmap cells={heat} hours={Array.from({ length: 17 }, (_, i) => i + 6)} valueLabel="check-ins" />
                </Card>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card title="Renewals due this week" subtitle="Plan ends within 7 days and no renewal bought yet">
                    {expiring.length ? (
                        <table className="data-table">
                            <thead><tr><th>Member</th><th>Plan</th><th>Ends</th></tr></thead>
                            <tbody>
                                {expiring.map((m) => (
                                    <tr key={m.member_id}>
                                        <td><Link href={`/admin/members/${m.member_id}`} className="font-medium text-teal-700 hover:underline">{m.full_name}</Link><div className="text-xs text-slate-500">{m.phone}</div></td>
                                        <td>{m.plan_name}</td>
                                        <td>{date(m.end_date)} <span className="text-xs text-slate-500">({m.days_left === 0 ? 'today' : `${m.days_left}d`})</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <Empty>No renewals due this week.</Empty>}
                </Card>
                <Card title="Churn risk" subtitle="Visits in the last 30 days dropped below half of the 30 days before"
                    action={<Link href="/admin/reports#churn" className="text-sm text-teal-700 hover:underline">All</Link>}>
                    {churn.length ? (
                        <table className="data-table">
                            <thead><tr><th>Member</th><th className="num">Before</th><th className="num">Last 30d</th><th className="num">Last visit</th></tr></thead>
                            <tbody>
                                {churn.map((m) => (
                                    <tr key={m.member_id}>
                                        <td><Link href={`/admin/members/${m.member_id}`} className="font-medium text-teal-700 hover:underline">{m.full_name}</Link></td>
                                        <td className="num">{m.visits_prev_30}</td>
                                        <td className="num">{m.visits_last_30}</td>
                                        <td className="num">{m.days_since_last_visit}d ago</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <Empty>Nobody looks at risk right now.</Empty>}
                </Card>
            </div>

            <Card title="Today's classes" className="mt-6">
                {todayClasses.length ? (
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead><tr><th>Time</th><th>Class</th><th>Trainer</th><th>Room</th><th className="num">Booked</th><th>Status</th></tr></thead>
                            <tbody>
                                {todayClasses.map((c) => (
                                    <tr key={c.class_session_id}>
                                        <td className="tabular-nums">{time(c.starts_at)}</td>
                                        <td className="font-medium">{c.class_name}</td>
                                        <td>{c.trainer_name}</td>
                                        <td>{c.room_name}</td>
                                        <td className="num">{c.booked_count}/{c.capacity}{c.waitlist_count > 0 && <span className="text-amber-700"> +{c.waitlist_count}</span>}</td>
                                        <td><Badge status={c.status} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <Empty>No classes today.</Empty>}
            </Card>
        </>
    );
}

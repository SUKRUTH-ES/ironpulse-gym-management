import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { sql, sqlOne } from '@/lib/db';
import { mongo } from '@/lib/mongo';
import { inbox } from '@/lib/notifications';
import { PageHeader, Card, Stat, Badge, Empty } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { cancelBooking, markNotificationsRead } from './actions';
import { date, dateTime } from '@/lib/format';

export const metadata = { title: 'Home' };

export default async function MemberHome() {
    const me = await requireRole('member');
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [overview, bookings, pt, visits, notes, workoutsThisMonth] = await Promise.all([
        sqlOne('SELECT * FROM v_member_overview WHERE member_id = ?', [me.member_id]),
        sql(`SELECT cb.booking_id, cb.status, s.class_name, s.starts_at, s.trainer_name, s.room_name,
                    (SELECT COUNT(*) + 1 FROM class_bookings w
                     WHERE w.class_session_id = cb.class_session_id AND w.status = 'waitlisted' AND w.booked_at < cb.booked_at) AS queue_position
             FROM class_bookings cb JOIN v_class_schedule s ON s.class_session_id = cb.class_session_id
             WHERE cb.member_id = ? AND cb.status IN ('booked','waitlisted') AND s.starts_at > NOW()
             ORDER BY s.starts_at LIMIT 6`, [me.member_id]),
        sql(`SELECT ps.starts_at, ps.status, u.full_name AS trainer_name FROM pt_sessions ps
             JOIN trainers t ON t.trainer_id = ps.trainer_id JOIN users u ON u.user_id = t.user_id
             WHERE ps.member_id = ? AND ps.status IN ('requested','confirmed') AND ps.starts_at > NOW()
             ORDER BY ps.starts_at LIMIT 3`, [me.member_id]),
        sqlOne(`SELECT SUM(check_in >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')) AS this_month,
                       SUM(check_in >= CURRENT_DATE - INTERVAL 7 DAY) AS this_week
                FROM attendance WHERE member_id = ?`, [me.member_id]),
        inbox(me.user_id),
        mongo().collection('workout_logs').countDocuments({ memberId: me.member_id, performedAt: { $gte: monthStart } }),
    ]);
    const unread = notes.filter((n) => !n.readAt).length;
    const status = overview.membership_status;

    return (
        <>
            <PageHeader title={`Hi, ${me.full_name.split(' ')[0]}`} subtitle={`Member code ${me.member_code} — show it at the front desk to check in.`} />

            {status !== 'active' && status !== 'frozen' && (
                <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    {status === 'none' ? 'You don’t have a membership yet.' : 'Your membership has expired.'}{' '}
                    <Link href="/member/membership" className="font-semibold underline">Choose a plan</Link> to start booking classes.
                </div>
            )}
            {status === 'active' && overview.days_left <= 7 && (
                <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    Your {overview.plan_name} plan ends on {date(overview.membership_end)}.{' '}
                    <Link href="/member/membership" className="font-semibold underline">Renew now</Link> so there’s no break.
                </div>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Membership" value={overview.plan_name ?? 'None'} hint={overview.membership_end ? `${status === 'frozen' ? 'Frozen · ' : ''}${overview.days_left} days left` : 'No active plan'} tone={status === 'active' ? 'good' : 'warn'} />
                <Stat label="Visits this month" value={visits.this_month ?? 0} hint={`${visits.this_week ?? 0} in the last 7 days`} />
                <Stat label="Workouts logged" value={workoutsThisMonth} hint="This month" />
                <Stat label="Upcoming bookings" value={bookings.length + pt.length} hint={`${pt.length} personal training`} />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <Card title="Your upcoming classes" className="lg:col-span-2" action={<Link href="/member/classes" className="text-sm text-teal-700 hover:underline">Book more</Link>}>
                    {bookings.length || pt.length ? (
                        <ul className="divide-y divide-slate-100">
                            {bookings.map((b) => (
                                <li key={b.booking_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                    <div>
                                        <p className="font-medium">{b.class_name} {b.status === 'waitlisted' && <Badge status="waitlisted">waitlist #{b.queue_position}</Badge>}</p>
                                        <p className="text-sm text-slate-500">{dateTime(b.starts_at)} · {b.trainer_name} · {b.room_name}</p>
                                    </div>
                                    <ActionForm action={cancelBooking} inlineMessage>
                                        <input type="hidden" name="booking_id" value={b.booking_id} />
                                        <SubmitButton className="btn btn-secondary btn-sm">Cancel</SubmitButton>
                                    </ActionForm>
                                </li>
                            ))}
                            {pt.map((p) => (
                                <li key={p.starts_at} className="flex items-center justify-between gap-3 py-3">
                                    <div>
                                        <p className="font-medium">Personal training with {p.trainer_name}</p>
                                        <p className="text-sm text-slate-500">{dateTime(p.starts_at)}</p>
                                    </div>
                                    <Badge status={p.status} />
                                </li>
                            ))}
                        </ul>
                    ) : <Empty>Nothing booked. <Link href="/member/classes" className="text-teal-700 underline">Find a class</Link></Empty>}
                </Card>

                <Card title={`Notifications${unread ? ` (${unread} new)` : ''}`}
                    action={unread > 0 && <form action={markNotificationsRead}><button className="text-sm text-teal-700 hover:underline">Mark read</button></form>}>
                    {notes.length ? (
                        <ul className="space-y-3">
                            {notes.map((n) => (
                                <li key={String(n._id)} className={`rounded-lg p-3 text-sm ${n.readAt ? 'bg-slate-50' : 'bg-teal-50'}`}>
                                    <p className="font-medium text-slate-900">{n.title}</p>
                                    {n.message && <p className="mt-0.5 text-slate-600">{n.message}</p>}
                                    <p className="mt-1 text-xs text-slate-400">{n.createdAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
                                </li>
                            ))}
                        </ul>
                    ) : <Empty>No notifications.</Empty>}
                </Card>
            </div>
        </>
    );
}

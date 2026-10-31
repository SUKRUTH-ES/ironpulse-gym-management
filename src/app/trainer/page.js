import { requireRole } from '@/lib/auth';
import { sql, sqlOne } from '@/lib/db';
import { PageHeader, Card, Stat, Badge, Empty } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { updatePtStatus, markAttendance } from './actions';
import { inr, dateShort, dateTime, time } from '@/lib/format';

export const metadata = { title: 'My schedule' };

function PtButton({ id, status, children, danger }) {
    return (
        <ActionForm action={updatePtStatus} inlineMessage>
            <input type="hidden" name="pt_session_id" value={id} />
            <input type="hidden" name="status" value={status} />
            <SubmitButton className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}>{children}</SubmitButton>
        </ActionForm>
    );
}

export default async function TrainerHome() {
    const me = await requireRole('trainer');

    const [classes, roster, pt, stats] = await Promise.all([
        sql(`SELECT class_session_id, starts_at, ends_at, class_name, room_name, capacity, booked_count, waitlist_count, status
             FROM v_class_schedule
             WHERE trainer_id = ? AND starts_at >= CURRENT_DATE AND starts_at < CURRENT_DATE + INTERVAL 7 DAY
             ORDER BY starts_at`, [me.trainer_id]),
        // Roster for my classes that started today (to take attendance)
        sql(`SELECT cb.booking_id, cb.class_session_id, cb.status, u.full_name, m.member_code
             FROM class_bookings cb
             JOIN class_sessions cs ON cs.class_session_id = cb.class_session_id
             JOIN members m ON m.member_id = cb.member_id JOIN users u ON u.user_id = m.user_id
             WHERE cs.trainer_id = ? AND DATE(cs.starts_at) = CURRENT_DATE AND cs.starts_at <= NOW()
               AND cb.status IN ('booked','attended','no_show')
             ORDER BY u.full_name`, [me.trainer_id]),
        sql(`SELECT ps.pt_session_id, ps.starts_at, ps.ends_at, ps.status, ps.price, ps.member_note, u.full_name, m.member_code
             FROM pt_sessions ps JOIN members m ON m.member_id = ps.member_id JOIN users u ON u.user_id = m.user_id
             WHERE ps.trainer_id = ?
               AND (ps.status = 'requested' OR (ps.status = 'confirmed' AND ps.starts_at > NOW() - INTERVAL 3 DAY))
             ORDER BY ps.starts_at`, [me.trainer_id]),
        sqlOne(`SELECT
                   (SELECT COUNT(*) FROM pt_sessions WHERE trainer_id = ? AND status = 'completed'
                       AND starts_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')) AS pt_this_month,
                   (SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay JOIN pt_sessions ps ON ps.pt_session_id = pay.pt_session_id
                     WHERE ps.trainer_id = ? AND pay.status = 'completed' AND pay.paid_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')) AS pt_revenue,
                   (SELECT avg_occupancy_pct FROM v_trainer_performance WHERE trainer_id = ?) AS occupancy`,
            [me.trainer_id, me.trainer_id, me.trainer_id]),
    ]);
    const rosterByClass = Map.groupBy(roster, (r) => r.class_session_id);
    const requests = pt.filter((p) => p.status === 'requested');
    const confirmed = pt.filter((p) => p.status === 'confirmed');
    const now = new Date();

    return (
        <>
            <PageHeader title="My schedule" subtitle={`Hello ${me.full_name.split(' ')[0]} — here is your week.`} />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Classes this week" value={classes.filter((c) => c.status !== 'cancelled').length} />
                <Stat label="PT requests waiting" value={requests.length} tone={requests.length ? 'warn' : 'default'} hint={requests.length ? 'Confirm or decline below' : 'All caught up'} />
                <Stat label="PT sessions this month" value={stats.pt_this_month} hint={`${inr(stats.pt_revenue)} earned for the gym`} />
                <Stat label="Average class fill" value={`${stats.occupancy ?? 0}%`} hint="Completed classes" />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card title="Personal training requests">
                    {requests.length ? (
                        <ul className="divide-y divide-slate-100">
                            {requests.map((p) => (
                                <li key={p.pt_session_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                                    <div>
                                        <p className="font-medium">{p.full_name} <span className="font-mono text-xs text-slate-500">{p.member_code}</span></p>
                                        <p className="text-slate-500">{dateTime(p.starts_at)}–{time(p.ends_at)} · {p.price > 0 ? inr(p.price) : 'included in plan'}</p>
                                        {p.member_note && <p className="mt-1 text-slate-600 italic">“{p.member_note}”</p>}
                                    </div>
                                    <div className="flex gap-2">
                                        <PtButton id={p.pt_session_id} status="confirmed">Confirm</PtButton>
                                        <PtButton id={p.pt_session_id} status="cancelled" danger>Decline</PtButton>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : <Empty>No new requests.</Empty>}
                </Card>
                <Card title="Confirmed sessions">
                    {confirmed.length ? (
                        <ul className="divide-y divide-slate-100">
                            {confirmed.map((p) => (
                                <li key={p.pt_session_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                                    <div>
                                        <p className="font-medium">{p.full_name}</p>
                                        <p className="text-slate-500">{dateTime(p.starts_at)}–{time(p.ends_at)}</p>
                                    </div>
                                    {new Date(p.starts_at.replace(' ', 'T')) <= now
                                        ? <PtButton id={p.pt_session_id} status="completed">Mark done</PtButton>
                                        : <PtButton id={p.pt_session_id} status="cancelled" danger>Cancel</PtButton>}
                                </li>
                            ))}
                        </ul>
                    ) : <Empty>No confirmed sessions.</Empty>}
                </Card>
            </div>

            <Card title="My classes (next 7 days)" className="mt-6">
                {classes.length ? (
                    <ul className="divide-y divide-slate-100">
                        {classes.map((c) => {
                            const list = rosterByClass.get(c.class_session_id) ?? [];
                            return (
                                <li key={c.class_session_id} className="py-3">
                                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                                        <div>
                                            <p className="font-medium">{c.class_name} <span className="text-slate-500">· {c.room_name}</span></p>
                                            <p className="text-slate-500">{dateShort(c.starts_at)}, {time(c.starts_at)}–{time(c.ends_at)}</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="tabular-nums text-slate-600">{c.booked_count}/{c.capacity}{c.waitlist_count > 0 && ` +${c.waitlist_count} waiting`}</span>
                                            <Badge status={c.status} />
                                        </div>
                                    </div>
                                    {list.length > 0 && (
                                        <details className="mt-2 rounded-lg bg-slate-50 p-3" open>
                                            <summary className="cursor-pointer text-sm font-medium">Take attendance ({list.filter((r) => r.status === 'attended').length}/{list.length} present)</summary>
                                            <ul className="mt-2 space-y-1">
                                                {list.map((r) => (
                                                    <li key={r.booking_id} className="flex items-center justify-between gap-2 text-sm">
                                                        <span>{r.full_name} <Badge status={r.status} /></span>
                                                        <span className="flex gap-1">
                                                            {['attended', 'no_show'].map((s) => (
                                                                <ActionForm key={s} action={markAttendance}>
                                                                    <input type="hidden" name="booking_id" value={r.booking_id} />
                                                                    <input type="hidden" name="status" value={s} />
                                                                    <SubmitButton className="btn btn-secondary btn-sm" disabled={r.status === s}>{s === 'attended' ? 'Present' : 'Absent'}</SubmitButton>
                                                                </ActionForm>
                                                            ))}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </details>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                ) : <Empty>No classes this week.</Empty>}
            </Card>
        </>
    );
}

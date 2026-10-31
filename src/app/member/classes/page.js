import { requireRole } from '@/lib/auth';
import { sql, sqlOne } from '@/lib/db';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { bookClass, cancelBooking } from '../actions';
import { dateShort, time } from '@/lib/format';

export const metadata = { title: 'Book classes' };

export default async function MemberClasses({ searchParams }) {
    const me = await requireRole('member');
    const { intensity = '' } = await searchParams;
    const filter = ['low', 'medium', 'high'].includes(intensity) ? intensity : '';

    const [classes, plan] = await Promise.all([
        sql(`SELECT s.class_session_id, s.starts_at, s.ends_at, s.class_name, s.intensity, s.trainer_name, s.room_name,
                    s.capacity, s.seats_left, s.waitlist_count, cb.booking_id, cb.status AS my_status
             FROM v_class_schedule s
             LEFT JOIN class_bookings cb ON cb.class_session_id = s.class_session_id AND cb.member_id = ?
             WHERE s.status = 'scheduled' AND s.starts_at > NOW() AND s.starts_at < CURRENT_DATE + INTERVAL 8 DAY
               ${filter ? 'AND s.intensity = ?' : ''}
             ORDER BY s.starts_at`, filter ? [me.member_id, filter] : [me.member_id]),
        sqlOne(`SELECT plan_name, classes_per_week, fn_classes_booked_in_week(?, CURRENT_DATE) AS used_this_week
                FROM v_current_memberships WHERE member_id = ? AND status = 'active'`, [me.member_id, me.member_id]),
    ]);
    const byDay = Map.groupBy(classes, (c) => c.starts_at.slice(0, 10));

    return (
        <>
            <PageHeader title="Book classes"
                subtitle={plan
                    ? `${plan.plan_name}: ${plan.classes_per_week ? `${plan.used_this_week} of ${plan.classes_per_week} classes used this week` : 'unlimited classes'}`
                    : 'You need an active membership to book.'}>
                {['', 'low', 'medium', 'high'].map((i) => (
                    <a key={i || 'all'} href={i ? `?intensity=${i}` : '?'}
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === i ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                        {i ? `${i[0].toUpperCase()}${i.slice(1)} intensity` : 'All'}
                    </a>
                ))}
            </PageHeader>

            <div className="space-y-6">
                {byDay.size ? [...byDay].map(([day, list]) => (
                    <Card key={day} title={dateShort(day)}>
                        <ul className="divide-y divide-slate-100">
                            {list.map((c) => {
                                const mine = c.my_status === 'booked' || c.my_status === 'waitlisted';
                                const full = c.seats_left <= 0;
                                return (
                                    <li key={c.class_session_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                        <div className="min-w-0">
                                            <p className="font-medium">
                                                <span className="tabular-nums text-slate-500">{time(c.starts_at)}</span> · {c.class_name} <Badge status={c.intensity} />
                                            </p>
                                            <p className="text-sm text-slate-500">{c.trainer_name} · {c.room_name} · {time(c.starts_at)}–{time(c.ends_at)}</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className={`text-sm tabular-nums ${full ? 'text-amber-700' : 'text-slate-600'}`}>
                                                {full ? `Full${c.waitlist_count ? ` · ${c.waitlist_count} waiting` : ''}` : `${c.seats_left} of ${c.capacity} left`}
                                            </span>
                                            {mine ? (
                                                <ActionForm action={cancelBooking} inlineMessage className="flex items-center gap-2">
                                                    <Badge status={c.my_status} />
                                                    <input type="hidden" name="booking_id" value={c.booking_id} />
                                                    <SubmitButton className="btn btn-secondary btn-sm">Cancel</SubmitButton>
                                                </ActionForm>
                                            ) : (
                                                <ActionForm action={bookClass} inlineMessage className="flex max-w-xs flex-col items-end gap-1">
                                                    <input type="hidden" name="class_session_id" value={c.class_session_id} />
                                                    <SubmitButton className={full ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}>
                                                        {full ? 'Join waitlist' : 'Book'}
                                                    </SubmitButton>
                                                </ActionForm>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </Card>
                )) : <Empty>No classes match.</Empty>}
            </div>
        </>
    );
}

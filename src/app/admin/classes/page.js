import { sql } from '@/lib/db';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { createClassSession, cancelClassSession } from '../actions';
import { dateShort, time, isoDay, daysAgo, plural } from '@/lib/format';
import { requireRole } from '@/lib/auth';

export const metadata = { title: 'Classes' };

export default async function ClassesPage() {
    await requireRole('admin');
    const [schedule, types, trainers, rooms] = await Promise.all([
        sql(`SELECT class_session_id, starts_at, ends_at, class_name, intensity, trainer_name, room_name,
                    capacity, booked_count, waitlist_count, seats_left, status
             FROM v_class_schedule
             WHERE starts_at >= CURRENT_DATE AND starts_at < CURRENT_DATE + INTERVAL 8 DAY
             ORDER BY starts_at`),
        sql('SELECT class_type_id, name, duration_min FROM class_types ORDER BY name'),
        sql('SELECT t.trainer_id, u.full_name FROM trainers t JOIN users u ON u.user_id = t.user_id WHERE u.is_active ORDER BY u.full_name'),
        sql('SELECT room_id, name, capacity FROM rooms ORDER BY name'),
    ]);

    const byDay = Map.groupBy(schedule, (c) => c.starts_at.slice(0, 10));

    return (
        <>
            <PageHeader title="Classes" subtitle="Timetable for the next 7 days" />
            <div className="grid gap-6 lg:grid-cols-3">
                <Card title="Add a class" subtitle="The database rejects clashes: same room, or a trainer who is already busy." className="h-fit">
                    <ActionForm action={createClassSession} className="space-y-3">
                        <div>
                            <label className="label" htmlFor="class_type_id">Class</label>
                            <select id="class_type_id" name="class_type_id" className="input" required>
                                {types.map((t) => <option key={t.class_type_id} value={t.class_type_id}>{t.name} ({t.duration_min} min)</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="label" htmlFor="trainer_id">Trainer</label>
                            <select id="trainer_id" name="trainer_id" className="input" required>
                                {trainers.map((t) => <option key={t.trainer_id} value={t.trainer_id}>{t.full_name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="label" htmlFor="room_id">Room</label>
                            <select id="room_id" name="room_id" className="input" required>
                                {rooms.map((r) => <option key={r.room_id} value={r.room_id}>{r.name} (max {r.capacity})</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="label" htmlFor="date">Date</label>
                                <input id="date" name="date" type="date" className="input" min={isoDay()} max={isoDay(daysAgo(-7))} required />
                            </div>
                            <div>
                                <label className="label" htmlFor="time">Start</label>
                                <input id="time" name="time" type="time" className="input" min="06:00" max="21:30" step="900" required />
                            </div>
                        </div>
                        <div>
                            <label className="label" htmlFor="capacity">Capacity</label>
                            <input id="capacity" name="capacity" type="number" min="1" max="200" defaultValue="15" className="input" required />
                        </div>
                        <SubmitButton className="btn btn-primary w-full">Add class</SubmitButton>
                    </ActionForm>
                </Card>

                <div className="space-y-6 lg:col-span-2">
                    {byDay.size ? [...byDay].map(([day, classes]) => (
                        <Card key={day} title={dateShort(day)}>
                            <div className="overflow-x-auto">
                                <table className="data-table">
                                    <thead><tr><th>Time</th><th>Class</th><th>Trainer · Room</th><th className="num">Booked</th><th>Status</th><th /></tr></thead>
                                    <tbody>
                                        {classes.map((c) => (
                                            <tr key={c.class_session_id}>
                                                <td className="tabular-nums whitespace-nowrap">{time(c.starts_at)}–{time(c.ends_at)}</td>
                                                <td><span className="font-medium">{c.class_name}</span> <Badge status={c.intensity} /></td>
                                                <td className="text-slate-600">{c.trainer_name} · {c.room_name}</td>
                                                <td className="num">
                                                    {c.booked_count}/{c.capacity}
                                                    {c.waitlist_count > 0 && <div className="text-xs text-amber-700">{c.waitlist_count} waiting</div>}
                                                </td>
                                                <td><Badge status={c.status} /></td>
                                                <td className="text-right">
                                                    {/* the form stays mounted after cancelling so its message is still shown */}
                                                    <ActionForm action={cancelClassSession} inlineMessage
                                                        confirm={`Cancel ${c.class_name} at ${time(c.starts_at)}? ${plural(c.booked_count + c.waitlist_count, 'booked member')} will be notified.`}>
                                                        <input type="hidden" name="class_session_id" value={c.class_session_id} />
                                                        {c.status === 'scheduled' && <SubmitButton className="btn btn-danger btn-sm">Cancel</SubmitButton>}
                                                    </ActionForm>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    )) : <Empty>No classes scheduled.</Empty>}
                </div>
            </div>
        </>
    );
}

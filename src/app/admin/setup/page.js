import { sql } from '@/lib/db';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { addRoom, addClassType, addTrainer, toggleTrainerPt } from '../actions';
import { inr, label, plural } from '@/lib/format';
import { requireRole } from '@/lib/auth';

export const metadata = { title: 'Gym setup' };

export default async function SetupPage() {
    await requireRole('admin');
    const [rooms, types, trainers] = await Promise.all([
        sql(`SELECT r.room_id, r.name, r.capacity,
                    (SELECT COUNT(*) FROM class_sessions cs WHERE cs.room_id = r.room_id AND cs.status = 'scheduled') AS upcoming
             FROM rooms r ORDER BY r.name`),
        sql(`SELECT ct.class_type_id, ct.name, ct.intensity, ct.duration_min,
                    (SELECT COUNT(*) FROM class_sessions cs WHERE cs.class_type_id = ct.class_type_id) AS sessions
             FROM class_types ct ORDER BY ct.name`),
        sql(`SELECT t.trainer_id, u.full_name, u.email, u.is_active, t.specialization, t.experience_years, t.session_rate, t.accepts_pt
             FROM trainers t JOIN users u ON u.user_id = t.user_id ORDER BY u.full_name`),
    ]);

    return (
        <>
            <PageHeader title="Gym setup" subtitle="Rooms, class types and trainers used by the timetable and bookings." />

            <div className="grid gap-6 lg:grid-cols-3">
                <Card title="Trainers" className="lg:col-span-2">
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead><tr><th>Trainer</th><th>Specialization</th><th className="num">Experience</th><th className="num">PT rate</th><th>Personal training</th></tr></thead>
                            <tbody>
                                {trainers.map((t) => (
                                    <tr key={t.trainer_id} className={t.is_active ? '' : 'text-slate-400'}>
                                        <td><div className="font-medium">{t.full_name}</div><div className="text-xs text-slate-500">{t.email}</div></td>
                                        <td>{t.specialization}</td>
                                        <td className="num">{plural(t.experience_years, 'year')}</td>
                                        <td className="num">{inr(t.session_rate)}</td>
                                        <td>
                                            <ActionForm action={toggleTrainerPt} inlineMessage className="flex items-center gap-2">
                                                <input type="hidden" name="trainer_id" value={t.trainer_id} />
                                                <Badge status={t.accepts_pt ? 'active' : 'expired'}>{t.accepts_pt ? 'taking clients' : 'not taking'}</Badge>
                                                <SubmitButton className="btn btn-secondary btn-sm">{t.accepts_pt ? 'Pause' : 'Resume'}</SubmitButton>
                                            </ActionForm>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>

                <Card title="Add a trainer" subtitle="Creates their login and profile together (stored procedure).">
                    <ActionForm action={addTrainer} resetOnSuccess className="space-y-3">
                        <div><label className="label" htmlFor="t_name">Full name</label><input id="t_name" name="full_name" className="input" required minLength={2} maxLength={100} /></div>
                        <div><label className="label" htmlFor="t_email">E-mail</label><input id="t_email" name="email" type="email" className="input" required /></div>
                        <div><label className="label" htmlFor="t_phone">Mobile (optional)</label><input id="t_phone" name="phone" className="input" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} placeholder="98XXXXXXXX" /></div>
                        <div><label className="label" htmlFor="t_spec">Specialization</label><input id="t_spec" name="specialization" className="input" required maxLength={100} placeholder="e.g. Strength & conditioning" /></div>
                        <div><label className="label" htmlFor="t_bio">Short bio</label><textarea id="t_bio" name="bio" className="input" rows={2} /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div><label className="label" htmlFor="t_exp">Experience (years)</label><input id="t_exp" name="experience_years" type="number" min="0" max="50" defaultValue="0" className="input" /></div>
                            <div><label className="label" htmlFor="t_rate">PT rate (₹/session)</label><input id="t_rate" name="session_rate" type="number" min="1" className="input" required /></div>
                        </div>
                        <div><label className="label" htmlFor="t_pw">First password</label><input id="t_pw" name="password" type="password" className="input" required minLength={8} autoComplete="new-password" /></div>
                        <SubmitButton className="btn btn-primary w-full">Add trainer</SubmitButton>
                    </ActionForm>
                </Card>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card title="Rooms">
                    {rooms.length ? (
                        <table className="data-table">
                            <thead><tr><th>Room</th><th className="num">Capacity</th><th className="num">Upcoming classes</th></tr></thead>
                            <tbody>{rooms.map((r) => <tr key={r.room_id}><td className="font-medium">{r.name}</td><td className="num">{r.capacity}</td><td className="num">{r.upcoming}</td></tr>)}</tbody>
                        </table>
                    ) : <Empty>No rooms yet.</Empty>}
                    <ActionForm action={addRoom} resetOnSuccess className="mt-4 flex flex-wrap items-end gap-2">
                        <div className="flex-1"><label className="label" htmlFor="r_name">New room</label><input id="r_name" name="name" className="input" required minLength={2} maxLength={50} /></div>
                        <div><label className="label" htmlFor="r_cap">Capacity</label><input id="r_cap" name="capacity" type="number" min="1" max="200" className="input w-24" required /></div>
                        <SubmitButton className="btn btn-primary">Add room</SubmitButton>
                    </ActionForm>
                </Card>

                <Card title="Class types">
                    {types.length ? (
                        <table className="data-table">
                            <thead><tr><th>Class</th><th>Intensity</th><th className="num">Length</th><th className="num">Sessions</th></tr></thead>
                            <tbody>{types.map((c) => <tr key={c.class_type_id}><td className="font-medium">{c.name}</td><td><Badge status={c.intensity} /></td><td className="num">{c.duration_min} min</td><td className="num">{c.sessions}</td></tr>)}</tbody>
                        </table>
                    ) : <Empty>No class types yet.</Empty>}
                    <ActionForm action={addClassType} resetOnSuccess className="mt-4 grid gap-2 sm:grid-cols-2">
                        <div className="sm:col-span-2"><label className="label" htmlFor="c_name">New class type</label><input id="c_name" name="name" className="input" required minLength={2} maxLength={50} /></div>
                        <div className="sm:col-span-2"><label className="label" htmlFor="c_desc">Description</label><input id="c_desc" name="description" className="input" /></div>
                        <div>
                            <label className="label" htmlFor="c_int">Intensity</label>
                            <select id="c_int" name="intensity" className="input">{['low', 'medium', 'high'].map((i) => <option key={i} value={i}>{label(i)}</option>)}</select>
                        </div>
                        <div><label className="label" htmlFor="c_dur">Length (min)</label><input id="c_dur" name="duration_min" type="number" min="15" max="180" step="5" defaultValue="45" className="input" required /></div>
                        <SubmitButton className="btn btn-primary sm:col-span-2">Add class type</SubmitButton>
                    </ActionForm>
                </Card>
            </div>
        </>
    );
}

import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { bookPt, cancelPt } from '../actions';
import { inr, dateTime, isoDay, daysAgo } from '@/lib/format';

export const metadata = { title: 'Personal training' };

export default async function TrainingPage({ searchParams }) {
    const me = await requireRole('member');
    const { q = '' } = await searchParams;
    const search = q.trim();

    // Full-text search over trainer specialisation and bio (MATCH ... AGAINST)
    const trainers = await sql(
        `SELECT t.trainer_id, u.full_name, t.specialization, t.bio, t.experience_years, t.session_rate, t.accepts_pt
                ${search ? ', MATCH(t.specialization, t.bio) AGAINST (? IN NATURAL LANGUAGE MODE) AS score' : ''}
         FROM trainers t JOIN users u ON u.user_id = t.user_id
         WHERE u.is_active ${search ? 'AND MATCH(t.specialization, t.bio) AGAINST (? IN NATURAL LANGUAGE MODE)' : ''}
         ORDER BY ${search ? 'score DESC' : 'u.full_name'}`,
        search ? [search, search] : []);

    const sessions = await sql(
        `SELECT ps.pt_session_id, ps.starts_at, ps.ends_at, ps.status, ps.price, ps.member_note, u.full_name AS trainer_name
         FROM pt_sessions ps JOIN trainers t ON t.trainer_id = ps.trainer_id JOIN users u ON u.user_id = t.user_id
         WHERE ps.member_id = ? ORDER BY ps.starts_at DESC LIMIT 15`, [me.member_id]);

    const tomorrow = daysAgo(-1);

    return (
        <>
            <PageHeader title="Personal training" subtitle="One-to-one sessions. Included sessions in your plan are used first." />

            <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                    <form className="flex gap-2">
                        <input name="q" defaultValue={q} className="input" placeholder="What do you need help with? e.g. back pain, weight loss, powerlifting" />
                        <button className="btn btn-secondary">Search</button>
                    </form>
                    {search && <p className="text-sm text-slate-500">Best matches for “{search}”</p>}
                    {trainers.length ? trainers.map((t) => (
                        <Card key={t.trainer_id}>
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold">{t.full_name}</p>
                                    <p className="text-sm text-teal-800">{t.specialization}</p>
                                    <p className="mt-2 text-sm text-slate-600">{t.bio}</p>
                                    <p className="mt-2 text-xs text-slate-500">{t.experience_years} years experience · {inr(t.session_rate)} per hour</p>
                                </div>
                                {t.accepts_pt ? (
                                    <ActionForm action={bookPt} className="grid w-full gap-2 sm:w-64">
                                        <input type="hidden" name="trainer_id" value={t.trainer_id} />
                                        <div className="grid grid-cols-2 gap-2">
                                            <input name="date" type="date" min={isoDay(tomorrow)} defaultValue={isoDay(tomorrow)} className="input" required aria-label="Date" />
                                            <input name="time" type="time" min="06:00" max="21:00" step="1800" defaultValue="11:00" className="input" required aria-label="Start time" />
                                        </div>
                                        <select name="duration" className="input" defaultValue="60" aria-label="Length">
                                            <option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option>
                                        </select>
                                        <input name="note" className="input" maxLength={255} placeholder="Goal or note for the trainer (optional)" />
                                        <SubmitButton className="btn btn-primary btn-sm">Request session</SubmitButton>
                                    </ActionForm>
                                ) : <Badge status="expired">Not taking bookings</Badge>}
                            </div>
                        </Card>
                    )) : <Empty>No trainer matches that search.</Empty>}
                </div>

                <Card title="My sessions" className="h-fit">
                    {sessions.length ? (
                        <ul className="divide-y divide-slate-100">
                            {sessions.map((s) => (
                                <li key={s.pt_session_id} className="py-3 text-sm">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">{s.trainer_name}</span>
                                        <Badge status={s.status} />
                                    </div>
                                    <p className="text-slate-500">{dateTime(s.starts_at)} · {s.price > 0 ? inr(s.price) : 'included'}</p>
                                    {['requested', 'confirmed'].includes(s.status) && new Date(s.starts_at.replace(' ', 'T')) > new Date() && (
                                        <ActionForm action={cancelPt} inlineMessage className="mt-1">
                                            <input type="hidden" name="pt_session_id" value={s.pt_session_id} />
                                            <SubmitButton className="btn btn-secondary btn-sm">Cancel</SubmitButton>
                                        </ActionForm>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : <Empty>No sessions yet.</Empty>}
                </Card>
            </div>
        </>
    );
}

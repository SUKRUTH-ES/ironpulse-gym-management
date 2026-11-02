import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { mongo } from '@/lib/mongo';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { createWorkoutPlan } from '../actions';
import { date, label, daysAgo } from '@/lib/format';

export const metadata = { title: 'Members & plans' };

export default async function TrainerMembers() {
    const me = await requireRole('trainer');
    const db = mongo();

    const [myPlans, exercises] = await Promise.all([
        db.collection('workout_plans').find({ trainerId: me.trainer_id, status: 'active' }).sort({ createdAt: -1 }).toArray(),
        db.collection('exercises').find({ createdBy: null }, { projection: { name: 1, slug: 1, category: 1, primaryMuscle: 1 } }).sort({ category: 1, name: 1 }).toArray(),
    ]);

    // Members linked to me through PT sessions or plans (ids from both databases)
    const planMemberIds = myPlans.map((p) => p.memberId);
    const members = await sql(
        `SELECT mo.member_id, mo.full_name, mo.member_code, mo.fitness_goal, mo.plan_name, mo.membership_status
         FROM v_member_overview mo
         WHERE mo.member_id IN (SELECT member_id FROM pt_sessions WHERE trainer_id = ?)
            ${planMemberIds.length ? `OR mo.member_id IN (${planMemberIds.map(() => '?').join(',')})` : ''}
         ORDER BY mo.full_name`, [me.trainer_id, ...planMemberIds]);
    const allMembers = await sql(
        "SELECT member_id, full_name, member_code FROM v_member_overview WHERE membership_status IN ('active','frozen') ORDER BY full_name");

    // Progress of each member on my plans: workouts logged in the last 14 days (one aggregation)
    const activity = planMemberIds.length ? await db.collection('workout_logs').aggregate([
        { $match: { memberId: { $in: planMemberIds }, performedAt: { $gte: daysAgo(14) } } },
        { $group: { _id: '$memberId', workouts: { $sum: 1 }, last: { $max: '$performedAt' } } },
    ]).toArray() : [];
    const activityOf = new Map(activity.map((a) => [a._id, a]));
    const planOf = new Map(myPlans.map((p) => [p.memberId, p]));
    // Plan builder lists my own members first; any active member can still be picked
    const mine = new Set(members.map((m) => m.member_id));
    const option = (m) => <option key={m.member_id} value={m.member_id}>{m.full_name} ({m.member_code})</option>;

    return (
        <>
            <PageHeader title="Members & plans" subtitle="Workout plans are stored in MongoDB; member details come from MySQL." />
            <div className="grid gap-6 lg:grid-cols-5">
                <Card title="My members" className="lg:col-span-3">
                    {members.length ? (
                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead><tr><th>Member</th><th>Goal</th><th>Plan from me</th><th className="num">Workouts (14d)</th><th>Last workout</th></tr></thead>
                                <tbody>
                                    {members.map((m) => {
                                        const a = activityOf.get(m.member_id);
                                        return (
                                            <tr key={m.member_id}>
                                                <td><div className="font-medium">{m.full_name}</div><div className="font-mono text-xs text-slate-500">{m.member_code}</div></td>
                                                <td>{label(m.fitness_goal)}</td>
                                                <td>{planOf.get(m.member_id)?.title ?? <span className="text-slate-400">—</span>}</td>
                                                <td className="num">{a?.workouts ?? 0}</td>
                                                <td>{a ? date(a.last) : '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : <Empty>No members yet.</Empty>}
                </Card>

                <Card title="Create a workout plan" subtitle="Replaces the member's current plan" className="lg:col-span-2">
                    <ActionForm action={createWorkoutPlan} resetOnSuccess className="space-y-3">
                        <div>
                            <label className="label" htmlFor="member_id">Member</label>
                            <select id="member_id" name="member_id" className="input" required>
                                {mine.size > 0 && <optgroup label="My members">{allMembers.filter((m) => mine.has(m.member_id)).map(option)}</optgroup>}
                                <optgroup label={mine.size > 0 ? 'Other members' : 'Members'}>{allMembers.filter((m) => !mine.has(m.member_id)).map(option)}</optgroup>
                            </select>
                        </div>
                        <div><label className="label" htmlFor="title">Plan title</label><input id="title" name="title" className="input" required minLength={3} maxLength={100} /></div>
                        <div>
                            <label className="label" htmlFor="goal">Goal</label>
                            <select id="goal" name="goal" className="input">
                                {['general_fitness', 'weight_loss', 'muscle_gain', 'endurance', 'flexibility'].map((g) => <option key={g} value={g}>{label(g)}</option>)}
                            </select>
                        </div>
                        {[1, 2, 3].map((d) => (
                            <details key={d} className="rounded-lg border border-slate-200 p-3" open={d === 1}>
                                <summary className="cursor-pointer text-sm font-medium">Day {d}</summary>
                                <input name={`day${d}_title`} className="input mt-2" placeholder={`Day ${d} title, e.g. Upper body`} />
                                <div className="mt-2 grid max-h-48 grid-cols-1 gap-1 overflow-y-auto text-sm">
                                    {exercises.map((e) => (
                                        <label key={e.slug} className="flex items-center gap-2">
                                            <input type="checkbox" name="exercise" value={`${d}:${e.slug}`} className="accent-teal-700" />
                                            {e.name} <span className="text-xs text-slate-400">{e.category}</span>
                                        </label>
                                    ))}
                                </div>
                            </details>
                        ))}
                        <SubmitButton className="btn btn-primary w-full">Save plan</SubmitButton>
                    </ActionForm>
                </Card>
            </div>
        </>
    );
}

import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { sqlOne } from '@/lib/db';
import { mongo } from '@/lib/mongo';
import { PageHeader, Card, Stat, Empty, BarList, Badge } from '@/components/ui';
import { ColumnChart, LineChart } from '@/components/charts';
import { ActionForm, SubmitButton } from '@/components/forms';
import { WorkoutLogger } from './workout-logger';
import { logWorkout, logBodyWeight, activatePlan, deleteOwnPlan } from '../actions';
import { num, date, label, daysAgo } from '@/lib/format';

export const metadata = { title: 'Workouts & progress' };

export default async function WorkoutsPage() {
    const me = await requireRole('member');
    const db = mongo();
    const eightWeeksAgo = daysAgo(56);

    const [allPlans, weekly, records, weights, recent] = await Promise.all([
        db.collection('workout_plans').find({ memberId: me.member_id }, { projection: { 'days.exercises': 0 } }).sort({ status: 1, createdAt: -1 }).toArray(),

        // Aggregation: training volume (reps x kg) and workouts per week
        db.collection('workout_logs').aggregate([
            { $match: { memberId: me.member_id, performedAt: { $gte: eightWeeksAgo } } },
            { $unwind: { path: '$exercises', preserveNullAndEmptyArrays: true } },
            { $unwind: { path: '$exercises.sets', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: { $dateTrunc: { date: '$performedAt', unit: 'week', startOfWeek: 'monday', timezone: 'Asia/Kolkata' } },
                    volume: { $sum: { $multiply: [{ $ifNull: ['$exercises.sets.reps', 0] }, { $ifNull: ['$exercises.sets.weightKg', 0] }] } },
                    workouts: { $addToSet: '$_id' },
                    avgRpe: { $avg: '$rpe' },
                },
            },
            { $project: { volume: 1, workouts: { $size: '$workouts' }, avgRpe: { $round: ['$avgRpe', 1] } } },
            { $sort: { _id: 1 } },
        ]).toArray(),

        // Aggregation: personal record (heaviest set) per exercise
        db.collection('workout_logs').aggregate([
            { $match: { memberId: me.member_id } },
            { $unwind: '$exercises' },
            { $unwind: '$exercises.sets' },
            { $match: { 'exercises.sets.weightKg': { $gt: 0 } } },
            { $sort: { 'exercises.sets.weightKg': -1, performedAt: 1 } },
            { $group: { _id: '$exercises.name', bestKg: { $first: '$exercises.sets.weightKg' }, reps: { $first: '$exercises.sets.reps' }, on: { $first: '$performedAt' } } },
            { $sort: { bestKg: -1 } },
            { $limit: 8 },
        ]).toArray(),

        db.collection('body_metrics').find({ memberId: me.member_id }).sort({ recordedAt: -1 }).limit(16).toArray(),
        db.collection('workout_logs').find({ memberId: me.member_id }).sort({ performedAt: -1 }).limit(5).toArray(),
    ]);
    const activeId = allPlans.find((p) => p.status === 'active')?._id;
    const plan = activeId ? await db.collection('workout_plans').findOne({ _id: activeId }) : null;
    // the trainer's name lives in MySQL; the plan only stores their id
    const coach = plan?.trainerId
        ? await sqlOne('SELECT u.full_name FROM trainers t JOIN users u ON u.user_id = t.user_id WHERE t.trainer_id = ?', [plan.trainerId])
        : null;

    const weightPoints = weights.reverse().map((w) => ({ label: date(w.recordedAt), value: w.weightKg }));
    const weightChange = weightPoints.length > 1 ? weightPoints.at(-1).value - weightPoints[0].value : 0;
    const totalWorkouts = weekly.reduce((s, w) => s + w.workouts, 0);
    // One bar per week for the last 8 weeks, including weeks with no workouts
    const byWeek = new Map(weekly.map((w) => [w._id.getTime(), w.volume]));
    const monday = daysAgo((new Date().getDay() + 6) % 7);
    monday.setHours(0, 0, 0, 0);
    const weeks = Array.from({ length: 8 }, (_, i) => {
        const start = new Date(monday);
        start.setDate(start.getDate() - (7 - i) * 7);
        return {
            label: `Week of ${date(start)}`,
            shortLabel: start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
            value: byWeek.get(start.getTime()) ?? 0,
        };
    });
    const clientPlan = plan && {
        id: String(plan._id),
        days: plan.days.map((d) => ({ day: d.day, title: d.title, exercises: d.exercises.map((e) => ({ name: e.name, sets: e.sets, reps: e.reps })) })),
    };

    return (
        <>
            <PageHeader title="Workouts & progress" subtitle="Your plan, your logs and how you are improving">
                <Link href="/member/workouts/new" className="btn btn-primary">Create my own plan</Link>
            </PageHeader>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Workouts (8 weeks)" value={totalWorkouts} hint={`${(totalWorkouts / 8).toFixed(1)} per week`} />
                <Stat label="Volume this week" value={`${num(Math.round(weeks.at(-1).value))} kg`} hint={`Last week: ${num(Math.round(weeks.at(-2).value))} kg (reps × weight)`} />
                <Stat label="Body weight" value={weightPoints.length ? `${weightPoints.at(-1).value} kg` : '—'}
                    hint={weightPoints.length > 1 ? `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg since ${weightPoints[0].label}` : 'Log your weight below'} />
                <Stat label="Personal records" value={records.length} hint="Exercises with a best lift" />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card title="Weekly training volume" subtitle="Total kg lifted per week (MongoDB aggregation)">
                    {weekly.length ? (
                        <ColumnChart height={160} format={(v) => `${num(Math.round(v))} kg`} rows={weeks} />
                    ) : <Empty>Log a workout to see your progress.</Empty>}
                </Card>
                <Card title="Body weight" subtitle="Weekly readings"
                    action={
                        <ActionForm action={logBodyWeight} resetOnSuccess inlineMessage className="flex items-center gap-2">
                            <input name="weight" type="number" step="0.1" min="25" max="300" className="input w-24" placeholder="kg" required aria-label="Weight in kg" />
                            <SubmitButton className="btn btn-secondary btn-sm">Add</SubmitButton>
                        </ActionForm>
                    }>
                    {weightPoints.length > 1 ? <LineChart points={weightPoints} format={(v) => `${v} kg`} /> : <Empty>Add two readings to see a trend.</Empty>}
                </Card>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <Card title={plan ? plan.title : 'Workout plan'} subtitle={plan ? `${label(plan.goal)} · ${coach ? `by ${coach.full_name}` : 'self-made'}` : null} className="lg:col-span-2">
                    {clientPlan ? <WorkoutLogger plan={clientPlan} action={logWorkout} /> : (
                        <Empty>No workout plan yet. <Link href="/member/workouts/new" className="text-teal-700 underline">Create your own</Link> or ask a trainer to make one for you.</Empty>
                    )}
                </Card>
                <div className="space-y-6">
                    <Card title="My plans" action={<Link href="/member/workouts/new" className="text-sm text-teal-700 hover:underline">+ New plan</Link>}>
                        {allPlans.length ? (
                            <ul className="divide-y divide-slate-100">
                                {allPlans.map((p) => (
                                    <li key={String(p._id)} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{p.title}</p>
                                            <p className="text-xs text-slate-500">{p.trainerId ? 'From your trainer' : 'Made by you'} · {p.days.length} days · {date(p.createdAt)}</p>
                                        </div>
                                        {p.status === 'active' ? <Badge status="active" /> : (
                                            <div className="flex gap-1">
                                                <ActionForm action={activatePlan} inlineMessage>
                                                    <input type="hidden" name="plan_id" value={String(p._id)} />
                                                    <SubmitButton className="btn btn-secondary btn-sm">Use</SubmitButton>
                                                </ActionForm>
                                                {!p.trainerId && (
                                                    <ActionForm action={deleteOwnPlan} inlineMessage>
                                                        <input type="hidden" name="plan_id" value={String(p._id)} />
                                                        <SubmitButton className="btn btn-danger btn-sm">Delete</SubmitButton>
                                                    </ActionForm>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : <Empty>No plans yet.</Empty>}
                    </Card>
                    <Card title="Personal records">
                        {records.length ? <BarList rows={records.map((r) => ({ label: `${r._id} (${r.reps} reps)`, value: r.bestKg }))} format={(v) => `${v} kg`} /> : <Empty>No lifts logged yet.</Empty>}
                    </Card>
                    <Card title="Recent workouts">
                        {recent.length ? (
                            <ul className="space-y-2 text-sm">
                                {recent.map((w) => (
                                    <li key={String(w._id)} className="flex justify-between gap-2">
                                        <span>{date(w.performedAt)}</span>
                                        <span className="text-slate-500">{w.exercises?.length ?? 0} exercises · {w.durationMin} min · RPE {w.rpe}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : <Empty>Nothing logged yet.</Empty>}
                    </Card>
                </div>
            </div>
        </>
    );
}

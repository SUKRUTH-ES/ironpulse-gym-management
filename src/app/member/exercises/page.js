import { mongo } from '@/lib/mongo';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { label, daysAgo } from '@/lib/format';

export const metadata = { title: 'Exercise library' };

const LEVELS = ['beginner', 'intermediate', 'advanced'];
const CATEGORIES = ['strength', 'cardio', 'mobility', 'plyometric'];

export default async function ExercisesPage({ searchParams }) {
    const { q = '', level = '', category = '' } = await searchParams;
    const exercises = mongo().collection('exercises');

    // $text uses the weighted text index (name > muscle > tags > instructions)
    const filter = {};
    if (q.trim()) filter.$text = { $search: q.trim() };
    if (LEVELS.includes(level)) filter.level = level;
    if (CATEGORIES.includes(category)) filter.category = category;

    const [results, popular] = await Promise.all([
        exercises
            .find(filter, q.trim() ? { projection: { score: { $meta: 'textScore' } }, sort: { score: { $meta: 'textScore' } } } : { sort: { name: 1 } })
            .limit(40)
            .toArray(),
        // Most logged exercises across all members in the last 30 days
        mongo().collection('workout_logs').aggregate([
            { $match: { performedAt: { $gte: daysAgo(30) } } },
            { $unwind: '$exercises' },
            { $group: { _id: '$exercises.name', times: { $sum: 1 }, members: { $addToSet: '$memberId' } } },
            { $project: { times: 1, members: { $size: '$members' } } },
            { $sort: { times: -1 } },
            { $limit: 6 },
        ]).toArray(),
    ]);

    const chip = (name, value, current) => {
        const sp = new URLSearchParams({ q, level, category, [name]: value });
        for (const [k, v] of [...sp]) if (!v) sp.delete(k);
        return (
            <a key={value || 'all'} href={`?${sp}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${current === value ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                {value ? label(value) : 'All'}
            </a>
        );
    };

    return (
        <>
            <PageHeader title="Exercise library" subtitle="Search by name, muscle or goal, e.g. “back pain”, “no equipment”, “glutes”" />
            <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                    <form className="flex gap-2">
                        <input name="q" defaultValue={q} className="input" placeholder="Search exercises" />
                        {level && <input type="hidden" name="level" value={level} />}
                        {category && <input type="hidden" name="category" value={category} />}
                        <button className="btn btn-secondary">Search</button>
                    </form>
                    <div className="flex flex-wrap gap-2">{['', ...LEVELS].map((l) => chip('level', l, level))}</div>
                    <div className="flex flex-wrap gap-2">{['', ...CATEGORIES].map((c) => chip('category', c, category))}</div>

                    {results.length ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                            {results.map((e) => (
                                <Card key={String(e._id)}>
                                    <div className="mb-2 flex items-start justify-between gap-2">
                                        <p className="font-semibold">{e.name}</p>
                                        <Badge status={{ beginner: 'low', intermediate: 'medium', advanced: 'high' }[e.level]}>{e.level}</Badge>
                                    </div>
                                    <p className="text-sm text-teal-800">{label(e.primaryMuscle)}{e.secondaryMuscles?.length ? ` + ${e.secondaryMuscles.join(', ')}` : ''}</p>
                                    <p className="mt-1 text-xs text-slate-500">Equipment: {e.equipment.join(', ')}</p>
                                    <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm text-slate-600">
                                        {e.instructions.map((step) => <li key={step}>{step}</li>)}
                                    </ol>
                                </Card>
                            ))}
                        </div>
                    ) : <Empty>No exercises match.</Empty>}
                </div>
                <Card title="Popular this month" subtitle="Most logged across the gym" className="h-fit">
                    {popular.length ? (
                        <ol className="space-y-2 text-sm">
                            {popular.map((p, i) => (
                                <li key={p._id} className="flex justify-between gap-2">
                                    <span>{i + 1}. {p._id}</span>
                                    <span className="text-slate-500 tabular-nums">{p.times}× · {p.members} members</span>
                                </li>
                            ))}
                        </ol>
                    ) : <Empty>No workouts logged yet.</Empty>}
                </Card>
            </div>
        </>
    );
}

'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { label } from '@/lib/format';

const GOALS = ['general_fitness', 'weight_loss', 'muscle_gain', 'endurance', 'flexibility'];
const defaultReps = (category) => ({ cardio: '20 min', mobility: '45s' })[category] ?? '10-12';
const emptyDay = () => ({ title: '', items: [], pick: '' });

// Lets a member put together their own plan: days -> exercises -> sets x reps.
// The finished plan is sent to the server action as one JSON field.
export function PlanBuilder({ exercises, action }) {
    const [title, setTitle] = useState('');
    const [goal, setGoal] = useState('general_fitness');
    const [days, setDays] = useState([emptyDay()]);
    const bySlug = new Map(exercises.map((e) => [e.slug, e]));
    const groups = Map.groupBy(exercises, (e) => (e.custom ? 'My exercises' : label(e.category)));

    const updateDay = (i, change) => setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...change(d) } : d)));
    const addExercise = (i) => updateDay(i, (d) => {
        const ex = bySlug.get(d.pick);
        if (!ex || d.items.some((it) => it.slug === ex.slug)) return {};
        return { items: [...d.items, { slug: ex.slug, name: ex.name, sets: ex.category === 'cardio' ? 1 : 3, reps: defaultReps(ex.category) }], pick: '' };
    });
    const setItem = (i, k, field, value) => updateDay(i, (d) => ({ items: d.items.map((it, j) => (j === k ? { ...it, [field]: value } : it)) }));
    const removeItem = (i, k) => updateDay(i, (d) => ({ items: d.items.filter((_, j) => j !== k) }));

    const payload = JSON.stringify({ title, goal, days: days.map((d) => ({ title: d.title, items: d.items })) });

    return (
        <ActionForm action={action} className="space-y-5">
            <input type="hidden" name="plan" value={payload} />
            <div className="grid gap-3 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="title">Plan name</label>
                    <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. My 4-day split" maxLength={100} required />
                </div>
                <div>
                    <label className="label" htmlFor="goal">Goal</label>
                    <select id="goal" className="input" value={goal} onChange={(e) => setGoal(e.target.value)}>
                        {GOALS.map((g) => <option key={g} value={g}>{label(g)}</option>)}
                    </select>
                </div>
            </div>

            {days.map((d, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-3 flex items-center gap-2">
                        <span className="text-sm font-semibold whitespace-nowrap">Day {i + 1}</span>
                        <input className="input" value={d.title} onChange={(e) => updateDay(i, () => ({ title: e.target.value }))} placeholder="Title, e.g. Push, Legs, Cardio" maxLength={50} aria-label={`Day ${i + 1} title`} />
                        {days.length > 1 && (
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDays((ds) => ds.filter((_, j) => j !== i))}>Remove day</button>
                        )}
                    </div>

                    {d.items.length > 0 && (
                        <ul className="mb-3 space-y-2">
                            {d.items.map((it, k) => (
                                <li key={it.slug} className="flex flex-wrap items-center gap-2 text-sm">
                                    <span className="min-w-40 flex-1 font-medium">{it.name}</span>
                                    <input type="number" min="1" max="10" className="input w-16 px-2" value={it.sets} onChange={(e) => setItem(i, k, 'sets', e.target.value)} aria-label={`${it.name} sets`} />
                                    <span className="text-slate-500">sets ×</span>
                                    <input className="input w-28 px-2" value={it.reps} onChange={(e) => setItem(i, k, 'reps', e.target.value)} maxLength={20} aria-label={`${it.name} reps`} />
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeItem(i, k)} aria-label={`Remove ${it.name}`}>✕</button>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="flex gap-2">
                        <select className="input" value={d.pick} onChange={(e) => updateDay(i, () => ({ pick: e.target.value }))} aria-label={`Exercise to add to day ${i + 1}`}>
                            <option value="">Choose an exercise…</option>
                            {[...groups].map(([group, list]) => (
                                <optgroup key={group} label={group}>
                                    {list.map((e) => <option key={e.slug} value={e.slug}>{e.name} ({e.primaryMuscle})</option>)}
                                </optgroup>
                            ))}
                        </select>
                        <button type="button" className="btn btn-secondary" disabled={!d.pick} onClick={() => addExercise(i)}>Add</button>
                    </div>
                </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="btn btn-secondary" disabled={days.length >= 7} onClick={() => setDays((ds) => [...ds, emptyDay()])}>
                    + Add day
                </button>
                <SubmitButton pendingText="Saving…">Save and make active</SubmitButton>
            </div>
            <p className="text-xs text-slate-500">Reps can be a number or range (10, 8-12), a time (30s, 20 min) or AMRAP. Saving makes this your active plan; your old plan is kept in “My plans”.</p>
        </ActionForm>
    );
}

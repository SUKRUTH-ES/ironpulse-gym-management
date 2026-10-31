'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { isTimed } from '@/lib/workout';

// Form that adapts to the chosen plan day: one row of inputs per set.
export function WorkoutLogger({ plan, action }) {
    const [dayNo, setDayNo] = useState(plan.days[0].day);
    const day = plan.days.find((d) => d.day === dayNo);

    return (
        <ActionForm action={action} resetOnSuccess className="space-y-4">
            <input type="hidden" name="plan_id" value={plan.id} />
            <div className="flex flex-wrap gap-2">
                {plan.days.map((d) => (
                    <label key={d.day} className="cursor-pointer rounded-full border border-slate-300 px-3 py-1 text-sm has-[:checked]:border-teal-700 has-[:checked]:bg-teal-700 has-[:checked]:text-white">
                        <input type="radio" name="day" value={d.day} checked={d.day === dayNo} onChange={() => setDayNo(d.day)} className="sr-only" />
                        Day {d.day}: {d.title}
                    </label>
                ))}
            </div>

            <div className="space-y-3" key={dayNo}>
                {day.exercises.map((ex, i) => {
                    const timed = isTimed(ex.reps);
                    return (
                        <div key={i} className="rounded-lg border border-slate-200 p-3">
                            <p className="text-sm font-medium">{ex.name} <span className="font-normal text-slate-500">· {ex.sets} × {ex.reps}</span></p>
                            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {Array.from({ length: ex.sets }, (_, s) => (
                                    <div key={s} className="flex items-center gap-1">
                                        <input name={`reps_${i}_${s}`} type="number" min="0" max={timed ? 3600 : 200} className="input px-2" placeholder={timed ? 'sec' : 'reps'} aria-label={`Set ${s + 1} ${timed ? 'seconds' : 'reps'}`} />
                                        {!timed && <input name={`kg_${i}_${s}`} type="number" min="0" max="600" step="0.5" className="input px-2" placeholder="kg" aria-label={`Set ${s + 1} weight`} />}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <div><label className="label" htmlFor="duration">Minutes</label><input id="duration" name="duration" type="number" min="5" max="300" defaultValue="60" className="input" /></div>
                <div><label className="label" htmlFor="rpe">Effort (1–10)</label><input id="rpe" name="rpe" type="number" min="1" max="10" defaultValue="7" className="input" /></div>
                <div><label className="label" htmlFor="notes">Notes</label><input id="notes" name="notes" maxLength={500} className="input" placeholder="Optional" /></div>
            </div>
            <SubmitButton>Save workout</SubmitButton>
        </ActionForm>
    );
}

import { sql } from '@/lib/db';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { createPlan, togglePlan } from '../actions';
import { inr } from '@/lib/format';

export const metadata = { title: 'Plans' };

export default async function PlansPage() {
    const plans = await sql(
        `SELECT p.*,
                (SELECT COUNT(*) FROM v_current_memberships cm WHERE cm.plan_id = p.plan_id) AS current_members,
                (SELECT COUNT(*) FROM memberships ms WHERE ms.plan_id = p.plan_id) AS times_sold
         FROM membership_plans p ORDER BY p.is_active DESC, p.price`);

    return (
        <>
            <PageHeader title="Membership plans" subtitle="Plans that are switched off stay in history but can't be bought." />
            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead><tr><th>Plan</th><th className="num">Price</th><th className="num">Days</th><th>Classes / week</th><th className="num">PT</th><th className="num">Freeze</th><th className="num">Members now</th><th /></tr></thead>
                            <tbody>
                                {plans.map((p) => (
                                    <tr key={p.plan_id} className={p.is_active ? '' : 'text-slate-400'}>
                                        <td>
                                            <div className="font-medium">{p.name} {!p.is_active && <Badge status="expired">off</Badge>}</div>
                                            <div className="text-xs text-slate-500">{p.description}</div>
                                        </td>
                                        <td className="num">{inr(p.price)}</td>
                                        <td className="num">{p.duration_days}</td>
                                        <td>{p.classes_per_week ?? 'Unlimited'}</td>
                                        <td className="num">{p.pt_sessions_included}</td>
                                        <td className="num">{p.max_freeze_days}d</td>
                                        <td className="num">{p.current_members}<div className="text-xs text-slate-400">{p.times_sold} sold</div></td>
                                        <td className="text-right">
                                            <ActionForm action={togglePlan}>
                                                <input type="hidden" name="plan_id" value={p.plan_id} />
                                                <SubmitButton className="btn btn-secondary btn-sm">{p.is_active ? 'Switch off' : 'Switch on'}</SubmitButton>
                                            </ActionForm>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>

                <Card title="New plan" className="h-fit">
                    <ActionForm action={createPlan} resetOnSuccess className="space-y-3">
                        <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" className="input" required maxLength={50} /></div>
                        <div><label className="label" htmlFor="description">Description</label><input id="description" name="description" className="input" maxLength={255} /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div><label className="label" htmlFor="price">Price (₹)</label><input id="price" name="price" type="number" min="0" step="1" className="input" required /></div>
                            <div><label className="label" htmlFor="duration_days">Days</label><input id="duration_days" name="duration_days" type="number" min="1" max="730" className="input" required /></div>
                            <div><label className="label" htmlFor="classes_per_week">Classes / week</label><input id="classes_per_week" name="classes_per_week" type="number" min="1" max="21" className="input" placeholder="Unlimited" /></div>
                            <div><label className="label" htmlFor="pt_sessions_included">PT sessions</label><input id="pt_sessions_included" name="pt_sessions_included" type="number" min="0" max="50" defaultValue="0" className="input" /></div>
                            <div className="col-span-2"><label className="label" htmlFor="max_freeze_days">Max freeze days</label><input id="max_freeze_days" name="max_freeze_days" type="number" min="0" defaultValue="0" className="input" /></div>
                        </div>
                        <SubmitButton className="btn btn-primary w-full">Create plan</SubmitButton>
                    </ActionForm>
                </Card>
            </div>
        </>
    );
}

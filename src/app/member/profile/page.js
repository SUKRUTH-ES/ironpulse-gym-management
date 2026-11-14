import { requireRole } from '@/lib/auth';
import { sqlOne } from '@/lib/db';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { updateProfile, changePassword } from '../actions';
import { date, dateTime, label } from '@/lib/format';

export const metadata = { title: 'My profile' };

export default async function ProfilePage() {
    const me = await requireRole('member');
    const p = await sqlOne(
        `SELECT u.full_name, u.email, u.phone, u.password_changed_at, m.member_code, m.date_of_birth, m.gender,
                m.height_cm, m.fitness_goal, m.emergency_contact_name, m.emergency_contact_phone, m.joined_on
         FROM users u JOIN members m ON m.user_id = u.user_id WHERE m.member_id = ?`, [me.member_id]);

    return (
        <>
            <PageHeader title="My profile" subtitle={`${p.member_code} · member since ${date(p.joined_on)}`} />
            <div className="grid gap-6 lg:grid-cols-3">
                <Card title="Details" subtitle="Name, e-mail and date of birth can only be changed at the front desk." className="lg:col-span-2">
                    <dl className="mb-5 grid gap-3 text-sm sm:grid-cols-3">
                        <div><dt className="text-slate-500">Name</dt><dd className="font-medium">{p.full_name}</dd></div>
                        <div><dt className="text-slate-500">E-mail</dt><dd className="font-medium">{p.email}</dd></div>
                        <div><dt className="text-slate-500">Born</dt><dd className="font-medium">{date(p.date_of_birth)} · {label(p.gender)}</dd></div>
                    </dl>
                    <ActionForm action={updateProfile} className="grid gap-4 sm:grid-cols-2">
                        <div><label className="label" htmlFor="phone">Mobile number</label><input id="phone" name="phone" className="input" defaultValue={p.phone ?? ''} inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} required /></div>
                        <div><label className="label" htmlFor="height_cm">Height (cm)</label><input id="height_cm" name="height_cm" type="number" step="0.5" min="100" max="250" className="input" defaultValue={p.height_cm ?? ''} /></div>
                        <div className="sm:col-span-2">
                            <label className="label" htmlFor="fitness_goal">Main goal</label>
                            <select id="fitness_goal" name="fitness_goal" className="input" defaultValue={p.fitness_goal}>
                                {['general_fitness', 'weight_loss', 'muscle_gain', 'endurance', 'flexibility'].map((g) => <option key={g} value={g}>{label(g)}</option>)}
                            </select>
                        </div>
                        <div><label className="label" htmlFor="emergency_contact_name">Emergency contact</label><input id="emergency_contact_name" name="emergency_contact_name" className="input" maxLength={100} defaultValue={p.emergency_contact_name ?? ''} /></div>
                        <div><label className="label" htmlFor="emergency_contact_phone">Their mobile</label><input id="emergency_contact_phone" name="emergency_contact_phone" className="input" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} defaultValue={p.emergency_contact_phone ?? ''} /></div>
                        <div className="sm:col-span-2"><SubmitButton>Save profile</SubmitButton></div>
                    </ActionForm>
                </Card>

                <Card title="Change password" subtitle={p.password_changed_at ? `Last changed ${dateTime(p.password_changed_at)}` : 'Never changed since sign-up.'}>
                    <ActionForm action={changePassword} resetOnSuccess className="space-y-3">
                        <div><label className="label" htmlFor="current">Current password</label><input id="current" name="current" type="password" className="input" required autoComplete="current-password" /></div>
                        <div><label className="label" htmlFor="password">New password</label><input id="password" name="password" type="password" className="input" required minLength={8} autoComplete="new-password" /></div>
                        <div><label className="label" htmlFor="confirm">Repeat new password</label><input id="confirm" name="confirm" type="password" className="input" required minLength={8} autoComplete="new-password" /></div>
                        <SubmitButton className="btn btn-primary w-full">Change password</SubmitButton>
                    </ActionForm>
                </Card>
            </div>
        </>
    );
}

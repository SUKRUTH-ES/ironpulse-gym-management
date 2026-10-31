import Link from 'next/link';
import { register } from '@/app/actions/auth';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Logo } from '@/components/brand';

export const metadata = { title: 'Join' };

export default function RegisterPage() {
    return (
        <main className="flex flex-1 items-center justify-center px-4 py-12">
            <div className="w-full max-w-lg">
                <div className="mb-8 flex justify-center"><Logo /></div>
                <div className="card">
                    <h1 className="mb-1 text-xl font-semibold">Become a member</h1>
                    <p className="mb-5 text-sm text-slate-500">Create your account, then pick a membership plan.</p>
                    <ActionForm action={register} className="grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <label className="label" htmlFor="full_name">Full name</label>
                            <input className="input" id="full_name" name="full_name" required minLength={2} maxLength={100} autoComplete="name" />
                        </div>
                        <div>
                            <label className="label" htmlFor="email">E-mail</label>
                            <input className="input" id="email" name="email" type="email" required autoComplete="email" />
                        </div>
                        <div>
                            <label className="label" htmlFor="phone">Mobile number</label>
                            <input className="input" id="phone" name="phone" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} required placeholder="98XXXXXXXX" />
                        </div>
                        <div>
                            <label className="label" htmlFor="date_of_birth">Date of birth</label>
                            <input className="input" id="date_of_birth" name="date_of_birth" type="date" required />
                        </div>
                        <div>
                            <label className="label" htmlFor="gender">Gender</label>
                            <select className="input" id="gender" name="gender" required defaultValue="">
                                <option value="" disabled>Select…</option>
                                <option value="female">Female</option>
                                <option value="male">Male</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        <div className="sm:col-span-2">
                            <label className="label" htmlFor="fitness_goal">Main goal</label>
                            <select className="input" id="fitness_goal" name="fitness_goal" defaultValue="general_fitness">
                                <option value="general_fitness">General fitness</option>
                                <option value="weight_loss">Weight loss</option>
                                <option value="muscle_gain">Muscle gain</option>
                                <option value="endurance">Endurance</option>
                                <option value="flexibility">Flexibility</option>
                            </select>
                        </div>
                        <div>
                            <label className="label" htmlFor="password">Password</label>
                            <input className="input" id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
                        </div>
                        <div>
                            <label className="label" htmlFor="confirm">Confirm password</label>
                            <input className="input" id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
                        </div>
                        <div className="sm:col-span-2">
                            <SubmitButton className="btn btn-primary w-full" pendingText="Creating account…">Create account</SubmitButton>
                        </div>
                    </ActionForm>
                </div>
                <p className="mt-4 text-center text-sm text-slate-600">
                    Already a member? <Link href="/login" className="font-medium text-teal-700 hover:underline">Log in</Link>
                </p>
            </div>
        </main>
    );
}

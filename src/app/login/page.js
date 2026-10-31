import Link from 'next/link';
import { login } from '@/app/actions/auth';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Logo } from '@/components/brand';

export const metadata = { title: 'Log in' };

export default function LoginPage() {
    return (
        <main className="flex flex-1 items-center justify-center px-4 py-12">
            <div className="w-full max-w-sm">
                <div className="mb-8 flex justify-center"><Logo /></div>
                <div className="card">
                    <h1 className="mb-1 text-xl font-semibold">Log in</h1>
                    <p className="mb-5 text-sm text-slate-500">Members, trainers and staff all log in here.</p>
                    <ActionForm action={login} className="space-y-4">
                        <div>
                            <label className="label" htmlFor="email">E-mail</label>
                            <input className="input" id="email" name="email" type="email" autoComplete="email" required />
                        </div>
                        <div>
                            <label className="label" htmlFor="password">Password</label>
                            <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
                        </div>
                        <SubmitButton className="btn btn-primary w-full" pendingText="Logging in…">Log in</SubmitButton>
                    </ActionForm>
                </div>
                <p className="mt-4 text-center text-sm text-slate-600">
                    New here? <Link href="/register" className="font-medium text-teal-700 hover:underline">Become a member</Link>
                </p>
            </div>
        </main>
    );
}

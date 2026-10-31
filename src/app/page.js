import Link from 'next/link';
import { sql } from '@/lib/db';
import { Logo } from '@/components/brand';
import { inr } from '@/lib/format';

export default async function Home() {
    const [plans, classTypes] = await Promise.all([
        sql('SELECT plan_id, name, description, duration_days, price FROM membership_plans WHERE is_active AND duration_days > 1 ORDER BY duration_days'),
        sql('SELECT name, intensity, duration_min FROM class_types ORDER BY name'),
    ]);

    return (
        <div className="flex flex-1 flex-col">
            <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
                <Logo />
                <nav className="flex gap-2">
                    <Link href="/login" className="btn btn-secondary">Log in</Link>
                    <Link href="/register" className="btn btn-primary">Join now</Link>
                </nav>
            </header>

            <main className="mx-auto w-full max-w-6xl flex-1 px-4">
                <section className="py-14 md:py-20">
                    <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">
                        Train smarter. Book classes, work with a coach, and see your progress.
                    </h1>
                    <p className="mt-4 max-w-xl text-lg text-slate-600">
                        IronPulse members book group classes in seconds, join a waitlist when a class is full, request personal training and track every workout.
                    </p>
                    <div className="mt-8 flex gap-3">
                        <Link href="/register" className="btn btn-primary px-5 py-2.5 text-base">Become a member</Link>
                        <Link href="/login" className="btn btn-secondary px-5 py-2.5 text-base">I already have an account</Link>
                    </div>
                </section>

                <section className="pb-14">
                    <h2 className="mb-4 text-xl font-semibold">Membership plans</h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        {plans.map((p) => (
                            <div key={p.plan_id} className="card flex flex-col">
                                <p className="font-semibold">{p.name}</p>
                                <p className="mt-2 text-2xl font-semibold tabular-nums">{inr(p.price)}</p>
                                <p className="text-xs text-slate-500">{p.duration_days} days</p>
                                <p className="mt-3 text-sm text-slate-600">{p.description}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="pb-20">
                    <h2 className="mb-4 text-xl font-semibold">Group classes</h2>
                    <div className="flex flex-wrap gap-2">
                        {classTypes.map((c) => (
                            <span key={c.name} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm">
                                {c.name} <span className="text-slate-400">· {c.duration_min} min · {c.intensity}</span>
                            </span>
                        ))}
                    </div>
                </section>
            </main>

            <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
                IronPulse Gym Management System · DBMS mini project
            </footer>
        </div>
    );
}

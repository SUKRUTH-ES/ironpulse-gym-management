import { logout } from '@/app/actions/auth';
import { Logo } from './brand';
import { NavLinks } from './nav-links';

// Page frame for logged-in users: sidebar navigation + content area.
export function Shell({ user, nav, home, children }) {
    return (
        <div className="flex min-h-screen flex-col md:flex-row">
            <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
                <div className="flex h-full flex-col">
                    <div className="px-5 py-4"><Logo href={home} /></div>
                    <NavLinks items={nav} />
                    <div className="mt-auto hidden border-t border-slate-200 p-4 md:block">
                        <p className="truncate text-sm font-medium text-slate-900">{user.full_name}</p>
                        <p className="truncate text-xs text-slate-500 capitalize">
                            {user.role}{user.member_code ? ` · ${user.member_code}` : ''}
                        </p>
                        <form action={logout} className="mt-3">
                            <button className="btn btn-secondary btn-sm w-full">Log out</button>
                        </form>
                    </div>
                </div>
            </aside>
            <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
                <div className="mx-auto max-w-6xl">{children}</div>
                <form action={logout} className="mt-10 md:hidden">
                    <button className="btn btn-secondary w-full">Log out ({user.full_name})</button>
                </form>
            </main>
        </div>
    );
}

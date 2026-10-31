'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ items }) {
    const pathname = usePathname();
    const root = items[0]?.href;
    return (
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
            {items.map((item) => {
                const active = item.href === root ? pathname === root : pathname.startsWith(item.href);
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                            active ? 'bg-teal-50 font-medium text-teal-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                    >
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );
}

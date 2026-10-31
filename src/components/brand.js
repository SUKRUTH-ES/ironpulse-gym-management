import Link from 'next/link';

export function Logo({ href = '/', light = false }) {
    return (
        <Link href={href} className={`flex items-center gap-2 font-semibold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>
            <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
                <rect width="24" height="24" rx="6" className="fill-teal-700" />
                <path d="M4 12h3l2-5 3 10 2-6 1.5 3H20" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            IronPulse
        </Link>
    );
}

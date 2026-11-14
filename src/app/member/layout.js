import { requireRole } from '@/lib/auth';
import { Shell } from '@/components/shell';

const NAV = [
    { href: '/member', label: 'Home' },
    { href: '/member/classes', label: 'Book classes' },
    { href: '/member/training', label: 'Personal training' },
    { href: '/member/workouts', label: 'Workouts & progress' },
    { href: '/member/exercises', label: 'Exercise library' },
    { href: '/member/membership', label: 'Membership' },
    { href: '/member/profile', label: 'My profile' },
];

export default async function MemberLayout({ children }) {
    const user = await requireRole('member');
    return <Shell user={user} nav={NAV} home="/member">{children}</Shell>;
}

import { requireRole } from '@/lib/auth';
import { Shell } from '@/components/shell';

const NAV = [
    { href: '/trainer', label: 'My schedule' },
    { href: '/trainer/members', label: 'Members & plans' },
];

export default async function TrainerLayout({ children }) {
    const user = await requireRole('trainer');
    return <Shell user={user} nav={NAV} home="/trainer">{children}</Shell>;
}

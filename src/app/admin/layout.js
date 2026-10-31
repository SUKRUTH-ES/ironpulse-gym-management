import { requireRole } from '@/lib/auth';
import { Shell } from '@/components/shell';

const NAV = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/check-in', label: 'Front desk' },
    { href: '/admin/members', label: 'Members' },
    { href: '/admin/classes', label: 'Classes' },
    { href: '/admin/payments', label: 'Payments' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/plans', label: 'Plans' },
];

export default async function AdminLayout({ children }) {
    const user = await requireRole('admin');
    return <Shell user={user} nav={NAV} home="/admin">{children}</Shell>;
}

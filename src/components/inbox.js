import { Card, Empty } from './ui';

// In-app notifications (MongoDB) with a "Mark read" button; used on the member and trainer home pages.
export function NotificationsCard({ notes, markRead, className = '' }) {
    const unread = notes.filter((n) => !n.readAt).length;
    return (
        <Card title={`Notifications${unread ? ` (${unread} new)` : ''}`} className={className}
            action={unread > 0 && <form action={markRead}><button className="text-sm text-teal-700 hover:underline">Mark read</button></form>}>
            {notes.length ? (
                <ul className="space-y-3">
                    {notes.map((n) => (
                        <li key={String(n._id)} className={`rounded-lg p-3 text-sm ${n.readAt ? 'bg-slate-50' : 'bg-teal-50'}`}>
                            <p className="font-medium text-slate-900">{n.title}</p>
                            {n.message && <p className="mt-0.5 text-slate-600">{n.message}</p>}
                            <p className="mt-1 text-xs text-slate-400">{n.createdAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
                        </li>
                    ))}
                </ul>
            ) : <Empty>No notifications.</Empty>}
        </Card>
    );
}

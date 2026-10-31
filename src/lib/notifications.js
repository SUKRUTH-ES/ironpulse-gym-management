import 'server-only';
import { mongo } from './mongo';

// In-app notifications live in MongoDB; a TTL index removes them after 60 days.
export async function notify(userId, type, title, message = '', meta = {}) {
    await mongo().collection('notifications').insertOne({
        userId: Number(userId), type, title, message, readAt: null, createdAt: new Date(), meta,
    });
}

export async function inbox(userId, limit = 8) {
    return mongo().collection('notifications')
        .find({ userId: Number(userId) })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
}

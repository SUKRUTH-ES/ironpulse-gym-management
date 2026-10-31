import 'server-only';
import { MongoClient, ObjectId } from 'mongodb';

// The driver connects on first use and keeps its own connection pool.
const client = globalThis.gymMongoClient ?? new MongoClient(process.env.MONGODB_URI);
if (process.env.NODE_ENV !== 'production') globalThis.gymMongoClient = client;

export function mongo() {
    return client.db(process.env.MONGODB_DB);
}

export function toObjectId(id) {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

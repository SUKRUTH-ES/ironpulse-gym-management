// =====================================================================
//  MongoDB data model (database: gym_mongo)
//
//  Why these live in MongoDB and not MySQL:
//   - A workout plan / log is one nested document (days -> exercises -> sets)
//     whose shape differs per exercise type (strength has reps+weight, cardio
//     has minutes+distance, mobility has hold time). In SQL this would be
//     4-5 tables joined on every read; here it is one read of one document.
//   - Body measurements are append-only readings over time: a native
//     time-series collection stores and aggregates them efficiently.
//   - Notifications are short-lived: a TTL index deletes them automatically.
//   - The exercise library is searched by free text across names, muscles
//     and instructions: a weighted text index handles that.
//
//  Link to MySQL: memberId / trainerId / userId are the integer primary keys
//  of gym_db.members / trainers / users. The API checks they exist in MySQL
//  before writing here (application-level referential integrity).
// =====================================================================

// One set: reps (+ weight) for lifts, durationSec for holds like a plank
const setRep = {
    bsonType: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
        reps: { bsonType: 'int', minimum: 0, maximum: 200 },
        weightKg: { bsonType: ['double', 'int'], minimum: 0, maximum: 600 },
        durationSec: { bsonType: 'int', minimum: 1, maximum: 3600 },
    },
};

export const collections = [
    {
        name: 'exercises',
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['name', 'slug', 'category', 'primaryMuscle', 'level', 'equipment', 'instructions'],
                properties: {
                    name: { bsonType: 'string', minLength: 2 },
                    slug: { bsonType: 'string', pattern: '^[a-z0-9-]+$' },
                    category: { enum: ['strength', 'cardio', 'mobility', 'plyometric'] },
                    primaryMuscle: { bsonType: 'string' },
                    secondaryMuscles: { bsonType: 'array', items: { bsonType: 'string' } },
                    equipment: { bsonType: 'array', items: { bsonType: 'string' } },
                    level: { enum: ['beginner', 'intermediate', 'advanced'] },
                    instructions: { bsonType: 'array', minItems: 1, items: { bsonType: 'string' } },
                    tags: { bsonType: 'array', items: { bsonType: 'string' } },
                },
            },
        },
        indexes: [
            { key: { slug: 1 }, options: { unique: true, name: 'uq_slug' } },
            { key: { primaryMuscle: 1, level: 1 }, options: { name: 'muscle_level' } },
            {
                key: { name: 'text', primaryMuscle: 'text', tags: 'text', instructions: 'text' },
                options: {
                    name: 'txt_exercise_search',
                    weights: { name: 10, primaryMuscle: 6, tags: 4, instructions: 1 },
                },
            },
        ],
    },
    {
        name: 'workout_plans',
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['memberId', 'title', 'goal', 'days', 'status', 'createdAt'],
                properties: {
                    memberId: { bsonType: 'int' },
                    trainerId: { bsonType: ['int', 'null'] },
                    title: { bsonType: 'string', minLength: 3, maxLength: 100 },
                    goal: { enum: ['weight_loss', 'muscle_gain', 'endurance', 'flexibility', 'general_fitness'] },
                    durationWeeks: { bsonType: 'int', minimum: 1, maximum: 52 },
                    status: { enum: ['active', 'archived'] },
                    days: {
                        bsonType: 'array',
                        minItems: 1,
                        maxItems: 7,
                        items: {
                            bsonType: 'object',
                            required: ['day', 'title', 'exercises'],
                            properties: {
                                day: { bsonType: 'int', minimum: 1, maximum: 7 },
                                title: { bsonType: 'string' },
                                exercises: {
                                    bsonType: 'array',
                                    minItems: 1,
                                    items: {
                                        bsonType: 'object',
                                        required: ['exerciseId', 'name', 'sets'],
                                        properties: {
                                            exerciseId: { bsonType: 'objectId' },
                                            name: { bsonType: 'string' },
                                            sets: { bsonType: 'int', minimum: 1, maximum: 10 },
                                            reps: { bsonType: 'string' }, // "8-10", "AMRAP", "30s"
                                            restSec: { bsonType: 'int', minimum: 0, maximum: 600 },
                                            notes: { bsonType: 'string' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
        indexes: [
            { key: { memberId: 1, status: 1 }, options: { name: 'member_status' } },
            { key: { trainerId: 1, createdAt: -1 }, options: { name: 'trainer_recent' } },
        ],
    },
    {
        name: 'workout_logs',
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['memberId', 'performedAt', 'durationMin'],
                properties: {
                    memberId: { bsonType: 'int' },
                    planId: { bsonType: ['objectId', 'null'] },
                    performedAt: { bsonType: 'date' },
                    durationMin: { bsonType: 'int', minimum: 5, maximum: 300 },
                    rpe: { bsonType: 'int', minimum: 1, maximum: 10 }, // rate of perceived exertion
                    notes: { bsonType: 'string', maxLength: 500 },
                    exercises: {
                        bsonType: 'array',
                        items: {
                            bsonType: 'object',
                            required: ['exerciseId', 'name', 'sets'],
                            properties: {
                                exerciseId: { bsonType: 'objectId' },
                                name: { bsonType: 'string' },
                                sets: { bsonType: 'array', minItems: 1, items: setRep },
                            },
                        },
                    },
                    cardio: {
                        bsonType: 'array',
                        items: {
                            bsonType: 'object',
                            required: ['activity', 'minutes'],
                            properties: {
                                activity: { bsonType: 'string' },
                                minutes: { bsonType: 'int', minimum: 1, maximum: 300 },
                                distanceKm: { bsonType: ['double', 'int'], minimum: 0 },
                            },
                        },
                    },
                },
            },
        },
        indexes: [
            { key: { memberId: 1, performedAt: -1 }, options: { name: 'member_recent' } },
            { key: { 'exercises.exerciseId': 1 }, options: { name: 'by_exercise' } },
        ],
    },
    {
        // Native time-series collection: one document per reading
        name: 'body_metrics',
        timeseries: { timeField: 'recordedAt', metaField: 'memberId', granularity: 'hours' },
        indexes: [{ key: { memberId: 1, recordedAt: -1 }, options: { name: 'member_time' } }],
    },
    {
        name: 'notifications',
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['userId', 'type', 'title', 'createdAt'],
                properties: {
                    userId: { bsonType: 'int' },
                    type: {
                        enum: ['renewal_reminder', 'waitlist_promoted', 'class_cancelled', 'pt_update', 'plan_assigned', 'general'],
                    },
                    title: { bsonType: 'string' },
                    message: { bsonType: 'string' },
                    readAt: { bsonType: ['date', 'null'] },
                    createdAt: { bsonType: 'date' },
                    meta: { bsonType: 'object' },
                },
            },
        },
        indexes: [
            { key: { userId: 1, readAt: 1, createdAt: -1 }, options: { name: 'user_inbox' } },
            // TTL: MongoDB deletes notifications 60 days after they were created
            { key: { createdAt: 1 }, options: { name: 'ttl_60_days', expireAfterSeconds: 60 * 24 * 3600 } },
        ],
    },
];

export async function createMongoCollections(db) {
    for (const c of collections) {
        const options = {};
        if (c.validator) Object.assign(options, { validator: c.validator, validationLevel: 'strict', validationAction: 'error' });
        if (c.timeseries) options.timeseries = c.timeseries;
        await db.createCollection(c.name, options);
        for (const ix of c.indexes) await db.collection(c.name).createIndex(ix.key, ix.options);
    }
}

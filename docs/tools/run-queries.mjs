// Runs the "important queries" against the live databases and writes
// docs/important-queries.md with the query text and its REAL output.
// Normal queries run as the app account (gym_app). The integrity checks run inside a
// transaction that is always rolled back, so nothing in the database changes.
// Run from the project root:  node docs/tools/run-queries.mjs
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';

process.loadEnvFile('.env.local');
const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    dateStrings: true,
});
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const mdb = mc.db(process.env.MONGODB_DB);

const read = (f) => fs.readFileSync(f, 'utf8');
const routines = read('db/mysql/03_routines.sql');
const views = read('db/mysql/02_views.sql');
const triggers = read('db/mysql/04_triggers.sql');
const events = read('db/mysql/05_events.sql');
// cut one object out of a .sql file: from "CREATE … name" to its END$$ (or ; for views/events)
function extract(src, startPattern, endToken) {
    const i = src.search(startPattern);
    if (i < 0) throw new Error('not found: ' + startPattern);
    const j = src.indexOf(endToken, i);
    return src.slice(i, j + endToken.length).trim();
}

function cell(v) {
    if (v === null || v === undefined) return 'NULL';
    if (v instanceof Date) return v.toISOString().slice(0, 16).replace('T', ' ');
    if (typeof v === 'object' && v.constructor?.name === 'ObjectId') return String(v).slice(-6);
    if (typeof v === 'object') return JSON.stringify(v);
    const s = String(v);
    // space after commas in lists (e.g. possible_keys) so long values can wrap
    return (s.length > 60 ? s.slice(0, 57) + '…' : s).replace(/,(?=[A-Za-z_])/g, ', ').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
function table(rows, max = 8) {
    if (!rows.length) return '_(no rows)_';
    const cols = Object.keys(rows[0]);
    const out = [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`];
    for (const r of rows.slice(0, max)) out.push(`| ${cols.map((c) => cell(r[c])).join(' | ')} |`);
    if (rows.length > max) out.push(`\n_…${rows.length - max} more rows (${rows.length} total)_`);
    return out.join('\n');
}
const fence = (lang, s) => '```' + lang + '\n' + s.replace(/^\n+|\s+$/g, '') + '\n```';

const md = [];
const h = (s) => md.push(s, '');
let n = 0;
async function sqlQuery(title, why, features, text, params = [], onlyCols = null) {
    let [rows] = await conn.query(text, params);
    if (onlyCols) rows = rows.map((r) => Object.fromEntries(onlyCols.map((c) => [c, r[c]])));
    n++;
    h(`### Q${n}. ${title}`);
    h(`**Shows:** ${features}. ${why}`);
    h(fence('sql', text));
    h(`**Output** (run as \`gym_app\`${params.length ? `, parameters ${JSON.stringify(params)}` : ''}):`);
    h(table(rows));
}
async function mongoQuery(title, why, features, coll, pipelineText, run) {
    const rows = await run(mdb.collection(coll));
    n++;
    h(`### Q${n}. ${title}`);
    h(`**Shows:** ${features}. ${why}`);
    h(fence('js', `db.${coll}.${pipelineText}`));
    h('**Output:**');
    h(table(rows.map((r) => {
        const o = {};
        for (const [k, v] of Object.entries(r)) o[k] = v;
        return o;
    })));
}
function codeOnly(title, why, features, lang, text) {
    n++;
    h(`### Q${n}. ${title}`);
    h(`**Shows:** ${features}. ${why}`);
    h(fence(lang, text));
}

// ---------------------------------------------------------------- pick demo subjects from the data
const [[busy]] = await conn.query(`SELECT a.member_id, m.member_code, u.full_name FROM attendance a
    JOIN members m ON m.member_id = a.member_id JOIN users u ON u.user_id = m.user_id
    GROUP BY a.member_id, m.member_code, u.full_name ORDER BY COUNT(*) DESC LIMIT 1`);
const [logTop] = await mdb.collection('workout_logs').aggregate([
    { $group: { _id: '$memberId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1 }]).toArray();
const logMember = logTop._id;

h('# IronPulse — Important Queries');
h('_Every query below is copied from the application code or the `db/` scripts, and every output table was produced by running it on the demo database with `node docs/tools/run-queries.mjs` (generated ' +
    new Date().toISOString().slice(0, 10) + '). Long results are cut to the first rows._');

// ================================================================ SQL
h('## 1. SQL queries (MySQL `gym_db`)');

await sqlQuery('Revenue per membership plan, last 6 months',
    'Used on the admin Reports page (`src/app/admin/reports/page.js`).',
    'three-table JOIN, WHERE with date arithmetic, GROUP BY, COUNT/SUM, ORDER BY',
    `SELECT p.name, COUNT(*) AS sold, SUM(pay.amount) AS revenue
FROM payments pay
JOIN memberships ms     ON ms.membership_id = pay.membership_id
JOIN membership_plans p ON p.plan_id = ms.plan_id
WHERE pay.status = 'completed' AND pay.paid_at >= CURRENT_DATE - INTERVAL 6 MONTH
GROUP BY p.plan_id, p.name
ORDER BY revenue DESC;`);

await sqlQuery('Class popularity — only class types with 5+ finished sessions',
    'Reports page. The derived table counts seats used per session; HAVING filters groups after aggregation.',
    'derived table (subquery in FROM), conditional SUM, AVG, NULLIF, GROUP BY + HAVING',
    `SELECT ct.name, COUNT(DISTINCT cs.class_session_id) AS sessions,
       ROUND(AVG(fill.booked / cs.capacity) * 100, 1) AS avg_fill_pct,
       ROUND(SUM(fill.no_show) / NULLIF(SUM(fill.booked), 0) * 100, 1) AS no_show_pct
FROM class_sessions cs
JOIN class_types ct ON ct.class_type_id = cs.class_type_id
JOIN (SELECT class_session_id,
             SUM(status IN ('attended','no_show')) AS booked,
             SUM(status = 'no_show') AS no_show
      FROM class_bookings GROUP BY class_session_id) fill
  ON fill.class_session_id = cs.class_session_id
WHERE cs.status = 'completed'
GROUP BY ct.class_type_id, ct.name
HAVING COUNT(DISTINCT cs.class_session_id) >= 5
ORDER BY avg_fill_pct DESC;`);

await sqlQuery('Top 10 most consistent members (last 30 days)',
    'Reports page. Members with the same number of visits share a rank.',
    'window function RANK() OVER, subquery in FROM, GROUP BY',
    `SELECT * FROM (
    SELECT m.member_id, u.full_name, COUNT(*) AS visits,
           RANK() OVER (ORDER BY COUNT(*) DESC) AS position
    FROM attendance a
    JOIN members m ON m.member_id = a.member_id
    JOIN users u   ON u.user_id = m.user_id
    WHERE a.check_in >= CURRENT_DATE - INTERVAL 30 DAY
    GROUP BY m.member_id, u.full_name) ranked
WHERE position <= 10
ORDER BY position, full_name;`);

await sqlQuery('Active members who never booked a class',
    'Reports page — a list for the front desk to follow up.',
    'correlated NOT EXISTS subquery on a view',
    `SELECT mo.member_id, mo.full_name, mo.plan_name, mo.joined_on
FROM v_member_overview mo
WHERE mo.membership_status = 'active'
  AND NOT EXISTS (SELECT 1 FROM class_bookings cb WHERE cb.member_id = mo.member_id)
ORDER BY mo.joined_on DESC;`);

await sqlQuery('Full-text trainer search: "back pain"',
    'Member → Training page (`src/app/member/training/page.js`). The member types a problem in plain words; MySQL ranks trainers by relevance.',
    'FULLTEXT index `ft_trainers_profile`, MATCH … AGAINST in NATURAL LANGUAGE MODE, relevance score, prepared-statement parameters (?)',
    `SELECT t.trainer_id, u.full_name, t.specialization,
       MATCH(t.specialization, t.bio) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
FROM trainers t JOIN users u ON u.user_id = t.user_id
WHERE u.is_active AND MATCH(t.specialization, t.bio) AGAINST (? IN NATURAL LANGUAGE MODE)
ORDER BY score DESC;`, ['back pain', 'back pain']);

n++;
h(`### Q${n}. View \`v_member_overview\` (definition + use)`);
h('**Shows:** a view built on another view (LEFT JOIN v_current_memberships), CASE + EXISTS, a correlated scalar subquery (last_visit), derived attributes (age, days_left). Used by the admin Members list, member detail and the Reports page.');
h(fence('sql', extract(views, /CREATE OR REPLACE VIEW v_member_overview/, ';')));
{
    const [rows] = await conn.query(`SELECT member_code, full_name, age, plan_name, days_left, membership_status, last_visit
        FROM v_member_overview ORDER BY member_id LIMIT 6`);
    h('**Output** of `SELECT member_code, full_name, age, plan_name, days_left, membership_status, last_visit FROM v_member_overview ORDER BY member_id LIMIT 6`:');
    h(table(rows));
}

await sqlQuery('Churn risk (view `v_churn_risk`)',
    'Admin Reports: members whose visits in the last 30 days dropped below half of the 30 days before.',
    'view on top of a view, derived table with conditional SUM over two 30-day windows; queried like a table',
    `SELECT member_code, full_name, plan_name, visits_prev_30, visits_last_30, days_since_last_visit
FROM v_churn_risk
ORDER BY visits_last_30 / visits_prev_30
LIMIT 8;`);

await sqlQuery('Monthly revenue (view `v_monthly_revenue`)',
    'Admin dashboard chart.',
    'view with GROUP BY on DATE_FORMAT and conditional SUM(CASE …)',
    `SELECT * FROM v_monthly_revenue ORDER BY month DESC LIMIT 6;`);

await sqlQuery('Stored function `fn_member_status` used inside a query',
    'A stored function can be used anywhere an expression is allowed; here it groups every member by current membership status (active / frozen / expired / none). This query is a demonstration in this document: the application pages use the related function `fn_active_membership_id`, which `sp_book_class`, `sp_cancel_class_booking` and `sp_book_pt_session` call to find the membership valid on a given day.',
    'user-defined function in SELECT and in GROUP BY',
    `SELECT fn_member_status(member_id) AS status, COUNT(*) AS members
FROM members
GROUP BY status
ORDER BY members DESC;`);

n++;
h(`### Q${n}. Stored procedure \`sp_book_class\` (transaction + row lock)`);
h('**Shows:** START TRANSACTION / COMMIT, `SELECT … FOR UPDATE` row lock so two members cannot take the last seat at the same time, business rules raised with `SIGNAL SQLSTATE \'45000\'`, EXIT HANDLER that rolls back, OUT parameters. Called from the member Classes page with `CALL sp_book_class(?, ?, @id, @status)`.');
h(fence('sql', extract(routines, /CREATE PROCEDURE sp_book_class/, 'END$$')));

n++;
h(`### Q${n}. Trigger \`trg_attendance_bi\` (validation in the database)`);
h('**Shows:** BEFORE INSERT trigger that refuses a check-in when the membership is frozen, missing/expired, or the member is already inside — even if a bug in the app tried to insert the row.');
h(fence('sql', extract(triggers, /CREATE TRIGGER trg_attendance_bi/, 'END$$')));

n++;
h(`### Q${n}. Trigger \`trg_payments_au\` + \`trg_payments_bd\` (audit + no deletes)`);
h('**Shows:** AFTER UPDATE trigger writing a JSON before/after image into `audit_log`, and a BEFORE DELETE trigger that blocks deleting payments.');
h(fence('sql', extract(triggers, /CREATE TRIGGER trg_payments_au/, 'END$$') + '\n\n' + extract(triggers, /CREATE TRIGGER trg_payments_bd/, 'END$$')));

n++;
h(`### Q${n}. Scheduled event \`ev_class_housekeeping\``);
h('**Shows:** MySQL Event Scheduler running a procedure every 15 minutes: finished classes → completed, unattended bookings → no_show, forgotten check-outs closed after 4 h, stale PT requests cancelled.');
h(fence('sql', extract(events, /CREATE PROCEDURE sp_close_finished_classes/, 'END$$') + '\n\n' + extract(events, /CREATE EVENT ev_class_housekeeping/, ';')));

await sqlQuery('Index use: EXPLAIN of a member\'s visit history',
    'The composite index on attendance(member_id, check_in) lets MySQL read one member\'s visits without scanning all ' +
    'attendance rows.',
    'EXPLAIN, composite index',
    `EXPLAIN SELECT check_in, check_out
FROM attendance
WHERE member_id = ? AND check_in >= CURRENT_DATE - INTERVAL 30 DAY;`, [busy.member_id],
    ['table', 'type', 'possible_keys', 'key', 'key_len', 'rows', 'Extra']);

// ---------------------------------------------------------------- integrity demos
h('## 2. Integrity enforced by the database');
h('Each statement below was sent **as the application account `gym_app`** inside a transaction that was then rolled back. The database itself refuses the bad data — the error text is the real MySQL response.');
const bad = [
    ['CHECK constraint `chk_payments_target`: a payment must be for exactly one thing',
        `INSERT INTO payments (member_id, membership_id, pt_session_id, amount, method, transaction_ref)
VALUES (1, NULL, NULL, 500, 'cash', 'DEMO-1');`],
    ['CHECK constraint `chk_users_phone`: Indian mobile format',
        `INSERT INTO users (email, password_hash, role, full_name, phone)
VALUES ('x@demo.test', REPEAT('x', 60), 'member', 'Test User', '12345');`],
    ['UNIQUE `uq_users_email`: e-mail already registered',
        `INSERT INTO users (email, password_hash, role, full_name)
SELECT email, REPEAT('x', 60), 'member', 'Copy' FROM users LIMIT 1;`],
    ['Trigger `trg_members_bu`: member must be at least 14',
        `UPDATE members SET date_of_birth = CURRENT_DATE - INTERVAL 10 YEAR WHERE member_id = 1;`],
    ['Trigger `trg_payments_bd`: payments can never be deleted',
        `DELETE FROM payments WHERE payment_id = 1;`],
    ['Trigger `trg_payments_bu`: amount of a recorded payment cannot be changed',
        `UPDATE payments SET amount = 1 WHERE payment_id = 1;`],
    ['Foreign key: booking for a class that does not exist',
        `INSERT INTO class_bookings (class_session_id, member_id, status) VALUES (999999, 1, 'booked');`],
    ['Stored procedure business rule: check-in with an unknown member code',
        `CALL sp_check_in('GM999999', @a, @b);`],
    ['Least privilege: the app account cannot drop tables',
        `DROP TABLE payments;`],
];
md.push('| # | Rule | Statement | MySQL response |', '|---|---|---|---|');
let k = 0;
for (const [rule, stmt] of bad) {
    k++;
    let res;
    await conn.beginTransaction();
    try {
        await conn.query(stmt);
        res = '⚠ accepted (unexpected)';
    } catch (e) {
        res = `ERROR ${e.errno} (${e.sqlState}): ${e.sqlMessage}`;
    }
    await conn.rollback();
    md.push(`| ${k} | ${rule} | \`${stmt.replace(/\s+/g, ' ').replace(/\|/g, '\\|')}\` | ${res.replace(/\|/g, '\\|')} |`);
}
md.push('');

// ================================================================ MongoDB
h('## 3. MongoDB queries (`gym_mongo`)');
h(`_Member used for the per-member examples: memberId ${logMember} (the member with the most workout logs)._`);

const weekAgo8 = new Date(Date.now() - 56 * 864e5);
await mongoQuery('Weekly training volume (aggregation pipeline)',
    'Member → Workouts page chart (`src/app/member/workouts/page.js`). Two `$unwind`s flatten exercises and sets; `$dateTrunc` groups by Monday-start week in Indian time.',
    '$match, $unwind, $group with $dateTrunc, $sum of $multiply, $addToSet, $avg, $project, $size, $sort',
    'workout_logs',
    `aggregate([
  { $match: { memberId: ${logMember}, performedAt: { $gte: <8 weeks ago> } } },
  { $unwind: { path: '$exercises', preserveNullAndEmptyArrays: true } },
  { $unwind: { path: '$exercises.sets', preserveNullAndEmptyArrays: true } },
  { $group: {
      _id: { $dateTrunc: { date: '$performedAt', unit: 'week', startOfWeek: 'monday', timezone: 'Asia/Kolkata' } },
      volume:   { $sum: { $multiply: [{ $ifNull: ['$exercises.sets.reps', 0] }, { $ifNull: ['$exercises.sets.weightKg', 0] }] } },
      workouts: { $addToSet: '$_id' },
      avgRpe:   { $avg: '$rpe' } } },
  { $project: { volume: 1, workouts: { $size: '$workouts' }, avgRpe: { $round: ['$avgRpe', 1] } } },
  { $sort: { _id: 1 } }
])`,
    (c) => c.aggregate([
        { $match: { memberId: logMember, performedAt: { $gte: weekAgo8 } } },
        { $unwind: { path: '$exercises', preserveNullAndEmptyArrays: true } },
        { $unwind: { path: '$exercises.sets', preserveNullAndEmptyArrays: true } },
        { $group: {
            _id: { $dateTrunc: { date: '$performedAt', unit: 'week', startOfWeek: 'monday', timezone: 'Asia/Kolkata' } },
            volume: { $sum: { $multiply: [{ $ifNull: ['$exercises.sets.reps', 0] }, { $ifNull: ['$exercises.sets.weightKg', 0] }] } },
            workouts: { $addToSet: '$_id' }, avgRpe: { $avg: '$rpe' } } },
        { $project: { week: { $dateToString: { date: '$_id', format: '%Y-%m-%d' } }, volume: 1, workouts: { $size: '$workouts' }, avgRpe: { $round: ['$avgRpe', 1] }, _id: 0 } },
        { $sort: { week: 1 } },
    ]).toArray());

await mongoQuery('Personal records (heaviest set per exercise)',
    'Workouts page "Personal records" card. Sorting before `$group` lets `$first` pick the heaviest set and the date it happened.',
    '$unwind, $match on nested field, $sort, $group with $first, $limit',
    'workout_logs',
    `aggregate([
  { $match: { memberId: ${logMember} } },
  { $unwind: '$exercises' },
  { $unwind: '$exercises.sets' },
  { $match: { 'exercises.sets.weightKg': { $gt: 0 } } },
  { $sort: { 'exercises.sets.weightKg': -1, performedAt: 1 } },
  { $group: { _id: '$exercises.name', bestKg: { $first: '$exercises.sets.weightKg' },
              reps: { $first: '$exercises.sets.reps' }, on: { $first: '$performedAt' } } },
  { $sort: { bestKg: -1 } },
  { $limit: 8 }
])`,
    (c) => c.aggregate([
        { $match: { memberId: logMember } }, { $unwind: '$exercises' }, { $unwind: '$exercises.sets' },
        { $match: { 'exercises.sets.weightKg': { $gt: 0 } } },
        { $sort: { 'exercises.sets.weightKg': -1, performedAt: 1 } },
        { $group: { _id: '$exercises.name', bestKg: { $first: '$exercises.sets.weightKg' }, reps: { $first: '$exercises.sets.reps' }, on: { $first: '$performedAt' } } },
        { $sort: { bestKg: -1 } }, { $limit: 8 },
        { $project: { exercise: '$_id', bestKg: 1, reps: 1, on: 1, _id: 0 } },
    ]).toArray());

await mongoQuery('Weighted full-text search over exercises: "shoulder press"',
    'Member → Exercises page. The text index weights name 10, primaryMuscle 6, tags 4, instructions 1; private exercises of other members are hidden.',
    '$text search, textScore projection and sort, $in with null for shared-or-mine visibility',
    'exercises',
    `find(
  { createdBy: { $in: [null, ${logMember}] }, $text: { $search: 'shoulder press' } },
  { projection: { name: 1, primaryMuscle: 1, level: 1, score: { $meta: 'textScore' } },
    sort: { score: { $meta: 'textScore' } } }
).limit(6)`,
    (c) => c.find({ createdBy: { $in: [null, logMember] }, $text: { $search: 'shoulder press' } },
        { projection: { _id: 0, name: 1, primaryMuscle: 1, level: 1, score: { $meta: 'textScore' } }, sort: { score: { $meta: 'textScore' } } })
        .limit(6).toArray().then((r) => r.map((x) => ({ ...x, score: Math.round(x.score * 100) / 100 }))));

await mongoQuery('Most logged exercises across all members (last 30 days)',
    'Exercises page "Popular right now".',
    '$unwind, $group with $sum and $addToSet, $size, $sort, $limit',
    'workout_logs',
    `aggregate([
  { $match: { performedAt: { $gte: <30 days ago> } } },
  { $unwind: '$exercises' },
  { $group: { _id: '$exercises.name', times: { $sum: 1 }, members: { $addToSet: '$memberId' } } },
  { $project: { times: 1, members: { $size: '$members' } } },
  { $sort: { times: -1 } },
  { $limit: 6 }
])`,
    (c) => c.aggregate([
        { $match: { performedAt: { $gte: new Date(Date.now() - 30 * 864e5) } } },
        { $unwind: '$exercises' },
        { $group: { _id: '$exercises.name', times: { $sum: 1 }, members: { $addToSet: '$memberId' } } },
        { $project: { exercise: '$_id', times: 1, members: { $size: '$members' }, _id: 0 } },
        { $sort: { times: -1 } }, { $limit: 6 },
    ]).toArray());

await mongoQuery('Body-weight trend from the time-series collection',
    'Workouts page weight chart: one average per week, read from the `body_metrics` time-series collection.',
    'time-series collection, $group by $dateTrunc, $avg, $min/$max',
    'body_metrics',
    `aggregate([
  { $match: { memberId: ${logMember} } },
  { $group: { _id: { $dateTrunc: { date: '$recordedAt', unit: 'week' } },
              avgKg: { $avg: '$weightKg' }, minKg: { $min: '$weightKg' }, maxKg: { $max: '$weightKg' } } },
  { $sort: { _id: -1 } },
  { $limit: 6 }
])`,
    (c) => c.aggregate([
        { $match: { memberId: logMember } },
        { $group: { _id: { $dateTrunc: { date: '$recordedAt', unit: 'week' } }, avgKg: { $avg: '$weightKg' }, minKg: { $min: '$weightKg' }, maxKg: { $max: '$weightKg' } } },
        { $sort: { _id: -1 } }, { $limit: 6 },
        { $project: { week: { $dateToString: { date: '$_id', format: '%Y-%m-%d' } }, avgKg: { $round: ['$avgKg', 1] }, minKg: 1, maxKg: 1, _id: 0 } },
    ]).toArray());

// Mongo validator demo
{
    let res;
    try {
        await mdb.collection('workout_logs').insertOne({ memberId: logMember, performedAt: new Date(), durationMin: 2, rpe: 15, exercises: [] });
        res = '⚠ accepted (unexpected)';
    } catch (e) {
        res = `${e.code === 121 ? 'Document failed validation (code 121)' : e.message}`;
    }
    n++;
    h(`### Q${n}. Schema validation in MongoDB`);
    h('**Shows:** the `$jsonSchema` validator rejects a workout of 2 minutes with RPE 15 (allowed: 5–300 min, RPE 1–10).');
    h(fence('js', `db.workout_logs.insertOne({ memberId: ${logMember}, performedAt: new Date(), durationMin: 2, rpe: 15, exercises: [] })`));
    h(`**Output:** \`${res}\``);
}

h('## 4. Where each requirement is shown');
h(`| Requirement (course PDF) | Query |
|---|---|
| JOIN, GROUP BY, ORDER BY, aggregates | Q1, Q2, Q3 |
| HAVING | Q2 |
| Subqueries (FROM, NOT EXISTS, scalar) | Q2, Q3, Q4, Q6 |
| Views | Q6, Q7, Q8 |
| Functions / procedures | Q9, Q10 |
| Transactions + locking | Q10 |
| Triggers | Q11, Q12, section 2 |
| Events | Q13 |
| Indexing | Q5 (FULLTEXT), Q14 (EXPLAIN), Q17 (text index) |
| Full-text search | Q5, Q17 |
| NoSQL aggregation | Q15, Q16, Q18, Q19 |
| Validation at database level | section 2, Q20 |`);

fs.writeFileSync('docs/important-queries.md', md.join('\n'));
await conn.end();
await mc.close();
console.log('wrote docs/important-queries.md with', n, 'queries');

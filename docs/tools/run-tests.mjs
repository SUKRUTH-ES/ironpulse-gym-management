// Automated database test suite for IronPulse.
//
// It builds a SEPARATE copy of the database (MySQL `gym_test`, MongoDB `gym_test_mongo`)
// from the same db/ scripts and demo seed, runs every test as the real app account
// (gym_app, least privilege), writes docs/test-results.json and finally drops the
// test databases again. The real gym_db / gym_mongo are never touched.
//
// Run from the project root:  node docs/tools/run-tests.mjs
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import { seedMysql } from '../../scripts/seed-data.mjs';
import { createMongoCollections } from '../../db/mongo/collections.mjs';
import { exercises } from '../../db/mongo/exercises.mjs';

process.loadEnvFile('.env.local');
const TEST_DB = 'gym_test';
const TEST_MONGO = 'gym_test_mongo';
const env = process.env;

// ---------------------------------------------------------------- build the test database
function splitSql(text) {   // same rules as scripts/db-setup.mjs
    const out = [];
    let delimiter = ';', buffer = '';
    for (const line of text.split(/\r?\n/)) {
        const change = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
        if (change) { delimiter = change[1]; continue; }
        buffer += line + '\n';
        if (/^\s*--/.test(line)) continue;
        const trimmed = buffer.trimEnd();
        if (trimmed.endsWith(delimiter)) {
            const st = trimmed.slice(0, -delimiter.length).trim();
            if (st.split('\n').some((l) => l.trim() && !l.trim().startsWith('--'))) out.push(st);
            buffer = '';
        }
    }
    return out;
}

const admin = await mysql.createConnection({
    host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT), user: env.MYSQL_ADMIN_USER, password: env.MYSQL_ADMIN_PASSWORD,
    dateStrings: true,
});
console.log(`building ${TEST_DB} …`);
for (const f of ['01_schema.sql', '02_views.sql', '03_routines.sql', '04_triggers.sql', '05_events.sql']) {
    const text = fs.readFileSync(path.join('db/mysql', f), 'utf8').replace(/\bgym_db\b/g, TEST_DB);
    for (const st of splitSql(text)) await admin.query(st);
}
await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON \`${TEST_DB}\`.* TO ?@'localhost'`, [env.MYSQL_USER]);
await admin.query(`USE ${TEST_DB}`);
await seedMysql(admin);
console.log('seeded');

const mc = new MongoClient(env.MONGODB_URI);
await mc.connect();
const mdb = mc.db(TEST_MONGO);
await mdb.dropDatabase();
await createMongoCollections(mdb);
await mdb.collection('exercises').insertMany(exercises.map((e) => ({ ...e })));

// the app account, exactly like the web app connects
const app = await mysql.createConnection({
    host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT), user: env.MYSQL_USER, password: env.MYSQL_PASSWORD,
    database: TEST_DB, dateStrings: true,
});
const q = async (s, p = []) => (await app.query(s, p))[0];
const one = async (s, p = []) => (await q(s, p))[0];
async function call(proc, args, outs = []) {
    const marks = args.map(() => '?').concat(outs.map((o) => `@${o}`)).join(', ');
    await app.query(`CALL ${proc}(${marks})`, args);
    if (!outs.length) return {};
    return one(`SELECT ${outs.map((o) => `@${o} AS ${o}`).join(', ')}`);
}
const err = (e) => `ERROR ${e.errno ?? e.code} ${e.sqlMessage ?? e.errmsg ?? e.message}`;

// ---------------------------------------------------------------- test harness
const results = [];
let area = '';
async function test(id, title, input, expected, fn) {
    let actual, pass;
    try {
        [pass, actual] = await fn();
    } catch (e) {
        pass = false;
        actual = 'Unexpected ' + err(e);
    }
    results.push({ id, area, title, input, expected, actual, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${title} → ${actual}`);
}
// passes when the statement fails with a message matching `re`
async function rejects(fn, re) {
    try {
        await fn();
        return [false, 'Accepted (no error)'];
    } catch (e) {
        const m = err(e);
        return [re.test(m), m];
    }
}

// ---------------------------------------------------------------- fixtures from the seeded data
const plans = await q('SELECT * FROM membership_plans WHERE is_active AND duration_days >= 28 ORDER BY duration_days, price');
const unlimited = plans.find((p) => p.classes_per_week === null);
const limited = plans.find((p) => p.classes_per_week !== null);
const freezable = plans.find((p) => p.max_freeze_days >= 5);
const room = await one('SELECT * FROM rooms ORDER BY capacity LIMIT 1');
const ctype = await one('SELECT * FROM class_types ORDER BY duration_min LIMIT 1');
const trainer = await one('SELECT t.* FROM trainers t JOIN users u USING (user_id) WHERE t.accepts_pt AND u.is_active ORDER BY trainer_id LIMIT 1');
const otherTrainer = await one('SELECT * FROM trainers WHERE trainer_id <> ? ORDER BY trainer_id LIMIT 1', [trainer.trainer_id]);
const adminUser = await one("SELECT user_id FROM users WHERE role = 'admin' LIMIT 1");
const HASH = '$2b$10$' + 'x'.repeat(53);
let phoneN = 0;
const phone = () => `9${String(800000000 + ++phoneN).padStart(9, '0')}`;
const dob = (years) => new Date(Date.now() - years * 365.25 * 864e5).toISOString().slice(0, 10);
async function newMember(tag, years = 25) {
    return call('sp_register_member', [`Test.${tag}@Example.test `, HASH, `Test ${tag}`, phone(), dob(years), 'female', 'general_fitness'],
        ['mid', 'code']);
}
const day6 = (await one('SELECT DATE(NOW() + INTERVAL 6 DAY) d')).d;
async function newClass(hour, capacity = 1, trainerId = otherTrainer.trainer_id, roomId = room.room_id) {
    const r = await q('INSERT INTO class_sessions (class_type_id, trainer_id, room_id, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?, NULL, ?)',
        [ctype.class_type_id, trainerId, roomId, `${day6} ${String(hour).padStart(2, '0')}:00:00`, capacity]);
    return r.insertId;
}

// ================================================================ 1. registration & users
area = 'Registration and accounts';
let M1;
await test('T01', 'Register a new member (procedure)', "CALL sp_register_member('Test.A@Example.test ', hash, 'Test A', phone, 25 y, …)",
    'member_id returned, code GM + 6 digits, e-mail stored lower-case and trimmed', async () => {
        M1 = await newMember('A');
        const u = await one('SELECT u.email FROM users u JOIN members m USING (user_id) WHERE m.member_id = ?', [M1.mid]);
        return [/^GM\d{6}$/.test(M1.code) && u.email === 'test.a@example.test', `member_id ${M1.mid}, code ${M1.code}, e-mail "${u.email}"`];
    });
await test('T02', 'Reject member younger than 14', 'sp_register_member with date of birth 10 years ago',
    'Error from trg_members_bi; user row rolled back', async () => {
        const before = (await one('SELECT COUNT(*) n FROM users')).n;
        const [p, m] = await rejects(() => newMember('Kid', 10), /at least 14|14 and 100/);
        const after = (await one('SELECT COUNT(*) n FROM users')).n;
        return [p && before === after, `${m}; users before/after: ${before}/${after}`];
    });
await test('T03', 'Reject duplicate e-mail', 'Register again with TEST.A@example.test',
    'Duplicate entry error (UNIQUE uq_users_email)', () => rejects(() =>
        call('sp_register_member', ['TEST.A@example.test', HASH, 'Copy', phone(), dob(30), 'male', 'endurance'], ['x', 'y']), /Duplicate entry/));
await test('T04', 'Reject invalid phone number', "INSERT INTO users … phone '12345'",
    'CHECK constraint chk_users_phone violated', () => rejects(() =>
        q("INSERT INTO users (email, password_hash, role, full_name, phone) VALUES ('p@x.test', ?, 'member', 'P Q', '12345')", [HASH]), /chk_users_phone/));
await test('T05', 'Reject invalid e-mail', "INSERT INTO users … email 'not-an-email'",
    'CHECK constraint chk_users_email violated', () => rejects(() =>
        q("INSERT INTO users (email, password_hash, role, full_name) VALUES ('not-an-email', ?, 'member', 'P Q')", [HASH]), /chk_users_email/));
await test('T06', 'Passwords are stored only as bcrypt hashes', 'SELECT password_hash FROM users',
    "Every hash is 60 chars and starts with $2", async () => {
        const r = await one("SELECT COUNT(*) n, SUM(password_hash LIKE '$2%' AND CHAR_LENGTH(password_hash) = 60) ok FROM users");
        return [Number(r.ok) === r.n, `${r.ok} of ${r.n} rows are bcrypt hashes`];
    });

// ================================================================ 2. memberships
area = 'Memberships and payments';
let MS1;
await test('T07', 'Buy a membership', `CALL sp_purchase_membership(M1, '${unlimited.name}', 'upi', admin)`,
    'Membership starts today, end date filled by trigger from plan duration, completed payment for the plan price', async () => {
        const r = await call('sp_purchase_membership', [M1.mid, unlimited.plan_id, 'upi', adminUser.user_id], ['ms', 'pay']);
        MS1 = r.ms;
        const m = await one('SELECT start_date, end_date, status, DATEDIFF(end_date, start_date) + 1 days, CURRENT_DATE today FROM memberships WHERE membership_id = ?', [r.ms]);
        const p = await one('SELECT amount, status FROM payments WHERE payment_id = ?', [r.pay]);
        return [m.start_date === m.today && m.days === unlimited.duration_days && Number(p.amount) === Number(unlimited.price) && p.status === 'completed',
            `${m.start_date} → ${m.end_date} (${m.days} days, ${m.status}); payment ₹${p.amount} ${p.status}`];
    });
await test('T08', 'Renewal is queued after the current plan', 'Buy the same plan again for M1',
    'New membership starts the day after the current one ends (no overlap)', async () => {
        const r = await call('sp_purchase_membership', [M1.mid, unlimited.plan_id, 'cash', adminUser.user_id], ['ms', 'pay']);
        const x = await one(`SELECT a.end_date old_end, b.start_date new_start, DATEDIFF(b.start_date, a.end_date) gap
                             FROM memberships a, memberships b WHERE a.membership_id = ? AND b.membership_id = ?`, [MS1, r.ms]);
        return [x.gap === 1, `current ends ${x.old_end}, renewal starts ${x.new_start}`];
    });
await test('T09', 'Overlapping membership is blocked', 'INSERT a second membership for M1 covering today',
    'Error from trg_memberships_bi', () => rejects(() =>
        q('INSERT INTO memberships (member_id, plan_id, start_date, end_date) VALUES (?, ?, CURRENT_DATE, NULL)', [M1.mid, unlimited.plan_id]), /overlap|covering/i));
await test('T10', 'Inactive plan cannot be bought', 'sp_purchase_membership with a switched-off plan',
    "Error 'This plan is no longer offered'", async () => {
        const off = await one('SELECT plan_id FROM membership_plans WHERE NOT is_active LIMIT 1');
        if (!off) return [false, 'no inactive plan in seed'];
        return rejects(() => call('sp_purchase_membership', [M1.mid, off.plan_id, 'cash', null], ['a', 'b']), /no longer offered/);
    });

let M4, MS4;
await test('T11', 'Freeze a membership', `Member M4 buys '${freezable.name}', then sp_freeze_membership`,
    'Status frozen, frozen_from = today', async () => {
        M4 = await newMember('Freeze');
        MS4 = (await call('sp_purchase_membership', [M4.mid, freezable.plan_id, 'card', adminUser.user_id], ['ms', 'pay'])).ms;
        await call('sp_freeze_membership', [MS4, M4.mid]);
        const m = await one('SELECT status, frozen_from, CURRENT_DATE today FROM memberships WHERE membership_id = ?', [MS4]);
        return [m.status === 'frozen' && m.frozen_from === m.today, `status ${m.status}, frozen_from ${m.frozen_from}`];
    });
await test('T12', 'Frozen member cannot check in', `CALL sp_check_in('${'<M4 code>'}')`,
    "Error from trg_attendance_bi: 'Membership is frozen…'", () => rejects(() => call('sp_check_in', [M4.code], ['a', 'n']), /frozen/i));
await test('T13', 'Unfreeze adds the frozen days to the end date', 'Set frozen_from 5 days back, then sp_unfreeze_membership',
    'days_added = 5, end date +5, freeze_days_used = 5, status active', async () => {
        const before = await one('SELECT end_date FROM memberships WHERE membership_id = ?', [MS4]);
        await q('UPDATE memberships SET frozen_from = CURRENT_DATE - INTERVAL 5 DAY WHERE membership_id = ?', [MS4]);
        const r = await call('sp_unfreeze_membership', [MS4, M4.mid], ['days']);
        const m = await one('SELECT status, end_date, freeze_days_used, DATEDIFF(end_date, ?) moved FROM memberships WHERE membership_id = ?', [before.end_date, MS4]);
        return [r.days === 5 && m.moved === 5 && m.freeze_days_used === 5 && m.status === 'active',
            `days_added ${r.days}; end ${before.end_date} → ${m.end_date}; used ${m.freeze_days_used}; ${m.status}`];
    });
await test('T14', 'Frozen flag and frozen_from must match', "UPDATE memberships SET status = 'frozen' (frozen_from stays NULL)",
    'CHECK constraint chk_memberships_frozen violated', () => rejects(() =>
        q("UPDATE memberships SET status = 'frozen' WHERE membership_id = ?", [MS4]), /chk_memberships_frozen/));

// payments
let PAY;
await test('T15', 'Payment must be for exactly one thing', 'INSERT payment with membership_id and pt_session_id both NULL',
    'CHECK constraint chk_payments_target violated', () => rejects(() =>
        q("INSERT INTO payments (member_id, amount, method, transaction_ref) VALUES (?, 100, 'cash', 'T-1')", [M1.mid]), /chk_payments_target/));
await test('T16', 'Payment amount must be positive', 'INSERT payment with amount 0',
    'CHECK constraint chk_payments_amount violated', () => rejects(() =>
        q("INSERT INTO payments (member_id, membership_id, amount, method, transaction_ref) VALUES (?, ?, 0, 'cash', 'T-2')", [M1.mid, MS1]), /chk_payments_amount/));
await test('T17', 'Payments cannot be deleted', 'DELETE FROM payments WHERE payment_id = <M1 payment>',
    "Error from trg_payments_bd 'Payments cannot be deleted; refund them instead'", async () => {
        PAY = (await one('SELECT payment_id FROM payments WHERE membership_id = ?', [MS1])).payment_id;
        return rejects(() => q('DELETE FROM payments WHERE payment_id = ?', [PAY]), /cannot be deleted/);
    });
await test('T18', 'Payment details cannot be edited', 'UPDATE payments SET amount = 1',
    'Error from trg_payments_bu', () => rejects(() => q('UPDATE payments SET amount = 1 WHERE payment_id = ?', [PAY]), /cannot be edited/));
await test('T19', 'Refund is recorded in the audit log', "UPDATE payments SET status = 'refunded'",
    'Status refunded; trg_payments_au writes old/new JSON to audit_log', async () => {
        await q("UPDATE payments SET status = 'refunded' WHERE payment_id = ?", [PAY]);
        const a = await one("SELECT old_value, new_value, changed_by FROM audit_log WHERE table_name = 'payments' AND record_id = ? AND action = 'UPDATE' ORDER BY audit_id DESC LIMIT 1", [PAY]);
        const ok = a && JSON.stringify(a.old_value).includes('completed') && JSON.stringify(a.new_value).includes('refunded');
        return [!!ok, a ? `audit_log: ${JSON.stringify(a.old_value)} → ${JSON.stringify(a.new_value)} by ${a.changed_by}` : 'no audit row'];
    });
await test('T20', 'A refund cannot be undone', "UPDATE payments SET status = 'completed' on the refunded payment",
    'Error from trg_payments_bu', () => rejects(() => q("UPDATE payments SET status = 'completed' WHERE payment_id = ?", [PAY]), /refund/i));

// ================================================================ 3. front desk
area = 'Front desk (attendance)';
await test('T21', 'Check in an active member', 'CALL sp_check_in(<M1 code>)',
    'attendance row created, member name returned', async () => {
        const r = await call('sp_check_in', [M1.code.toLowerCase() + ' '], ['att', 'name']);
        return [!!r.att && r.name === 'Test A', `attendance_id ${r.att}, name "${r.name}" (code typed lower-case with a space)`];
    });
await test('T22', 'Double check-in is refused', 'CALL sp_check_in(<M1 code>) again',
    "Error 'Member is already checked in'", () => rejects(() => call('sp_check_in', [M1.code], ['a', 'n']), /already checked in/));
await test('T23', 'Check out', 'CALL sp_check_out(<M1 code>)', 'Visit closed, minutes returned, check_out > check_in', async () => {
    const r = await call('sp_check_out', [M1.code], ['mins']);
    const a = await one('SELECT check_in, check_out FROM attendance WHERE member_id = ? ORDER BY attendance_id DESC LIMIT 1', [M1.mid]);
    return [a.check_out > a.check_in, `${r.mins} min, ${a.check_in} → ${a.check_out}`];
});
let M5;
await test('T24', 'Member without a plan cannot check in', 'Register M5 (no purchase), sp_check_in',
    "Error 'Member has no active membership for today'", async () => {
        M5 = await newMember('NoPlan');
        return rejects(() => call('sp_check_in', [M5.code], ['a', 'n']), /no active membership/i);
    });
await test('T25', 'Unknown member code', "CALL sp_check_in('GM999999')", "Error 'No active member with that code'",
    () => rejects(() => call('sp_check_in', ['GM999999'], ['a', 'n']), /No active member/));
await test('T26', 'Check-out before check-in is impossible', 'UPDATE attendance SET check_out = check_in - 1 hour',
    'CHECK constraint chk_attendance_times violated', () => rejects(() =>
        q('UPDATE attendance SET check_out = check_in - INTERVAL 1 HOUR WHERE member_id = ?', [M1.mid]), /chk_attendance_times/));

// ================================================================ 4. classes and bookings
area = 'Group classes and waitlist';
let C1;
await test('T27', 'Create a class; end time filled by trigger', `INSERT class_sessions (type '${ctype.name}', ends_at NULL, capacity 1) on ${day6} 01:00`,
    `ends_at = starts_at + ${ctype.duration_min} min`, async () => {
        C1 = await newClass(1);
        const c = await one('SELECT starts_at, ends_at, TIMESTAMPDIFF(MINUTE, starts_at, ends_at) mins FROM class_sessions WHERE class_session_id = ?', [C1]);
        return [c.mins === ctype.duration_min, `${c.starts_at} → ${c.ends_at} (${c.mins} min)`];
    });
await test('T28', 'Capacity cannot exceed the room', `INSERT class with capacity ${room.capacity + 1} in '${room.name}' (capacity ${room.capacity})`,
    'Error from trg_class_sessions_bi', () => rejects(() => newClass(5, room.capacity + 1), /room/i));
await test('T29', 'Room double-booking is blocked', `INSERT another class in '${room.name}' at the same time with another trainer`,
    'Error from trg_class_sessions_bi (room clash)', () => rejects(() => newClass(1, 1, trainer.trainer_id), /room/i));
await test('T30', 'Trainer double-booking is blocked', 'INSERT a class for the same trainer at the same time in another room',
    'Error from sp_assert_trainer_free (called by the trigger)', async () => {
        const r2 = await one('SELECT room_id FROM rooms WHERE room_id <> ? ORDER BY room_id LIMIT 1', [room.room_id]);
        return rejects(() => newClass(1, 1, otherTrainer.trainer_id, r2.room_id), /trainer/i);
    });
let M2, B1, B2;
await test('T31', 'First booking takes the seat', 'M1 books class C1 (capacity 1)', "status 'booked'", async () => {
    const r = await call('sp_book_class', [M1.mid, C1], ['bid', 'st']);
    B1 = r.bid;
    return [r.st === 'booked', `booking ${r.bid}: ${r.st}`];
});
await test('T32', 'Full class puts the next member on the waitlist', `M2 buys '${unlimited.name}' and books C1`, "status 'waitlisted'", async () => {
    M2 = await newMember('B');
    await call('sp_purchase_membership', [M2.mid, unlimited.plan_id, 'upi', null], ['a', 'b']);
    const r = await call('sp_book_class', [M2.mid, C1], ['bid', 'st']);
    B2 = r.bid;
    return [r.st === 'waitlisted', `booking ${r.bid}: ${r.st}`];
});
await test('T33', 'Same class cannot be booked twice', 'M1 books C1 again', "Error 'You have already booked this class'",
    () => rejects(() => call('sp_book_class', [M1.mid, C1], ['a', 'b']), /already booked/));
await test('T34', 'Cancelling promotes the first waitlisted member', 'M1 cancels with sp_cancel_class_booking',
    'M1 cancelled, M2 promoted to booked', async () => {
        const r = await call('sp_cancel_class_booking', [B1, M1.mid], ['promoted']);
        const s = await q('SELECT booking_id, status FROM class_bookings WHERE class_session_id = ? ORDER BY booking_id', [C1]);
        return [r.promoted === M2.mid && s.find((x) => x.booking_id === B2).status === 'booked',
            `promoted member ${r.promoted} (M2 = ${M2.mid}); statuses ${s.map((x) => x.status).join(', ')}`];
    });
await test('T35', 'No booking without a membership', 'M5 (no plan) books a class', "Error 'You need an active membership…'",
    async () => { const c = await newClass(3, 5); return rejects(() => call('sp_book_class', [M5.mid, c], ['a', 'b']), /active membership/); });
await test('T36', 'Weekly class limit of the plan', `New member M3 on '${limited.name}' (${limited.classes_per_week} classes/week) books ${limited.classes_per_week + 1} classes in one week`,
    `First ${limited.classes_per_week} booked, next one refused`, async () => {
        const M3 = await newMember('Limit');
        await call('sp_purchase_membership', [M3.mid, limited.plan_id, 'cash', null], ['a', 'b']);
        const got = [];
        for (let i = 0; i < limited.classes_per_week; i++) {
            const c = await newClass(8 + i, 5);
            got.push((await call('sp_book_class', [M3.mid, c], ['a', 'st'])).st);
        }
        const c = await newClass(8 + limited.classes_per_week, 5);
        const [p, m] = await rejects(() => call('sp_book_class', [M3.mid, c], ['a', 'b']), /Weekly class limit/);
        return [p && got.every((s) => s === 'booked'), `${got.join(', ')}; then ${m}`];
    });
await test('T37', 'Cancelling a class cancels its bookings', "UPDATE class_sessions SET status = 'cancelled' for C1",
    'trg_class_sessions_au sets every booking of C1 to cancelled', async () => {
        await q("UPDATE class_sessions SET status = 'cancelled' WHERE class_session_id = ?", [C1]);
        const r = await one("SELECT SUM(status <> 'cancelled') open FROM class_bookings WHERE class_session_id = ?", [C1]);
        return [Number(r.open) === 0, `bookings still open: ${r.open}`];
    });

// ================================================================ 5. personal training
area = 'Personal training';
const slot = await one(`SELECT CONCAT(DATE(NOW() + INTERVAL 2 DAY), ' ', LPAD(h, 2, '0'), ':00:00') s FROM (
    SELECT 10 h UNION SELECT 11 UNION SELECT 12 UNION SELECT 13 UNION SELECT 14 UNION SELECT 15 UNION SELECT 16) hours
    WHERE NOT EXISTS (SELECT 1 FROM class_sessions c WHERE c.trainer_id = ? AND c.status <> 'cancelled'
        AND c.starts_at < CONCAT(DATE(NOW() + INTERVAL 2 DAY), ' ', LPAD(h, 2, '0'), ':00:00') + INTERVAL 60 MINUTE
        AND c.ends_at > CONCAT(DATE(NOW() + INTERVAL 2 DAY), ' ', LPAD(h, 2, '0'), ':00:00'))
      AND NOT EXISTS (SELECT 1 FROM pt_sessions p WHERE p.trainer_id = ? AND p.status IN ('requested','confirmed')
        AND p.starts_at < CONCAT(DATE(NOW() + INTERVAL 2 DAY), ' ', LPAD(h, 2, '0'), ':00:00') + INTERVAL 60 MINUTE
        AND p.ends_at > CONCAT(DATE(NOW() + INTERVAL 2 DAY), ' ', LPAD(h, 2, '0'), ':00:00'))
    ORDER BY h LIMIT 1`, [trainer.trainer_id, trainer.trainer_id]);
let PT1;
await test('T38', 'Request a PT session', `sp_book_pt_session(M1, trainer ${trainer.trainer_id}, ${slot.s}, 60 min)`,
    "status 'requested', price 0 if the plan includes PT else the trainer's hourly rate", async () => {
        const r = await call('sp_book_pt_session', [M1.mid, trainer.trainer_id, slot.s, 60, 'Lower back pain'], ['id', 'price']);
        PT1 = r.id;
        const p = await one('SELECT status, price FROM pt_sessions WHERE pt_session_id = ?', [r.id]);
        const expect = unlimited.pt_sessions_included > 0 ? 0 : Number(trainer.session_rate);
        return [p.status === 'requested' && Number(p.price) === expect, `pt_session ${r.id}: ${p.status}, price ₹${p.price} (plan includes ${unlimited.pt_sessions_included})`];
    });
await test('T39', 'Trainer cannot have two sessions at once', 'M2 requests the same trainer at the same time',
    'Error from trg_pt_sessions_bi', () => rejects(() => call('sp_book_pt_session', [M2.mid, trainer.trainer_id, slot.s, 60, null], ['a', 'b']), /trainer/i));
await test('T40', 'PT must be booked 2 hours ahead', 'Start time NOW() + 1 hour', "Error 'Book personal training at least 2 hours ahead'",
    async () => {
        const t = (await one('SELECT NOW() + INTERVAL 1 HOUR t')).t;
        return rejects(() => call('sp_book_pt_session', [M1.mid, trainer.trainer_id, t, 30, null], ['a', 'b']), /2 hours ahead/);
    });
await test('T41', 'PT only during opening hours', 'Start 21:30 for 60 minutes', "Error 'The gym is open from 06:00 to 22:00'",
    () => rejects(() => call('sp_book_pt_session', [M1.mid, trainer.trainer_id, `${day6} 21:30:00`, 60, null], ['a', 'b']), /06:00 to 22:00/));
await test('T42', 'Finished PT session cannot be reopened', "Set status completed, then back to 'requested'",
    'Error from trg_pt_sessions_bu; status change written to audit_log', async () => {
        await q("UPDATE pt_sessions SET status = 'confirmed' WHERE pt_session_id = ?", [PT1]);
        await q("UPDATE pt_sessions SET status = 'completed' WHERE pt_session_id = ?", [PT1]);
        const [p, m] = await rejects(() => q("UPDATE pt_sessions SET status = 'requested' WHERE pt_session_id = ?", [PT1]), /./);
        const a = await one("SELECT COUNT(*) n FROM audit_log WHERE table_name = 'pt_sessions' AND record_id = ?", [PT1]);
        return [p && a.n >= 2, `${m}; audit rows for this session: ${a.n}`];
    });

// ================================================================ 6. scheduled housekeeping
area = 'Scheduled events (procedures they call)';
await test('T43', 'Expired memberships are closed', "Move M5's new membership into the past, CALL sp_expire_memberships()",
    "status becomes 'expired'", async () => {
        const ms = (await call('sp_purchase_membership', [M5.mid, unlimited.plan_id, 'cash', null], ['ms', 'p'])).ms;
        await q('UPDATE memberships SET start_date = CURRENT_DATE - INTERVAL 60 DAY, end_date = CURRENT_DATE - INTERVAL 31 DAY WHERE membership_id = ?', [ms]);
        await call('sp_expire_memberships', []);
        const m = await one('SELECT status, end_date FROM memberships WHERE membership_id = ?', [ms]);
        return [m.status === 'expired', `end ${m.end_date} → ${m.status}`];
    });
await test('T44', 'Finished classes are completed and absentees marked no-show', 'Move a booked class into the past, CALL sp_close_finished_classes()',
    "class 'completed', booking 'no_show'", async () => {
        const c = await newClass(16, 5);
        const b = (await call('sp_book_class', [M2.mid, c], ['bid', 'st'])).bid;
        await q('UPDATE class_sessions SET starts_at = NOW() - INTERVAL 3 HOUR, ends_at = NOW() - INTERVAL 2 HOUR WHERE class_session_id = ?', [c]);
        await call('sp_close_finished_classes', []);
        const r = await one('SELECT cs.status cs, cb.status cb FROM class_sessions cs JOIN class_bookings cb USING (class_session_id) WHERE cb.booking_id = ?', [b]);
        return [r.cs === 'completed' && r.cb === 'no_show', `class ${r.cs}, booking ${r.cb}`];
    });

// ================================================================ 7. security
area = 'Security (least privilege)';
for (const [id, title, stmt, re] of [
    ['T45', 'App account cannot DROP a table', 'DROP TABLE payments', /DROP command denied/],
    ['T46', 'App account cannot ALTER a table', 'ALTER TABLE users ADD COLUMN x INT', /ALTER command denied/],
    ['T47', 'App account cannot create triggers', 'CREATE TRIGGER t BEFORE INSERT ON users FOR EACH ROW SET NEW.role = \'admin\'', /denied|SUPER privilege/],
]) {
    await test(id, title, stmt, 'Access denied for gym_app', () => rejects(() => q(stmt), re));
}

// ================================================================ 8. MongoDB
area = 'MongoDB validation and indexes';
const logs = mdb.collection('workout_logs');
await test('T48', 'Valid workout log is accepted', 'insertOne({ memberId, performedAt, durationMin: 45, rpe: 7, exercises: [ … 3 sets … ] })',
    'Document inserted', async () => {
        const ex = await mdb.collection('exercises').findOne({ category: 'strength' });
        const r = await logs.insertOne({ memberId: M1.mid, performedAt: new Date(), durationMin: 45, rpe: 7,
            exercises: [{ exerciseId: ex._id, name: ex.name, sets: [{ reps: 10, weightKg: 20 }, { reps: 10, weightKg: 22.5 }, { reps: 8, weightKg: 25 }] }] });
        return [!!r.insertedId, `inserted ${r.insertedId}`];
    });
for (const [id, title, doc, why] of [
    ['T49', 'Workout of 2 minutes with RPE 15 is rejected', { durationMin: 2, rpe: 15, exercises: [] }, 'durationMin 5–300, rpe 1–10'],
    ['T50', 'Unknown field inside a set is rejected', { durationMin: 30, rpe: 5, exercises: [{ name: 'x', sets: [{ reps: 5, hack: true }] }] }, 'additionalProperties false'],
    ['T51', 'Log without memberId is rejected', { durationMin: 30, rpe: 5, exercises: [] }, 'memberId required'],
]) {
    await test(id, title, `insertOne(${JSON.stringify(doc)})`, `Document failed validation (${why})`, async () => {
        const full = id === 'T51' ? { performedAt: new Date(), ...doc } : { memberId: M1.mid, performedAt: new Date(), ...doc };
        try { await logs.insertOne(full); return [false, 'Accepted']; } catch (e) { return [e.code === 121, `code ${e.code}: ${e.message}`]; }
    });
}
await test('T52', 'Workout plan needs at least one day', "workout_plans.insertOne({ …, days: [] })", 'Document failed validation (minItems 1)', async () => {
    try {
        await mdb.collection('workout_plans').insertOne({ memberId: M1.mid, trainerId: null, title: 'Empty plan', goal: 'endurance', status: 'active', days: [], createdAt: new Date(), updatedAt: new Date() });
        return [false, 'Accepted'];
    } catch (e) { return [e.code === 121, `code ${e.code}: ${e.message}`]; }
});
await test('T53', 'Exercise slug is unique', 'insert a second exercise with an existing slug', 'Duplicate key error E11000 (index uq_slug)', async () => {
    const ex = await mdb.collection('exercises').findOne({}, { projection: { _id: 0 } });
    try { await mdb.collection('exercises').insertOne({ ...ex }); return [false, 'Accepted']; } catch (e) { return [e.code === 11000, `code ${e.code}: ${e.message.split(' dup key')[0]}`]; }
});
await test('T54', 'Weighted text search ranks name matches first', "find({ $text: { $search: 'squat' } }) sorted by textScore",
    'Exercises with "squat" in the name come first', async () => {
        const r = await mdb.collection('exercises').find({ $text: { $search: 'squat' } }, { projection: { name: 1, score: { $meta: 'textScore' } }, sort: { score: { $meta: 'textScore' } } }).limit(3).toArray();
        return [r.length > 0 && /squat/i.test(r[0].name), r.map((x) => `${x.name} (${x.score.toFixed(2)})`).join(', ')];
    });
await test('T55', 'Notifications expire after 60 days', 'notifications.indexes()', 'TTL index on createdAt with expireAfterSeconds 5184000', async () => {
    const ix = (await mdb.collection('notifications').indexes()).find((i) => i.name === 'ttl_60_days');
    return [ix?.expireAfterSeconds === 60 * 86400, ix ? `ttl_60_days: { createdAt: 1 }, expireAfterSeconds ${ix.expireAfterSeconds}` : 'missing'];
});

// ---------------------------------------------------------------- clean up + save
await app.end();
await admin.query(`DROP DATABASE ${TEST_DB}`);
await admin.query(`REVOKE ALL PRIVILEGES ON \`${TEST_DB}\`.* FROM ?@'localhost'`, [env.MYSQL_USER]).catch(() => {});
await admin.end();
await mdb.dropDatabase();
await mc.close();

const passed = results.filter((r) => r.pass).length;
fs.writeFileSync('docs/test-results.json', JSON.stringify({ ranAt: new Date().toISOString(), passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} passed; test databases dropped`);

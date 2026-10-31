// Demo data for both databases. Everything is generated relative to today
// with a fixed random seed, so every run gives the same shape of data:
// ~10 months of memberships and payments, 8 weeks of classes, attendance,
// personal training, workout plans/logs and body measurements.
import bcrypt from 'bcryptjs';
import { exercises } from '../db/mongo/exercises.mjs';

export const DEMO_PASSWORD = 'Gym@12345';

// ---------------------------------------------------------------- helpers
let seed = 20261031;
const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const weighted = (pairs) => {
    let r = rand() * pairs.reduce((s, [, w]) => s + w, 0);
    for (const [value, w] of pairs) if ((r -= w) < 0) return value;
    return pairs.at(-1)[0];
};
const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dt = (d) => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMin = (d, n) => new Date(d.getTime() + n * 60000);
const at = (day, h, m = 0) => { const x = new Date(day); x.setHours(h, m, 0, 0); return x; };
const weekKey = (d) => ymd(addDays(d, -((d.getDay() + 6) % 7)));

async function bulkInsert(conn, table, columns, rows, chunk = 500) {
    for (let i = 0; i < rows.length; i += chunk) {
        await conn.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ?`, [rows.slice(i, i + chunk)]);
    }
}

// ---------------------------------------------------------------- reference data
const PLANS = [
    // name, description, days, price, classes/week, PT included, max freeze days, offered?, weight in demo data
    ['Day Pass', 'Single-day access to the gym floor and one class', 1, 250, 1, 0, 0, true, 0],
    ['Monthly Basic', 'Gym floor access and up to 3 group classes a week', 30, 1500, 3, 0, 0, true, 30],
    ['Monthly Plus', 'Unlimited classes, 1 personal training session, 7 freeze days', 30, 2500, null, 1, 7, true, 25],
    ['Quarterly', 'Unlimited classes, 2 personal training sessions, 15 freeze days', 90, 6500, null, 2, 15, true, 25],
    ['Half-Yearly', 'Unlimited classes, 4 personal training sessions, 30 freeze days', 180, 11500, null, 4, 30, true, 12],
    ['Annual', 'Unlimited classes, 10 personal training sessions, 45 freeze days', 365, 19999, null, 10, 45, true, 5],
    ['Summer Shred 2026', 'Discontinued summer offer: 60 days of unlimited classes', 60, 3999, null, 0, 0, false, 3],
];

const TRAINERS = [
    ['Arjun Mehta', 'Strength training and powerlifting',
        'Former state-level powerlifter. Coaches squat, bench and deadlift technique, progressive overload and muscle gain programs.', 9, 1000],
    ['Kavya Iyer', 'Yoga, mobility and flexibility',
        'Certified yoga instructor focused on mobility, posture correction, lower back pain relief and breathing.', 7, 800],
    ['Rohan Das', 'HIIT, fat loss and conditioning',
        'Runs high-intensity interval and spin classes. Specialises in fat loss and building endurance for beginners.', 5, 900],
    ['Sneha Kulkarni', 'Zumba and dance fitness',
        'Dance fitness coach. Fun cardio sessions for weight loss and toning, suitable for all ages.', 6, 700],
    ['Vikram Rao', 'CrossFit and functional training',
        'CrossFit Level 2 coach. Functional strength, kettlebells, Olympic lifting basics and athletic conditioning.', 8, 1100],
];

const ROOMS = [['Studio A', 25], ['Studio B', 20], ['Spin Room', 15], ['Functional Zone', 12]];

const CLASS_TYPES = [
    // name, description, intensity, minutes, popularity
    ['Yoga Flow', 'Slow vinyasa flow linking breath and movement. Improves flexibility, balance and calm.', 'low', 60, 0.7],
    ['Power Yoga', 'Strength-focused yoga with longer holds and faster transitions.', 'medium', 60, 0.6],
    ['HIIT Blast', 'High intensity interval training: short all-out bursts with brief rest. Burns fat fast.', 'high', 45, 0.85],
    ['Zumba', 'Latin and Bollywood dance cardio party. No dance experience needed.', 'medium', 60, 0.95],
    ['Spin Cycle', 'Indoor cycling to music with hill climbs and sprints. Low impact on the joints.', 'high', 45, 0.8],
    ['CrossFit WOD', 'Workout of the day mixing barbell lifts, gymnastics and conditioning.', 'high', 60, 0.75],
    ['Pilates Core', 'Mat pilates for deep core strength, posture and lower back health.', 'low', 45, 0.5],
    ['Strength Circuit', 'Dumbbell and kettlebell stations for full-body strength and muscle tone.', 'medium', 50, 0.6],
    ['Boxing Fit', 'Pad work, footwork and bag rounds. Great for stress relief and conditioning.', 'high', 60, 0.65],
    ['Mobility & Stretch', 'Guided stretching and foam rolling for recovery and joint mobility.', 'low', 30, 0.4],
];

// Weekly timetable: [weekday 0=Mon, time, class, trainer, room, capacity]
// (indexes into the arrays above; built so no trainer or room is double-booked)
const TIMETABLE = [
    [0, '06:30', 0, 1, 0, 20], [0, '07:00', 4, 2, 2, 15], [0, '18:00', 7, 0, 3, 12], [0, '18:30', 3, 3, 0, 25], [0, '19:00', 5, 4, 1, 15],
    [1, '06:30', 2, 2, 1, 18], [1, '07:00', 6, 1, 0, 15], [1, '18:00', 8, 4, 1, 15], [1, '19:00', 1, 1, 0, 20], [1, '19:30', 4, 2, 2, 15],
    [2, '06:30', 0, 1, 0, 20], [2, '07:00', 5, 4, 3, 12], [2, '18:00', 2, 2, 1, 18], [2, '18:30', 3, 3, 0, 25], [2, '19:00', 7, 0, 3, 12],
    [3, '06:30', 4, 2, 2, 15], [3, '07:00', 9, 1, 0, 20], [3, '18:00', 5, 4, 3, 12], [3, '19:00', 1, 1, 0, 20], [3, '19:00', 8, 2, 1, 15],
    [4, '06:30', 2, 2, 1, 18], [4, '07:00', 0, 1, 0, 20], [4, '18:00', 7, 0, 3, 12], [4, '18:30', 3, 3, 0, 25], [4, '19:30', 4, 4, 2, 15],
    [5, '08:00', 5, 4, 3, 12], [5, '08:00', 0, 1, 0, 20], [5, '09:00', 3, 3, 0, 25], [5, '10:00', 2, 2, 1, 18],
    [6, '09:00', 9, 1, 0, 20], [6, '10:00', 6, 1, 0, 15],
];

const FIRST_NAMES = [
    ['Aarav', 'male'], ['Vivaan', 'male'], ['Aditya', 'male'], ['Vihaan', 'male'], ['Sai', 'male'], ['Reyansh', 'male'],
    ['Krishna', 'male'], ['Ishaan', 'male'], ['Shaurya', 'male'], ['Rahul', 'male'], ['Karthik', 'male'], ['Nikhil', 'male'],
    ['Varun', 'male'], ['Siddharth', 'male'], ['Harsh', 'male'], ['Manish', 'male'], ['Akash', 'male'], ['Rajesh', 'male'],
    ['Suresh', 'male'], ['Pranav', 'male'], ['Abhishek', 'male'], ['Yash', 'male'], ['Gaurav', 'male'], ['Amit', 'male'],
    ['Kunal', 'male'], ['Tejas', 'male'], ['Mohit', 'male'], ['Naveen', 'male'], ['Rohit', 'male'], ['Alex', 'other'],
    ['Ananya', 'female'], ['Diya', 'female'], ['Aadhya', 'female'], ['Saanvi', 'female'], ['Pari', 'female'], ['Anika', 'female'],
    ['Navya', 'female'], ['Myra', 'female'], ['Kiara', 'female'], ['Riya', 'female'], ['Priya', 'female'], ['Deepika', 'female'],
    ['Pooja', 'female'], ['Meera', 'female'], ['Nandini', 'female'], ['Tanvi', 'female'], ['Shreya', 'female'], ['Divya', 'female'],
    ['Lakshmi', 'female'], ['Bhavana', 'female'], ['Keerthi', 'female'], ['Swathi', 'female'], ['Neha', 'female'], ['Ritu', 'female'],
    ['Sanjana', 'female'], ['Aishwarya', 'female'], ['Pallavi', 'female'], ['Isha', 'female'], ['Shruti', 'female'], ['Anjali', 'female'],
];
const LAST_NAMES = ['Sharma', 'Verma', 'Reddy', 'Nair', 'Iyer', 'Patel', 'Gupta', 'Rao', 'Menon', 'Kumar', 'Singh', 'Joshi',
    'Hegde', 'Shetty', 'Pillai', 'Bhat', 'Kulkarni', 'Desai', 'Chatterjee', 'Mishra'];

// How often each kind of member visits (probability per day)
const PROFILE_VISIT = { regular: 0.6, casual: 0.3, churning: 0.6, lapsed: 0.45, expiring: 0.45, frozen: 0.5, new: 0 };
const PROFILE_CLASS = { regular: 0.9, casual: 0.5, churning: 0.8, lapsed: 0.6, expiring: 0.6, frozen: 0.6, new: 0 };

// ================================================================ MySQL
export async function seedMysql(conn) {
    const now = new Date();
    const today = at(now, 0);
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const phones = new Set();
    const phone = () => {
        let p;
        do p = `${pick(['9', '8', '7', '6'])}${String(ri(0, 999999999)).padStart(9, '0')}`; while (phones.has(p));
        phones.add(p);
        return p;
    };

    // ---- reference tables
    await bulkInsert(conn, 'membership_plans',
        ['name', 'description', 'duration_days', 'price', 'classes_per_week', 'pt_sessions_included', 'max_freeze_days', 'is_active'],
        PLANS.map((p) => p.slice(0, 8)));
    const [planRows] = await conn.query('SELECT plan_id, name FROM membership_plans');
    const plans = PLANS.map((p) => ({
        id: planRows.find((r) => r.name === p[0]).plan_id,
        name: p[0], days: p[2], price: p[3], pt: p[5], freeze: p[6], offered: p[7], weight: p[8],
    }));

    await bulkInsert(conn, 'rooms', ['name', 'capacity'], ROOMS);
    await bulkInsert(conn, 'class_types', ['name', 'description', 'intensity', 'duration_min'], CLASS_TYPES.map((c) => c.slice(0, 4)));
    const [roomRows] = await conn.query('SELECT room_id FROM rooms ORDER BY room_id');
    const [typeRows] = await conn.query('SELECT class_type_id FROM class_types ORDER BY class_type_id');

    // ---- staff accounts
    const userRows = [['admin@ironpulse.test', passwordHash, 'admin', 'Gym Admin', phone()]];
    for (const [name] of TRAINERS) {
        userRows.push([`${name.split(' ')[0].toLowerCase()}@ironpulse.test`, passwordHash, 'trainer', name, phone()]);
    }

    // ---- members and their story (profile)
    const profiles = [
        ...Array(4).fill('new'), ...Array(6).fill('expiring'), ...Array(3).fill('frozen'), ...Array(15).fill('lapsed'),
        ...Array(12).fill('churning'), ...Array(38).fill('regular'), ...Array(32).fill('casual'),
    ];
    const usedEmails = new Set();
    const names = [...shuffle(FIRST_NAMES), ...shuffle(FIRST_NAMES)].slice(0, profiles.length);
    const members = shuffle(names).map(([first, gender], i) => {
        const last = pick(LAST_NAMES);
        let email = `${first}.${last}`.toLowerCase();
        while (usedEmails.has(email)) email = `${first}.${last}${ri(2, 99)}`.toLowerCase();
        usedEmails.add(email);
        return {
            name: `${first} ${last}`, email: `${email}@mail.test`, gender, profile: profiles[i],
            goal: weighted([['weight_loss', 30], ['muscle_gain', 25], ['general_fitness', 25], ['endurance', 10], ['flexibility', 10]]),
            dob: ymd(addDays(today, -ri(16 * 365, 58 * 365))),
            height: gender === 'female' ? ri(150, 172) : ri(162, 188),
        };
    });
    for (const m of members) userRows.push([m.email, passwordHash, 'member', m.name, phone()]);
    await bulkInsert(conn, 'users', ['email', 'password_hash', 'role', 'full_name', 'phone'], userRows);

    const [users] = await conn.query('SELECT user_id, email FROM users');
    const userId = Object.fromEntries(users.map((u) => [u.email, u.user_id]));
    const adminId = userId['admin@ironpulse.test'];

    await bulkInsert(conn, 'trainers', ['user_id', 'specialization', 'bio', 'experience_years', 'session_rate', 'hired_on'],
        TRAINERS.map(([name, spec, bio, years, rate]) => [
            userId[`${name.split(' ')[0].toLowerCase()}@ironpulse.test`], spec, bio, years, rate, ymd(addDays(today, -ri(200, 1500))),
        ]));
    const [trainerRows] = await conn.query('SELECT trainer_id, session_rate FROM trainers ORDER BY trainer_id');
    const trainers = trainerRows.map((t) => ({ id: t.trainer_id, rate: Number(t.session_rate) }));

    // ---- membership history, built backwards from the latest membership
    const pickPlan = (latest) => weighted(plans.filter((p) => p.weight && (!latest || p.offered)).map((p) => [p, p.weight]));
    for (const m of members) {
        m.chain = [];
        if (m.profile === 'new') {
            m.joined = addDays(today, -ri(0, 4));
            continue;
        }
        let plan = m.profile === 'frozen' ? pick(plans.filter((p) => p.freeze >= 7 && p.offered)) : pickPlan(true);
        let end;
        if (m.profile === 'lapsed') end = addDays(today, -ri(15, 100));
        else if (m.profile === 'expiring') end = addDays(today, ri(0, 6));
        else end = addDays(today, ri(10, plan.days - 1));
        const historyStart = addDays(today, -ri(60, 300));
        for (;;) {
            const start = addDays(end, -(plan.days - 1));
            m.chain.unshift({ plan, start, end });
            if (start <= historyStart) break;
            end = addDays(start, -1 - (chance(0.7) ? 0 : ri(1, 10)));
            plan = pickPlan(false);
        }
        m.joined = m.chain[0].start;
        if (m.profile === 'frozen') m.frozenFrom = addDays(today, -ri(2, 6));
    }

    await bulkInsert(conn, 'members',
        ['user_id', 'member_code', 'date_of_birth', 'gender', 'height_cm', 'fitness_goal', 'joined_on'],
        members.map((m) => [userId[m.email], `GM${String(userId[m.email]).padStart(6, '0')}`, m.dob, m.gender, m.height, m.goal, ymd(m.joined)]));
    const [memberRows] = await conn.query('SELECT member_id, user_id, member_code FROM members');
    for (const m of members) {
        const row = memberRows.find((r) => r.user_id === userId[m.email]);
        m.id = row.member_id;
        m.userId = row.user_id;
        m.code = row.member_code;
    }

    // All inserted as 'active'; sp_expire_memberships() fixes the old ones at the end.
    await bulkInsert(conn, 'memberships', ['member_id', 'plan_id', 'start_date', 'end_date'],
        members.flatMap((m) => m.chain.map((c) => [m.id, c.plan.id, ymd(c.start), ymd(c.end)])));
    const [msRows] = await conn.query('SELECT membership_id, member_id, start_date FROM memberships');
    for (const m of members) {
        for (const c of m.chain) c.id = msRows.find((r) => r.member_id === m.id && r.start_date === ymd(c.start)).membership_id;
    }

    const method = () => weighted([['upi', 50], ['card', 25], ['cash', 20], ['netbanking', 5]]);
    const capNow = (d) => (d > now ? addMin(now, -ri(30, 120)) : d);
    await bulkInsert(conn, 'payments', ['member_id', 'membership_id', 'amount', 'method', 'transaction_ref', 'paid_at', 'recorded_by'],
        members.flatMap((m) => m.chain.map((c) => [
            m.id, c.id, c.plan.price, method(), `MS-${c.id}-SEED`, dt(capNow(at(c.start, ri(7, 20), ri(0, 59)))), adminId,
        ])));

    const coverage = (m, day) => m.chain.find((c) => day >= at(c.start, 0) && day <= at(c.end, 0));
    const canAttend = (m, day) => coverage(m, day) && !(m.frozenFrom && day >= at(m.frozenFrom, 0));
    const visitChance = (m, day) => (m.profile === 'churning' && day >= addDays(today, -30) ? 0.07 : PROFILE_VISIT[m.profile]);
    const classChance = (m, day) => (m.profile === 'churning' && day >= addDays(today, -30) ? 0.05 : PROFILE_CLASS[m.profile]);

    // ---- class sessions: 8 weeks back, 2 weeks ahead
    const firstMonday = addDays(today, -((today.getDay() + 6) % 7) - 56);
    const sessions = [];
    for (let d = firstMonday; d <= addDays(today, 14); d = addDays(d, 1)) {
        const weekday = (d.getDay() + 6) % 7;
        for (const [wd, time, cls, tr, room, cap] of TIMETABLE) {
            if (wd !== weekday) continue;
            const [h, min] = time.split(':').map(Number);
            const starts = at(d, h, min);
            sessions.push({
                starts, ends: addMin(starts, CLASS_TYPES[cls][3]), cls, cap,
                typeId: typeRows[cls].class_type_id, trainerId: trainers[tr].id, roomId: roomRows[room].room_id,
                status: 'scheduled',
            });
        }
    }
    // a trainer called in sick twice in the past
    for (const s of shuffle(sessions.filter((x) => x.ends < addDays(today, -3))).slice(0, 2)) s.status = 'cancelled';

    await bulkInsert(conn, 'class_sessions', ['class_type_id', 'trainer_id', 'room_id', 'starts_at', 'ends_at', 'capacity', 'status'],
        sessions.map((s) => [s.typeId, s.trainerId, s.roomId, dt(s.starts), dt(s.ends), s.cap, s.status]));
    const [csRows] = await conn.query('SELECT class_session_id, room_id, starts_at FROM class_sessions');
    for (const s of sessions) s.id = csRows.find((r) => r.room_id === s.roomId && r.starts_at === dt(s.starts)).class_session_id;

    // ---- bookings
    const weekCount = new Map();
    const attendedClass = new Map(); // `${memberId}|${ymd}` -> session
    const bookings = [];
    for (const s of sessions) {
        if (s.status === 'cancelled') continue;
        const day = at(s.starts, 0);
        const past = s.ends < now;
        const inProgress = !past && s.starts <= now;
        const popularity = CLASS_TYPES[s.cls][4];
        const want = Math.round(s.cap * popularity * (0.7 + rand() * 0.6));
        const target = past || inProgress ? Math.min(want, s.cap) : Math.min(want, s.cap + 3);
        const chosen = [];
        for (const m of shuffle(members)) {
            if (chosen.length >= target) break;
            if (!canAttend(m, day) || !chance(classChance(m, day))) continue;
            const wk = `${m.id}|${weekKey(day)}`;
            const weeklyLimit = coverage(m, day).plan.name === 'Monthly Basic' ? 3 : 5;
            if ((weekCount.get(wk) || 0) >= weeklyLimit) continue;
            weekCount.set(wk, (weekCount.get(wk) || 0) + 1);
            chosen.push(m);
        }
        const times = chosen.map(() => (past || inProgress ? addMin(s.starts, -ri(60, 72 * 60)) : addMin(now, -ri(10, 72 * 60)))).sort((a, b) => a - b);
        chosen.forEach((m, i) => {
            let status;
            if (past) status = weighted([['attended', 82], ['no_show', 9], ['cancelled', 9]]);
            else status = i < s.cap ? 'booked' : 'waitlisted';
            if (status === 'attended') attendedClass.set(`${m.id}|${ymd(day)}`, s);
            bookings.push([s.id, m.id, status, `${dt(times[i]).slice(0, 17)}${pad(i % 60)}.${String(ri(0, 999)).padStart(3, '0')}`]);
        });
    }
    await bulkInsert(conn, 'class_bookings', ['class_session_id', 'member_id', 'status', 'booked_at'], bookings);

    // ---- personal training
    const ptUsed = new Map();
    const busy = new Set();
    const ptTrainer = () => weighted([[trainers[0], 4], [trainers[1], 2], [trainers[2], 1], [trainers[3], 1], [trainers[4], 2]]);
    let ptCount = 0;
    const addPt = async (day, status) => {
        const trainer = ptTrainer();
        const starts = at(day, pick([10, 11, 12, 13, 14, 15, 16]));
        const m = pick(members.filter((x) => canAttend(x, day) && x.profile !== 'churning'));
        if (!m) return;
        const tKey = `t${trainer.id}|${dt(starts)}`;
        const mKey = `m${m.id}|${dt(starts)}`;
        if (busy.has(tKey) || busy.has(mKey)) return;
        busy.add(tKey);
        busy.add(mKey);
        const ms = coverage(m, day);
        const used = ptUsed.get(ms.id) || 0;
        const free = used < ms.plan.pt && status !== 'cancelled';
        if (free) ptUsed.set(ms.id, used + 1);
        const price = free ? 0 : trainer.rate;
        const [res] = await conn.query(
            'INSERT INTO pt_sessions (trainer_id, member_id, starts_at, ends_at, status, price, member_note, created_at) VALUES (?,?,?,?,?,?,?,?)',
            [trainer.id, m.id, dt(starts), dt(addMin(starts, 60)), status, price,
                pick([null, null, 'Want to work on squat form', 'Knee feels weak, please go easy', 'Help with a diet plan', 'Prepare for a 10k run']),
                dt(capNow(addDays(starts, -ri(1, 5))))]);
        ptCount++;
        if (status === 'completed' && price > 0) {
            await conn.query(
                'INSERT INTO payments (member_id, pt_session_id, amount, method, transaction_ref, paid_at, recorded_by) VALUES (?,?,?,?,?,?,?)',
                [m.id, res.insertId, price, method(), `PT-${res.insertId}-SEED`, dt(addMin(starts, 65)), adminId]);
        }
    };
    for (let d = addDays(today, -150); d < today; d = addDays(d, 1)) {
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        for (let k = ri(0, 3); k > 0; k--) await addPt(d, weighted([['completed', 85], ['cancelled', 15]]));
    }
    for (let d = addDays(today, 1); d <= addDays(today, 10); d = addDays(d, 1)) {
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        await addPt(d, pick(['requested', 'confirmed']));
    }

    // ---- attendance (front-desk check-ins)
    const visits = [];
    const visitDays = new Map(); // memberId -> [ymd, ...] for workout logs
    const hourWeights = [[6, 5], [7, 9], [8, 7], [9, 4], [10, 3], [11, 2], [12, 2], [13, 1], [14, 1], [15, 2], [16, 4], [17, 8], [18, 10], [19, 9], [20, 5], [21, 2]];
    for (const m of members) {
        if (!m.chain.length) continue;
        for (let d = addDays(today, -150); d <= today; d = addDays(d, 1)) {
            if (!canAttend(m, d)) continue;
            const cls = attendedClass.get(`${m.id}|${ymd(d)}`);
            let inAt;
            let outAt;
            if (cls) {
                inAt = addMin(cls.starts, -ri(5, 20));
                outAt = addMin(cls.ends, ri(5, 40));
            } else if (chance(visitChance(m, d))) {
                inAt = at(d, weighted(hourWeights), ri(0, 59));
                outAt = addMin(inAt, ri(40, 110));
                const closing = at(d, 22, 30);
                if (outAt > closing) outAt = closing;
            } else continue;
            if (outAt >= now) continue;
            visits.push([m.id, dt(inAt), dt(outAt)]);
            if (!visitDays.has(m.id)) visitDays.set(m.id, []);
            visitDays.get(m.id).push(ymd(d));
        }
    }
    // members in the gym right now (only during opening hours)
    if (now.getHours() >= 6 && now.getHours() < 22) {
        const todayStr = ymd(today);
        const inGym = shuffle(members.filter((m) => ['regular', 'casual'].includes(m.profile) && canAttend(m, today)
            && !(visitDays.get(m.id) || []).includes(todayStr))).slice(0, ri(4, 8));
        for (const m of inGym) visits.push([m.id, dt(addMin(now, -ri(5, 75))), null]);
    }
    await bulkInsert(conn, 'attendance', ['member_id', 'check_in', 'check_out'], visits);

    // ---- final state changes (these go through the triggers and procedures)
    for (const m of members.filter((x) => x.frozenFrom)) {
        const c = coverage(m, today);
        await conn.query("UPDATE memberships SET status = 'frozen', frozen_from = ? WHERE membership_id = ?", [ymd(m.frozenFrom), c.id]);
        await conn.query(
            `UPDATE class_bookings cb JOIN class_sessions cs ON cs.class_session_id = cb.class_session_id
             SET cb.status = 'cancelled' WHERE cb.member_id = ? AND cs.starts_at > NOW() AND cb.status IN ('booked','waitlisted')`, [m.id]);
    }
    await conn.query('CALL sp_expire_memberships()');
    await conn.query('CALL sp_close_finished_classes()');
    // one upcoming class gets cancelled: trg_class_sessions_au cancels its bookings
    const upcoming = sessions.filter((s) => s.starts > addDays(now, 2) && s.status === 'scheduled');
    await conn.query("UPDATE class_sessions SET status = 'cancelled' WHERE class_session_id = ?", [pick(upcoming).id]);

    const [[counts]] = await conn.query(`SELECT
        (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM memberships) AS memberships,
        (SELECT COUNT(*) FROM payments) AS payments, (SELECT COUNT(*) FROM class_sessions) AS classes,
        (SELECT COUNT(*) FROM class_bookings) AS bookings, (SELECT COUNT(*) FROM attendance) AS visits`);
    console.log(`  MySQL: ${counts.users} users, ${counts.memberships} memberships, ${counts.payments} payments, ` +
        `${counts.classes} classes, ${counts.bookings} bookings, ${ptCount} PT sessions, ${counts.visits} visits`);

    return { members, trainers, visitDays, today };
}

// ================================================================ MongoDB
const PLAN_TEMPLATES = {
    general_fitness: {
        title: 'Beginner Full Body', trainer: 4, days: [
            [1, 'Full Body A', [['goblet-squat', 3, '10-12', 90], ['push-up', 3, '8-12', 60], ['seated-cable-row', 3, '10-12', 60], ['plank', 3, '30s', 45]]],
            [3, 'Full Body B', [['romanian-deadlift', 3, '10', 90], ['incline-dumbbell-press', 3, '10', 60], ['lat-pulldown', 3, '10-12', 60], ['dead-bug', 3, '10 each side', 45]]],
            [5, 'Full Body C', [['walking-lunge', 3, '10 each leg', 60], ['overhead-press', 3, '8-10', 90], ['face-pull', 3, '15', 45], ['russian-twist', 3, '20', 45]]],
        ],
    },
    muscle_gain: {
        title: 'Push Pull Legs Hypertrophy', trainer: 0, days: [
            [1, 'Push', [['barbell-bench-press', 4, '6-8', 150], ['incline-dumbbell-press', 3, '8-10', 90], ['overhead-press', 3, '8-10', 120], ['lateral-raise', 3, '12-15', 60], ['triceps-rope-pushdown', 3, '12', 60]]],
            [2, 'Pull', [['pull-up', 4, '6-8', 120], ['bent-over-barbell-row', 3, '8-10', 120], ['seated-cable-row', 3, '10-12', 90], ['face-pull', 3, '15', 60], ['barbell-curl', 3, '10-12', 60]]],
            [3, 'Legs', [['barbell-back-squat', 4, '6-8', 180], ['romanian-deadlift', 3, '8-10', 120], ['leg-press', 3, '10-12', 90], ['hip-thrust', 3, '10', 90], ['standing-calf-raise', 4, '12-15', 60]]],
        ],
    },
    weight_loss: {
        title: 'Fat Loss Conditioning', trainer: 2, days: [
            [1, 'Metabolic Circuit', [['kettlebell-swing', 4, '15', 45], ['goblet-squat', 3, '15', 45], ['push-up', 3, '12', 45], ['mountain-climber', 3, '40s', 30], ['burpee', 3, '10', 45]]],
            [3, 'Intervals + Core', [['stationary-bike-intervals', 1, '10 rounds', 0], ['plank', 3, '45s', 30], ['russian-twist', 3, '24', 30], ['dead-bug', 3, '12', 30]]],
            [5, 'Strength + Cardio', [['walking-lunge', 3, '12 each leg', 60], ['lat-pulldown', 3, '12', 60], ['incline-dumbbell-press', 3, '12', 60], ['rowing-machine', 1, '15 min', 0]]],
        ],
    },
    flexibility: {
        title: 'Mobility & Back Care', trainer: 1, days: [
            [1, 'Spine & Hips', [['cat-cow-stretch', 2, '10 breaths', 0], ['worlds-greatest-stretch', 2, '5 each side', 30], ['pigeon-pose', 2, '60s each side', 30], ['dead-bug', 3, '10', 30]]],
            [4, 'Posture', [['foam-roll-thoracic-spine', 2, '60s', 0], ['face-pull', 3, '15', 45], ['downward-dog', 3, '45s', 30], ['plank', 3, '30s', 30]]],
        ],
    },
    endurance: {
        title: 'Endurance Builder', trainer: 4, days: [
            [1, 'Tempo Run', [['treadmill-run', 1, '25 min', 0], ['walking-lunge', 3, '12 each leg', 60], ['plank', 3, '45s', 30]]],
            [3, 'Row & Ride', [['rowing-machine', 1, '20 min', 0], ['stationary-bike-intervals', 1, '8 rounds', 0], ['jump-rope', 3, '2 min', 60]]],
            [6, 'Long Steady', [['treadmill-run', 1, '40 min', 0], ['cat-cow-stretch', 2, '10 breaths', 0]]],
        ],
    },
};

// Starting working weight (kg) for an average intermediate lifter
const BASE_WEIGHT = {
    'barbell-back-squat': 60, 'goblet-squat': 16, 'romanian-deadlift': 50, 'walking-lunge': 10, 'leg-press': 100,
    'hip-thrust': 60, 'standing-calf-raise': 40, 'barbell-bench-press': 50, 'incline-dumbbell-press': 16, 'overhead-press': 30,
    'lateral-raise': 6, 'face-pull': 15, 'lat-pulldown': 40, 'bent-over-barbell-row': 40, 'seated-cable-row': 40,
    'barbell-curl': 20, 'triceps-rope-pushdown': 20, 'russian-twist': 5, 'kettlebell-swing': 16,
};
const CARDIO_KM_PER_MIN = { 'treadmill-run': 0.15, 'rowing-machine': 0.2, 'stationary-bike-intervals': 0.4 };

export async function seedMongo(db, { members, trainers, visitDays, today }) {
    const { insertedIds } = await db.collection('exercises').insertMany(exercises);
    const exBySlug = Object.fromEntries(exercises.map((e, i) => [e.slug, { ...e, _id: insertedIds[i] }]));

    const withPlans = shuffle(members.filter((m) => ['regular', 'casual', 'expiring', 'churning', 'frozen'].includes(m.profile))).slice(0, 45);
    const plans = [];
    for (const m of withPlans) {
        const tpl = PLAN_TEMPLATES[m.goal];
        const byTrainer = chance(0.7);
        const createdAt = addDays(today, -ri(42, 63));
        plans.push({
            memberId: m.id,
            trainerId: byTrainer ? trainers[tpl.trainer].id : null,
            title: byTrainer ? tpl.title : `My ${tpl.title}`,
            goal: m.goal,
            durationWeeks: 12,
            status: 'active',
            days: tpl.days.map(([day, title, list]) => ({
                day, title,
                exercises: list.map(([slug, sets, reps, restSec]) => ({ exerciseId: exBySlug[slug]._id, name: exBySlug[slug].name, sets, reps, restSec })),
            })),
            createdAt, updatedAt: createdAt,
        });
    }
    const planIds = (await db.collection('workout_plans').insertMany(plans)).insertedIds;

    // workout logs follow the plan, with weights creeping up week by week
    const logs = [];
    const metrics = [];
    plans.forEach((plan, pi) => {
        const m = withPlans[pi];
        const strength = (m.gender === 'female' ? 0.65 : 1) * (0.7 + rand() * 0.5);
        const days = (visitDays.get(m.id) || []).filter((d) => d >= ymd(plan.createdAt));
        days.forEach((d, i) => {
            if (!chance(0.75)) return;
            const planDay = plan.days[i % plan.days.length];
            const performedAt = at(new Date(`${d}T00:00:00`), ri(6, 20), ri(0, 59));
            const weeks = (performedAt - plan.createdAt) / (7 * 86400000);
            const log = { memberId: m.id, planId: planIds[pi], performedAt, durationMin: ri(40, 95), rpe: ri(5, 9), exercises: [], cardio: [] };
            for (const ex of planDay.exercises) {
                const info = exercises.find((e) => e.name === ex.name);
                if (info.category === 'cardio') {
                    const minutes = ri(12, 35);
                    log.cardio.push({ activity: ex.name, minutes, ...(CARDIO_KM_PER_MIN[info.slug] && { distanceKm: Math.round(minutes * CARDIO_KM_PER_MIN[info.slug] * (0.9 + rand() * 0.3) * 10) / 10 }) });
                } else if (info.category === 'mobility' || /s$|s each|breaths/.test(ex.reps)) {
                    const sec = parseInt(ex.reps, 10) || 45;
                    log.exercises.push({ exerciseId: ex.exerciseId, name: ex.name, sets: Array.from({ length: ex.sets }, () => ({ durationSec: sec + ri(0, 15) })) });
                } else {
                    const reps = parseInt(ex.reps, 10) || 10;
                    const base = BASE_WEIGHT[info.slug];
                    log.exercises.push({
                        exerciseId: ex.exerciseId, name: ex.name,
                        sets: Array.from({ length: ex.sets }, (_, s) => {
                            const set = { reps: Math.max(1, reps + ri(-1, 2) - (s === ex.sets - 1 ? ri(0, 2) : 0)) };
                            if (base) set.weightKg = Math.max(2.5, Math.round((base * strength * (1 + 0.015 * weeks)) / 2.5) * 2.5);
                            return set;
                        }),
                    });
                }
            }
            if (!log.cardio.length) delete log.cardio;
            logs.push(log);
        });

        // weekly weigh-ins for 12 weeks
        let weight = (m.height - 100) * (m.gender === 'female' ? 0.95 : 1.05) + ri(-4, 12);
        const trend = { weight_loss: -0.45, muscle_gain: 0.2, general_fitness: -0.1, endurance: -0.15, flexibility: 0 }[m.goal];
        for (let w = 12; w >= 0; w--) {
            weight += trend + (rand() - 0.5) * 0.6;
            const reading = { memberId: m.id, recordedAt: at(addDays(today, -w * 7), 7, ri(0, 59)), weightKg: Math.round(weight * 10) / 10 };
            if (pi % 2 === 0) reading.bodyFatPct = Math.round((m.gender === 'female' ? 28 : 21) + (weight - m.height + 100) * 0.3) / 1;
            if (pi % 3 === 0) reading.waistCm = Math.round(weight * 0.9 + 15);
            metrics.push(reading);
        }
    });
    if (logs.length) await db.collection('workout_logs').insertMany(logs);
    if (metrics.length) await db.collection('body_metrics').insertMany(metrics);

    const notes = [];
    for (const m of members.filter((x) => x.profile === 'expiring')) {
        notes.push({ userId: m.userId, type: 'renewal_reminder', title: 'Your membership is ending soon',
            message: 'Renew now so your access and class bookings continue without a break.', readAt: null, createdAt: addDays(today, -1), meta: {} });
    }
    plans.forEach((p, i) => {
        if (p.trainerId) notes.push({ userId: withPlans[i].userId, type: 'plan_assigned', title: `New workout plan: ${p.title}`,
            message: 'Your trainer has created a workout plan for you.', readAt: p.createdAt, createdAt: p.createdAt, meta: { planId: planIds[i] } });
    });
    await db.collection('notifications').insertMany(notes);

    console.log(`  MongoDB: ${exercises.length} exercises, ${plans.length} workout plans, ${logs.length} workout logs, ` +
        `${metrics.length} body readings, ${notes.length} notifications`);
}

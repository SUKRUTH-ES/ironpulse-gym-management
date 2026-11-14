// Takes screenshots of every screen of the running app (npm run dev, port 3000)
// with headless Microsoft Edge driven over the Chrome DevTools Protocol.
// Logged-in pages: the script signs a session cookie with SESSION_SECRET,
// exactly like the login action does, for a chosen admin / trainer / member.
// Run from the project root:  node docs/tools/screenshots.mjs [onlyNamePart]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import { SignJWT } from 'jose';

process.loadEnvFile('.env.local');
const BASE = process.env.SHOT_BASE || 'http://localhost:3000';
const OUT = 'docs/screenshots';
const WIDTH = 1440, MIN_H = 900, MAX_H = 5000;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const only = process.argv[2];

// ---------------------------------------------------------------- choose demo accounts from the data
const db = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
});
const one = async (q, p = []) => (await db.query(q, p))[0][0];
const admin = await one("SELECT user_id FROM users WHERE role = 'admin' AND is_active ORDER BY user_id LIMIT 1");
// trainer with the most PT sessions (busy home page)
const trainer = await one(`SELECT u.user_id, t.trainer_id FROM trainers t JOIN users u ON u.user_id = t.user_id
    WHERE u.is_active ORDER BY (SELECT COUNT(*) FROM pt_sessions p WHERE p.trainer_id = t.trainer_id) DESC LIMIT 1`);
// active member with the most workout logs and an active plan
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const mdb = mc.db(process.env.MONGODB_DB);
const top = await mdb.collection('workout_logs').aggregate([
    { $group: { _id: '$memberId', n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 30 }]).toArray();
const withPlan = new Set((await mdb.collection('workout_plans').distinct('memberId', { status: 'active' })));
let member;
for (const t of top) {
    if (!withPlan.has(t._id)) continue;
    member = await one(`SELECT member_id, user_id FROM v_member_overview WHERE member_id = ? AND membership_status = 'active' AND is_active`, [t._id]);
    if (member) break;
}
await mc.close();
await db.end();
console.log('admin user', admin.user_id, '| trainer user', trainer.user_id, '| member', member.member_id, 'user', member.user_id);

const key = new TextEncoder().encode(process.env.SESSION_SECRET);
const token = (userId, role) => new SignJWT({ userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(key);
const sessions = {
    admin: await token(admin.user_id, 'admin'),
    trainer: await token(trainer.user_id, 'trainer'),
    member: await token(member.user_id, 'member'),
};

// ---------------------------------------------------------------- screens
const SHOTS = [
    ['01-landing', null, '/'],
    ['02-login', null, '/login'],
    ['03-register', null, '/register'],
    ['10-admin-dashboard', 'admin', '/admin'],
    ['11-admin-front-desk', 'admin', '/admin/check-in'],
    ['12-admin-members', 'admin', '/admin/members'],
    ['13-admin-member-detail', 'admin', `/admin/members/${member.member_id}`],
    ['14-admin-classes', 'admin', '/admin/classes'],
    ['15-admin-payments', 'admin', '/admin/payments'],
    ['16-admin-plans', 'admin', '/admin/plans'],
    ['17-admin-reports', 'admin', '/admin/reports'],
    ['18-admin-gym-setup', 'admin', '/admin/setup'],
    ['20-trainer-home', 'trainer', '/trainer'],
    ['21-trainer-members', 'trainer', '/trainer/members'],
    ['30-member-home', 'member', '/member'],
    ['31-member-classes', 'member', '/member/classes'],
    ['32-member-training-search', 'member', '/member/training?q=back%20pain'],
    ['33-member-workouts', 'member', '/member/workouts'],
    ['34-member-plan-builder', 'member', '/member/workouts/new'],
    ['35-member-exercises-search', 'member', '/member/exercises?q=shoulder%20press'],
    ['36-member-membership', 'member', '/member/membership'],
    ['37-member-profile', 'member', '/member/profile'],
    ['40-access-denied-redirect', 'trainer', '/admin'],
].filter(([name]) => !only || name.includes(only));

// ---------------------------------------------------------------- Edge + CDP
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ironpulse-shots-'));
const PORT = 9333;
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50 && !targets; i++) {
    await new Promise((r) => setTimeout(r, 200));
    targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});
const waitFor = (method, ms = 20000) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    listeners.push(function l(m) { if (m.method === method) { clearTimeout(t); listeners.splice(listeners.indexOf(l), 1); resolve(m); } });
});

await send('Page.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: MIN_H, deviceScaleFactor: 1, mobile: false });
fs.mkdirSync(OUT, { recursive: true });

const report = [];
for (const [name, role, url] of SHOTS) {
    await send('Network.clearBrowserCookies');
    if (role) {
        await send('Network.setCookie', { name: 'gym_session', value: sessions[role], url: BASE, httpOnly: true, sameSite: 'Lax' });
    }
    const loaded = waitFor('Page.loadEventFired');
    await send('Page.navigate', { url: BASE + url });
    await loaded;
    await new Promise((r) => setTimeout(r, 1200));   // let fonts/hydration settle
    const { result } = await send('Runtime.evaluate', {
        // remove the Next.js dev-tools badge so it does not appear in the pictures
        expression: "document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()); JSON.stringify({ h: document.documentElement.scrollHeight, url: location.pathname + location.search, title: document.title })",
        returnByValue: true,
    });
    const info = JSON.parse(result.value);
    const h = Math.min(Math.max(info.h, MIN_H), MAX_H);
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: h, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: MIN_H, deviceScaleFactor: 1, mobile: false });
    report.push(`${name}  ${url}  →  ${info.url}  "${info.title}"  ${WIDTH}x${h}${info.h > MAX_H ? ' (cut)' : ''}`);
    console.log(report.at(-1));
}

ws.close();
edge.kill();
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }

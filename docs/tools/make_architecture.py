# Draws the system architecture diagram -> docs/diagrams/architecture.svg
# Run from the project root:  python docs/tools/make_architecture.py
# Render:  bash docs/diagrams/render.sh architecture 1900 1080
import json, html, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, 'tools', 'schema.json'), encoding='utf-8'))
n_fn = sum(r['type'] == 'FUNCTION' for r in d['routines'])
n_sp = sum(r['type'] == 'PROCEDURE' for r in d['routines'])
esc = html.escape
W, H = 1900, 1080
s = []

def box(x, y, w, h, title, lines=(), fill='#fff', stroke='#334', head=None, title_size=16, line_size=13, mono=False):
    s.append(f"<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='8' fill='{fill}' stroke='{stroke}' stroke-width='1.5'/>")
    if head:
        s.append(f"<path d='M {x} {y + 34} V {y + 8} Q {x} {y} {x + 8} {y} H {x + w - 8} Q {x + w} {y} {x + w} {y + 8} V {y + 34} Z' fill='{head}'/>")
        s.append(f"<text x='{x + 14}' y='{y + 23}' font-size='{title_size}' font-weight='bold' fill='#fff'>{esc(title)}</text>")
        ty = y + 56
    else:
        s.append(f"<text x='{x + 14}' y='{y + 24}' font-size='{title_size}' font-weight='bold'>{esc(title)}</text>")
        ty = y + 46
    fam = " font-family='Consolas, monospace'" if mono else ''
    for i, ln in enumerate(lines):
        s.append(f"<text x='{x + 14}' y='{ty + i * (line_size + 6)}' font-size='{line_size}'{fam} xml:space='preserve'>{esc(ln)}</text>")

def arrow(pts, label=None, lx=None, ly=None, dashed=False, color='#334', both=False, anchor='middle'):
    p = ' '.join(f"{'M' if i == 0 else 'L'} {x} {y}" for i, (x, y) in enumerate(pts))
    dash = " stroke-dasharray='7 5'" if dashed else ''
    start = " marker-start='url(#a)'" if both else ''
    s.append(f"<path d='{p}' fill='none' stroke='{color}' stroke-width='1.8'{dash} marker-end='url(#a)'{start}/>")
    if label:
        for i, t in enumerate(label.split('\n')):
            s.append(f"<text x='{lx}' y='{ly + i * 17}' font-size='12.5' text-anchor='{anchor}' fill='#222'>{esc(t)}</text>")

# ---------------------------------------------------------------- tier 1: browser
box(40, 110, 330, 430, 'Client — web browser', [
    'Admin  ·  Trainer  ·  Member',
    '',
    'Server-rendered HTML pages',
    '(forms, tables, search, filters,',
    'dashboards, SVG charts)',
    '',
    'Small client components only for',
    'form state (useActionState) and',
    'nav highlighting',
    '',
    'Cookie gym_session',
    '  JWT HS256, 8 h, httpOnly,',
    '  sameSite=lax (JS cannot read it)',
], fill='#f8fafc', head='#475569')

# ---------------------------------------------------------------- tier 2: Next.js server
s.append("<rect x='450' y='80' width='820' height='900' rx='12' fill='#f0fdfa' stroke='#0f766e' stroke-width='2' stroke-dasharray='0'/>")
s.append("<text x='470' y='110' font-size='18' font-weight='bold' fill='#0f766e'>Next.js 16 server (Node.js 24) — App Router, JavaScript</text>")

box(480, 130, 760, 110, 'src/proxy.js — runs before every protected page', [
    'Reads gym_session → decryptSession() (jose). No session → /login.',
    'Wrong role for /admin, /trainer, /member → redirect to own home page.',
], fill='#fff', stroke='#0f766e')

box(480, 270, 370, 330, 'Pages (React Server Components)', [
    '/            landing',
    '/login  /register',
    '/admin       dashboard, check-in,',
    '             members, classes,',
    '             payments, plans,',
    '             reports, setup',
    '/trainer     home, members',
    '/member      home, classes, training,',
    '             workouts, exercises,',
    '             membership, profile',
], fill='#fff', stroke='#0f766e', line_size=12.5, mono=True)

box(870, 270, 370, 330, 'Server Actions (form submits)', [
    'actions/auth.js  login, register, logout',
    'admin/actions.js  members, payments,',
    '   refunds, classes, plans, setup',
    'trainer/actions.js  PT, attendance,',
    '   plan builder',
    'member/actions.js  book/cancel, buy,',
    '   freeze, PT request, workouts,',
    '   own plans, profile, password',
    '',
    "Every action starts with",
    "requireRole('...') and re-checks input",
], fill='#fff', stroke='#0f766e', line_size=12.5)

box(480, 630, 760, 160, 'src/lib — data-access layer (server-only)', [
    'auth.js     requireRole(), getUser()   ·   bcryptjs password hashing',
    'session.js  encrypt/decrypt JWT with SESSION_SECRET (jose)',
    'db.js       mysql2 pool → sql(), sqlOne(), callProcedure(), transaction()  (prepared)',
    'mongo.js    MongoClient singleton → mongo(), toObjectId()',
    'notifications.js · workout.js   helpers that write/read MongoDB documents',
], fill='#fff', stroke='#0f766e', line_size=12.5, mono=True)

box(480, 820, 360, 140, '.env.local (not in Git)', [
    'MYSQL_HOST/PORT/DATABASE',
    'MYSQL_USER / MYSQL_PASSWORD  (gym_app)',
    'MONGODB_URI / MONGODB_DB',
    'SESSION_SECRET',
], fill='#fffbeb', stroke='#b45309', line_size=12.5, mono=True)

box(870, 820, 370, 140, 'scripts/ (run once, npm run db:setup)', [
    'db-setup.mjs   connects as MySQL root',
    '  (MYSQL_ADMIN_USER) → runs db/mysql/*.sql,',
    '  creates gym_app, db/mongo collections',
    'seed-data.mjs  demo members, classes, logs',
], fill='#fff', stroke='#64748b', line_size=12.5)

# ---------------------------------------------------------------- tier 3: databases
box(1420, 110, 450, 470, 'MySQL 8 — gym_db (relational, ACID)', [
    f'{len(d["tables"])} tables, {len(d["fks"])} foreign keys, {len(d["checks"])} CHECK constraints',
    f'{len(d["views"])} views (v_member_overview, v_class_schedule, …)',
    f'{n_fn} stored functions, {n_sp} stored procedures',
    '  (transactions + SIGNAL 45000 business errors)',
    f'{len(d["triggers"])} triggers (validation, audit_log, cascades)',
    f'{len(d["events"])} scheduled events (expire memberships,',
    '  close classes, no-shows, auto check-out)',
    'FULLTEXT indexes on trainers, class_types',
    '',
    'Holds: users & roles, members, trainers,',
    'plans, memberships, payments, classes,',
    'bookings, PT sessions, attendance, audit',
    '',
    'App connects as gym_app:',
    '  SELECT, INSERT, UPDATE, DELETE, EXECUTE only',
    '  (no DROP / ALTER / CREATE)',
], fill='#fff', head='#0e7490')

box(1420, 620, 450, 340, 'MongoDB 8 — gym_mongo (documents)', [
    'exercises        library + member-private ones,',
    '                 weighted $text search',
    'workout_plans    nested days → exercises',
    'workout_logs     sets / cardio arrays; aggregation',
    '                 pipelines for volume, PRs, streaks',
    'body_metrics     time-series collection',
    'notifications    inbox, TTL index (60 days)',
    '',
    '$jsonSchema validators; links to MySQL by',
    'memberId / trainerId / userId (checked in MySQL first)',
], fill='#fff', head='#3f6212', line_size=12, mono=True)

# ---------------------------------------------------------------- arrows
arrow([(370, 300), (480, 300)], 'GET page /\nPOST form', 410, 268)
arrow([(480, 340), (370, 340)], 'HTML (RSC)', 410, 360)
arrow([(665, 600), (665, 630)])
arrow([(1055, 600), (1055, 630)])
arrow([(1240, 680), (1300, 680), (1300, 400), (1420, 400)], 'mysql2 pool,\nprepared\nstatements', 1308, 470, anchor='start')
arrow([(1240, 760), (1420, 760)], 'MongoDB driver', 1340, 750)
arrow([(660, 820), (660, 790)], None, dashed=True, color='#b45309')
arrow([(1240, 900), (1395, 900), (1395, 560), (1420, 560)], None, dashed=True, color='#64748b')
arrow([(1395, 900), (1420, 900)], None, dashed=True, color='#64748b')
s.append("<text x='1278' y='925' font-size='12.5'>as root: DDL, routines,</text><text x='1278' y='942' font-size='12.5'>triggers, events, seed</text>")

# legend
s.append("<text x='40' y='600' font-size='14' font-weight='bold'>How one request flows</text>")
flow = [
    '1. Browser sends request + cookie.',
    '2. proxy.js checks the JWT role.',
    '3. Page / action calls requireRole().',
    '4. lib/db.js runs a view, query or',
    '   CALL sp_…(…) on MySQL; triggers',
    '   and CHECKs validate in the DB.',
    '5. lib/mongo.js reads/writes',
    '   documents (plans, logs, inbox).',
    '6. HTML is rendered on the server',
    '   and sent back; DB errors',
    '   (SIGNAL) are shown in the form.',
]
for i, t in enumerate(flow):
    s.append(f"<text x='40' y='{628 + i * 21}' font-size='13'>{esc(t)}</text>")
s.append("<line x1='40' x2='90' y1='890' y2='890' stroke='#64748b' stroke-width='1.8' stroke-dasharray='7 5'/>"
         "<text x='100' y='894' font-size='12.5'>setup-time only</text>")

svg = (f"<svg xmlns='http://www.w3.org/2000/svg' width='{W}' height='{H}' viewBox='0 0 {W} {H}' font-family='Segoe UI, Arial, sans-serif'>"
       "<defs><marker id='a' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='8' markerHeight='8' orient='auto-start-reverse'>"
       "<path d='M0,0 L10,5 L0,10 z' fill='#334'/></marker></defs>"
       "<rect width='100%' height='100%' fill='#fff'/>"
       f"<text x='{W / 2}' y='48' font-size='26' text-anchor='middle'>IronPulse — System Architecture</text>"
       + ''.join(s) + '</svg>')
open(os.path.join(ROOT, 'diagrams', 'architecture.svg'), 'w', encoding='utf-8').write(svg)
print('architecture', W, H)

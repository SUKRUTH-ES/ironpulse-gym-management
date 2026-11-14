# Builds the course-format project report: docs/IronPulse-Report.html (+ PDF with headless Edge).
# Sections follow the required list: Title, SRN and Name, Abstract, Tech Stack, SQL commands,
# NoSQL commands, Next.js project tree, screenshots (code + demo), evaluation rubrics.
# All SQL / MongoDB text is cut out of the real project files; query outputs come from
# docs/important-queries.md (run-queries.mjs) and test numbers from docs/test-results.json.
# Run from the project root:  python docs/tools/build_report.py
import datetime, html, json, os, re, subprocess, sys
from PIL import Image, ImageOps

DOCS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.dirname(DOCS)
sys.path.insert(0, os.path.join(DOCS, 'tools'))
schema = json.load(open(os.path.join(DOCS, 'tools', 'schema.json'), encoding='utf-8'))
tests = json.load(open(os.path.join(DOCS, 'test-results.json'), encoding='utf-8'))
esc = html.escape

# ------------------------------------------------------------------ team (fill in the missing SRN)
TEAM = [
    ('SUKRUTH ES', 'PES1UG24CS160'),
    ('Gagan Eswar', 'PES1UG24CS165'),
]
SECTION = 'C'
REPO = 'https://github.com/SUKRUTH-ES/ironpulse-gym-management'

# ------------------------------------------------------------------ helpers
def read(path):
    return open(os.path.join(PROJECT, path), encoding='utf-8').read()

def cut(path, start, end, include_end=True):
    """Text of `path` from the first line matching regex `start` to the next line containing `end`."""
    lines = read(path).split('\n')
    s = next(i for i, l in enumerate(lines) if re.search(start, l))
    e = next(i for i in range(s, len(lines)) if end in lines[i])
    return '\n'.join(lines[s:e + (1 if include_end else 0)])

def code(text, lang='sql', title=None):
    t = f'<div class="codetitle">{esc(title)}</div>' if title else ''
    return f'{t}<pre class="code"><code>{esc(text.strip())}</code></pre>'

from mdlite import md_to_html  # noqa: E402  (tiny markdown converter, docs/tools/mdlite.py)

ASSETS = os.path.join(DOCS, 'report-assets')
os.makedirs(ASSETS, exist_ok=True)
FIG = [0]
def figure(path, caption, cls=''):
    FIG[0] += 1
    return f'<figure class="{cls}"><img src="{path}" alt=""><figcaption>Figure {FIG[0]}: {esc(caption)}</figcaption></figure>'

def rotated_diagram(name):
    im = Image.open(os.path.join(DOCS, 'diagrams', name + '.png')).convert('RGB')
    box = ImageOps.invert(im).getbbox()
    box = (max(box[0] - 12, 0), max(box[1] - 12, 0), min(box[2] + 12, im.width), min(box[3] + 12, im.height))
    im.crop(box).rotate(90, expand=True).save(os.path.join(ASSETS, name + '-rot.png'))
    return f'report-assets/{name}-rot.png'

def screen(name, caption, max_h=1500):
    im = Image.open(os.path.join(DOCS, 'screenshots', name + '.png'))
    path = f'screenshots/{name}.png'
    if im.height > max_h:
        im.crop((0, 0, im.width, max_h)).save(os.path.join(ASSETS, name + '.png'))
        path = f'report-assets/{name}.png'
        caption += ' (top part of the page)'
    return figure(path, caption, 'screen')

# important-queries.md split into its Qn blocks (query text + real output)
QMD = open(os.path.join(DOCS, 'important-queries.md'), encoding='utf-8').read()
Q = {}
for m in re.finditer(r'^### Q(\d+)\. .*?(?=^### Q|^## |\Z)', QMD, re.S | re.M):
    Q[int(m.group(1))] = m.group(0)
def q(*nums):
    return ''.join(md_to_html(Q[n], shift=1, skip_title=False) for n in nums)
INTEGRITY = re.search(r'^## 2\. .*?(?=^## 3\.)', QMD, re.S | re.M).group(0)

n_tables, n_fk, n_chk = len(schema['tables']), len(schema['fks']), len(schema['checks'])
n_views, n_trg, n_ev = len(schema['views']), len(schema['triggers']), len(schema['events'])
n_fn = sum(r['type'] == 'FUNCTION' for r in schema['routines'])
n_sp = sum(r['type'] == 'PROCEDURE' for r in schema['routines'])
S = []
def section(id_, title, body):
    S.append(f'<section id="{id_}"><h1>{esc(title)}</h1>{body}</section>')

# ================================================================== 1–2. title + team (cover)
team_rows = ''.join(f'<tr><td>{esc(n)}</td><td>{esc(s)}</td></tr>' for n, s in TEAM)
cover = f'''<section class="cover">
<div class="brand">DBMS Experiential Learning — Level 3 Project</div>
<h1 class="title">IronPulse</h1>
<p class="subtitle">Gym Management System using MySQL, MongoDB and Next.js</p>
<table class="team"><thead><tr><th>Student name</th><th>SRN</th></tr></thead><tbody>{team_rows}</tbody></table>
<p class="meta">Course: Database Management Systems · Section {esc(SECTION)}<br>Instructor: Dr. Nagasundari S<br>
Department of Computer Science and Engineering, PES University<br>{datetime.date.today().strftime('%d %B %Y')}</p>
<p class="meta">Source code: <a href="{REPO}">{REPO}</a></p>
</section>'''

# ================================================================== 3. abstract
section('abstract', '3. Abstract', f'''
<p>Small and mid-sized gyms still run on registers, spreadsheets and chat groups. As they grow, memberships lapse
unnoticed, popular classes are overbooked while trainers and rooms get double-booked, payments are hard to reconcile and
nobody can tell which members are about to quit. <strong>IronPulse</strong> is a web-based gym management system that
replaces this with one consistent source of truth for three roles — admin, trainer and member.</p>
<p>The system uses two database paradigms, each for the data it suits. <strong>MySQL 8</strong> stores everything
where correctness is critical: users and roles, membership plans and memberships, payments and refunds, group classes
with capacity and waitlists, personal-training sessions and front-desk attendance. The schema has {n_tables} tables,
{n_fk} foreign keys, {n_chk} CHECK constraints, {n_views} views, {n_fn} functions, {n_sp} stored procedures,
{n_trg} triggers and {n_ev} scheduled events; business rules such as "no overlapping memberships", "no room or trainer
clash", "the last seat goes to exactly one member" and "payments are never deleted" are enforced inside the database
with constraints, triggers and transactions with row locks. <strong>MongoDB 8</strong> stores nested, variable-shape
training data — workout plans, workout logs, an exercise library, a time-series of body measurements and a
self-expiring notification inbox — with <code>$jsonSchema</code> validation, text and TTL indexes and aggregation
pipelines for progress statistics.</p>
<p>A <strong>Next.js 16</strong> application provides dashboards, forms, searchable and filterable tables and charts.
It talks to both databases only through a server-side data-access layer using prepared statements and a
least-privilege MySQL account, with bcrypt-hashed passwords and signed session cookies. An automated suite of
{tests['total']} database test cases ({tests['passed']} passed) and manual end-to-end tests confirm that invalid
operations are rejected by the database and valid ones update all related data together.</p>''')

# ================================================================== 4. tech stack
section('stack', '4. Tech Stack', '''
<table><thead><tr><th>Layer</th><th>Technology</th><th>Used for</th></tr></thead><tbody>
<tr><td>Relational database</td><td>MySQL 8.0.46 (InnoDB)</td><td>Users, members, trainers, plans, memberships, payments, classes, bookings, PT sessions, attendance, audit log; views, stored procedures, functions, triggers, events, FULLTEXT search</td></tr>
<tr><td>NoSQL database</td><td>MongoDB 8.2.1</td><td>Workout plans and logs, exercise library, body metrics (time-series), notifications (TTL)</td></tr>
<tr><td>Web framework</td><td>Next.js 16.4.3 (App Router, React Server Components, Server Actions), React 19.3</td><td>Pages for the three roles, forms and server-side data access</td></tr>
<tr><td>Language / runtime</td><td>JavaScript (ES modules), Node.js 24.11</td><td>Application code, setup and seed scripts</td></tr>
<tr><td>Styling</td><td>Tailwind CSS 4.3</td><td>Responsive layout and components; charts are hand-made SVG</td></tr>
<tr><td>Database drivers</td><td>mysql2 3.24 (promise pool, prepared statements), mongodb 7.8 (official driver)</td><td>Connecting to MySQL and MongoDB</td></tr>
<tr><td>Security</td><td>bcryptjs 3.0 (password hashing), jose 6.2 (signed JWT session cookie)</td><td>Authentication and role-based access</td></tr>
<tr><td>Tools</td><td>MySQL Workbench, MongoDB Compass, ESLint 9, Git + GitHub, Microsoft Edge (headless, for screenshots and PDF)</td><td>Development, inspection, linting, version control, documentation</td></tr>
</tbody></table>''')

# ================================================================== 5. SQL commands
ddl_db = cut('db/mysql/01_schema.sql', r'^DROP DATABASE IF EXISTS', 'USE gym_db;')
ddl_users = cut('db/mysql/01_schema.sql', r'^CREATE TABLE users \(', ');')
ddl_members = cut('db/mysql/01_schema.sql', r'^CREATE TABLE members \(', ');')
ddl_payments = cut('db/mysql/01_schema.sql', r'^CREATE TABLE payments \(', ');')
ddl_bookings = cut('db/mysql/01_schema.sql', r'^CREATE TABLE class_bookings \(', ');')
ddl_alter = cut('db/mysql/01_schema.sql', r'^ALTER TABLE trainers ADD COLUMN', 'DROP TABLE tmp_import_members;')
ddl_view = cut('db/mysql/02_views.sql', r'^CREATE OR REPLACE VIEW v_class_schedule', 'GROUP BY cs.class_session_id;')
fn_status = cut('db/mysql/03_routines.sql', r'^CREATE FUNCTION fn_member_status', 'END$$')
sp_purchase = cut('db/mysql/03_routines.sql', r'^CREATE PROCEDURE sp_purchase_membership', 'END$$')
trg_cs = cut('db/mysql/04_triggers.sql', r'^CREATE TRIGGER trg_class_sessions_bi', 'END$$')
grant = cut('scripts/db-setup.mjs', r"CREATE USER IF NOT EXISTS", 'GRANT SELECT')

dml_insert = '''-- Admin creates a class (src/app/admin/actions.js); ends_at is filled by trg_class_sessions_bi
INSERT INTO class_sessions (class_type_id, trainer_id, room_id, starts_at, ends_at, capacity)
VALUES (?, ?, ?, ?, NULL, ?);

-- Admin adds a room / a class type (Gym setup page)
INSERT INTO rooms (name, capacity) VALUES (?, ?);
INSERT INTO class_types (name, description, intensity, duration_min) VALUES (?, ?, ?, ?);'''
dml_update = '''-- Refund (src/app/admin/actions.js) - both statements run in ONE transaction
SELECT payment_id, membership_id, amount FROM payments
WHERE payment_id = ? AND status = 'completed' FOR UPDATE;
UPDATE payments    SET status = 'refunded' WHERE payment_id = ?;
UPDATE memberships SET status = 'cancelled', frozen_from = NULL
WHERE membership_id = ? AND status <> 'cancelled';

-- Admin switches a plan on/off, member logs in
UPDATE membership_plans SET is_active = NOT is_active WHERE plan_id = ?;
UPDATE users SET last_login_at = NOW() WHERE user_id = ?;'''
dml_delete = '''-- Payments are never deleted: the BEFORE DELETE trigger refuses it
DELETE FROM payments WHERE payment_id = 1;
-- ERROR 1644 (45000): Payments cannot be deleted; refund them instead

-- Deleting a login account removes its member/trainer profile (FK ... ON DELETE CASCADE)
-- CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE'''

section('sql', '5. SQL — Database Commands (MySQL)', f'''
<p>All commands below are taken from the project files <code>db/mysql/01_schema.sql … 05_events.sql</code> and the
application code. Outputs were produced by running the queries on the demo database as the application account
<code>gym_app</code>.</p>
<h2>5.1 Database design</h2>
<p>The ER model (Figure 1) has strong entities USER, MEMBER, TRAINER, MEMBERSHIP_PLAN, MEMBERSHIP, PAYMENT, ROOM,
CLASS_TYPE, CLASS_SESSION, PT_SESSION and AUDIT_LOG, the weak entity ATTENDANCE, a disjoint partial specialisation of
USER into MEMBER and TRAINER, and the M:N relationship BOOKS. It maps to {n_tables} tables in third normal form
(Figure 2).</p>
<div class="wide">{figure(rotated_diagram('er-diagram'), 'ER diagram (Elmasri/Navathe notation with (min,max) participation)')}</div>
<div class="wide">{figure(rotated_diagram('relational-schema'), f'Relational schema: {n_tables} tables, {n_fk} foreign keys')}</div>

<h2>5.2 DDL — CREATE, ALTER, DROP, constraints, indexes, views</h2>
{code(ddl_db, title='Create the database (01_schema.sql)')}
{code(ddl_users, title='CREATE TABLE with PRIMARY KEY, UNIQUE, CHECK (regular expressions) and DEFAULT')}
{code(ddl_members, title='Subclass table: UNIQUE foreign key to users with ON DELETE CASCADE')}
{code(ddl_payments, title='Payments: two optional foreign keys + CHECK that exactly one is set; indexes')}
{code(ddl_bookings, title='M:N relationship BOOKS → class_bookings with a composite UNIQUE key')}
{code(ddl_alter, title='ALTER TABLE and CREATE / DROP TABLE')}
{code(ddl_view, title='CREATE VIEW (02_views.sql) — derived attribute seats_left')}
{code(grant, 'js', title='Least-privilege application account (scripts/db-setup.mjs)')}
<p>Other DDL objects: {len([i for i in schema['indexes'] if i['name'] != 'PRIMARY'])} secondary indexes (including two
FULLTEXT indexes) and {n_views} views — see the data dictionary in the full documentation.</p>

<h2>5.3 DML — INSERT, UPDATE, DELETE</h2>
{code(dml_insert, title='INSERT (from the application; ? = prepared-statement parameters)')}
{code(dml_update, title='UPDATE')}
{code(dml_delete, title='DELETE')}

<h2>5.4 SELECT queries — JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries, window functions, full-text</h2>
{q(1, 2, 3, 4, 5)}

<h2>5.5 Views</h2>
{q(6, 7)}

<h2>5.6 Functions and stored procedures (with transactions)</h2>
{code(fn_status, title='Stored function fn_member_status (03_routines.sql)')}
{q(9)}
{code(sp_purchase, title='Stored procedure sp_purchase_membership — transaction, row lock, renewal queued after the current plan')}
{q(10)}

<h2>5.7 Triggers</h2>
{code(trg_cs, title='trg_class_sessions_bi — end time, capacity ≤ room, no room clash, trainer free')}
{q(11, 12)}

<h2>5.8 Scheduled events</h2>
{q(13)}

<h2>5.9 Indexing</h2>
{q(14)}

<h2>5.10 Integrity enforced by the database</h2>
{md_to_html(INTEGRITY, shift=0, skip_title=False).replace('<h2>2. Integrity enforced by the database</h2>', '')}
''')

# ================================================================== 6. NoSQL commands
coll_validator = cut('db/mongo/collections.mjs', r"name: 'workout_logs'", "name: 'body_metrics'", include_end=False)
coll_ts = cut('db/mongo/collections.mjs', r"name: 'body_metrics'", "indexes:")
coll_create = cut('db/mongo/collections.mjs', r'^export async function createMongoCollections', 'createIndex') + '\n    }\n}'
idx_rows = ''
for m in schema['mongo']:
    for i in m['indexes']:
        if i['name'] == '_id_':
            continue
        extra = ' · unique' if i.get('unique') else ''
        if 'expireAfterSeconds' in i: extra += f" · TTL {i['expireAfterSeconds'] // 86400} days"
        if 'weights' in i: extra += ' · weights ' + ', '.join(f'{k} {v}' for k, v in i['weights'].items())
        idx_rows += f"<tr><td><code>{m['name']}</code></td><td><code>{esc(i['name'])}</code></td><td><code>{esc(json.dumps(i['key']))}</code>{esc(extra)}</td></tr>"
mongo_write = '''// Member logs a workout (src/app/member/actions.js) - checked by the $jsonSchema validator
db.workout_logs.insertOne({
  memberId: 55, planId: ObjectId("…"), performedAt: new Date(), durationMin: 60, rpe: 7,
  exercises: [{ exerciseId: ObjectId("…"), name: "Goblet Squat",
                sets: [{ reps: 12, weightKg: 10 }, { reps: 12, weightKg: 12.5 }] }],
  cardio: [{ activity: "Treadmill", minutes: 20, distanceKm: 3.1 }]
})

// Activate one plan, archive the others (only one active plan per member)
db.workout_plans.updateMany({ memberId: 55, status: "active" }, { $set: { status: "archived", updatedAt: new Date() } })
db.workout_plans.updateOne({ _id: ObjectId("…") }, { $set: { status: "active", updatedAt: new Date() } })

// Mark all notifications read
db.notifications.updateMany({ userId: 55, readAt: null }, { $set: { readAt: new Date() } })

// Member deletes a self-made plan (trainer plans are protected by trainerId: null in the filter)
db.workout_plans.deleteOne({ _id: ObjectId("…"), memberId: 55, trainerId: null })

// Read the member's plans (projection hides the large nested array)
db.workout_plans.find({ memberId: 55 }, { "days.exercises": 0 }).sort({ status: 1, createdAt: -1 })'''

section('nosql', '6. NoSQL Database Commands (MongoDB)', f'''
<p>MongoDB database <code>gym_mongo</code> has five collections. Vector search was optional in the brief and is
not used (listed as a future enhancement). Commands are taken from <code>db/mongo/collections.mjs</code> and the
application code.</p>
<div class="wide">{figure(rotated_diagram('mongodb-model'), 'MongoDB document model: collections, embedded documents, references and indexes')}</div>
<h2>6.1 Creating collections with schema validation</h2>
{code(coll_validator, 'js', title='workout_logs: $jsonSchema validator (required fields, types, ranges, enums, additionalProperties: false)')}
{code(coll_ts, 'js', title='body_metrics: time-series collection')}
{code(coll_create, 'js', title='How each collection is created (validationLevel strict, validationAction error)')}
<h2>6.2 Indexes</h2>
<table><thead><tr><th>Collection</th><th>Index</th><th>Keys / options</th></tr></thead><tbody>{idx_rows}</tbody></table>
<h2>6.3 Insert, update, delete and find</h2>
{code(mongo_write, 'js', title='CRUD commands used by the application (shell syntax)')}
<h2>6.4 Text search and aggregation pipelines</h2>
{q(17, 15, 16, 18, 19)}
<h2>6.5 Validation in action</h2>
{q(20)}
''')

# ================================================================== 7. project tree
COMMENTS = {
    'db/': 'database scripts',
    'db/mongo/collections.mjs': 'collections, validators, indexes',
    'db/mongo/exercises.mjs': 'exercise library data',
    'db/mysql/01_schema.sql': 'tables, keys, CHECK constraints, indexes, ALTER/DROP',
    'db/mysql/02_views.sql': '7 views',
    'db/mysql/03_routines.sql': 'functions + stored procedures (transactions)',
    'db/mysql/04_triggers.sql': 'triggers: validation, clashes, audit log',
    'db/mysql/05_events.sql': 'scheduled events (housekeeping)',
    'scripts/db-setup.mjs': 'builds both databases, creates gym_app account',
    'scripts/seed-data.mjs': 'realistic demo data (fixed random seed)',
    'src/proxy.js': 'role check before every protected page',
    'src/app/layout.js': 'root layout',
    'src/app/page.js': 'landing page',
    'src/app/actions/auth.js': 'server actions: login, register, logout',
    'src/app/login/page.js': 'login form',
    'src/app/register/page.js': 'member registration form',
    'src/app/admin/actions.js': 'server actions (admin): refunds, classes, plans',
    'src/app/admin/page.js': 'dashboard',
    'src/app/admin/check-in/page.js': 'front desk',
    'src/app/admin/members/page.js': 'members list, search, filters',
    'src/app/admin/members/[id]/page.js': 'member detail (dynamic route)',
    'src/app/admin/reports/page.js': 'reports (HAVING, RANK, NOT EXISTS)',
    'src/app/admin/setup/page.js': 'rooms, class types, trainers',
    'src/app/trainer/actions.js': 'server actions (trainer): PT, attendance, plans',
    'src/app/trainer/page.js': 'schedule',
    'src/app/trainer/members/page.js': 'members & workout plans',
    'src/app/member/actions.js': 'server actions (member): booking, PT, workouts',
    'src/app/member/page.js': 'member home',
    'src/app/member/training/page.js': 'full-text trainer search, PT requests',
    'src/app/member/workouts/page.js': 'progress (MongoDB aggregations)',
    'src/app/member/workouts/workout-logger.js': 'client component: log a workout',
    'src/app/member/workouts/new/plan-builder.js': 'client component: build own plan',
    'src/app/member/exercises/page.js': 'exercise library ($text search)',
    'src/components/charts.js': 'SVG charts',
    'src/components/forms.js': 'form wrapper (useActionState)',
    'src/lib/db.js': 'MySQL pool: sql(), callProcedure(), transaction()',
    'src/lib/mongo.js': 'MongoDB client',
    'src/lib/auth.js': 'getUser(), requireRole()',
    'src/lib/session.js': 'signed JWT session cookie',
    'src/lib/notifications.js': 'write notifications to MongoDB',
    '.env.example': 'env variable names (no secrets)',
    'package.json': 'dependencies and npm scripts',
    'next.config.mjs': 'Next.js configuration',
}
files = subprocess.run(['git', 'ls-files'], cwd=PROJECT, capture_output=True, text=True).stdout.split()
files = [f for f in files if not f.startswith(('.claude/', 'docs/')) and f not in ('AGENTS.md', 'package-lock.json')]
tree = {}
for f in files:
    node = tree
    parts = f.split('/')
    for p in parts[:-1]:
        node = node.setdefault(p + '/', {})
    node[parts[-1]] = None
lines = ['ironpulse-gym-management/']
def walk(node, prefix, path):
    keys = sorted(node, key=lambda k: (not k.endswith('/'), k.lower()))
    for i, k in enumerate(keys):
        last = i == len(keys) - 1
        full = path + k
        note = COMMENTS.get(full, '')
        label = f"{prefix}{'└── ' if last else '├── '}{k}"
        lines.append(f'{label:<52} {"# " + note if note else ""}'.rstrip())
        if node[k] is not None:
            walk(node[k], prefix + ('    ' if last else '│   '), full)
walk(tree, '', '')
section('tree', '7. Next.js — Project Tree Structure', f'''
<p>Source files in the repository (generated with <code>git ls-files</code>; <code>node_modules</code>, build output,
<code>.env.local</code> and the generated documentation are not listed). Each folder under <code>src/app</code> is a route:
<code>admin/</code>, <code>trainer/</code> and <code>member/</code> are the three role areas, each with its own
<code>layout.js</code> (navigation + role check) and <code>actions.js</code> (Server Actions that write to the databases).</p>
<pre class="code tree"><code>{esc(chr(10).join(lines))}</code></pre>''')

# ================================================================== 8. screenshots
CODE_SHOTS = [
    ('code-proxy', 'Route protection: proxy.js checks the signed session cookie and the role before every protected page'),
    ('code-db-helpers', 'Data-access layer: prepared statements, stored-procedure calls with OUT parameters, transactions'),
    ('code-refund-transaction', 'Server Action: refund = payment status + membership cancel in one transaction (row lock FOR UPDATE)'),
    ('code-sp-book-class', 'Stored procedure sp_book_class: transaction, row lock, business rules with SIGNAL, booked or waitlisted'),
    ('code-trigger-attendance', 'Trigger trg_attendance_bi: the database refuses frozen, expired and double check-ins'),
    ('code-mongo-validator', 'MongoDB $jsonSchema validator and indexes for workout_logs'),
    ('code-mongo-aggregation', 'MongoDB aggregation pipeline for weekly training volume'),
]
DEMO_SHOTS = [
    ('02-login', 'Login'),
    ('10-admin-dashboard', 'Admin dashboard: KPIs, monthly revenue (view), peak hours, renewals due, churn risk'),
    ('11-admin-front-desk', 'Front desk check-in / check-out by member code'),
    ('12-admin-members', 'Members table with search and filters'),
    ('17-admin-reports', 'Reports: revenue by plan, class popularity (HAVING), trainer performance, ranking (RANK)'),
    ('18-admin-gym-setup', 'Gym setup: rooms, class types and trainers'),
    ('20-trainer-home', 'Trainer schedule, PT requests and attendance'),
    ('31-member-classes', 'Member booking classes and joining waitlists'),
    ('32-member-training-search', 'Full-text trainer search "back pain" and PT request'),
    ('33-member-workouts', 'Workouts & progress: MongoDB aggregations, body-weight time series, workout logger'),
    ('35-member-exercises-search', 'Exercise library with weighted $text search'),
    ('36-member-membership', 'Buy, renew, freeze and unfreeze a membership'),
]
section('screenshots', '8. Sample Screenshots — Application Code and Demo', '<h2>8.1 Application code</h2>'
        + ''.join(screen(n, c, 2000) for n, c in CODE_SHOTS)
        + '<h2>8.2 Application demo</h2>' + ''.join(screen(n, c) for n, c in DEMO_SHOTS))

# ================================================================== 9. rubric
RUBRIC = [
    ('Real-world problem, unique title, beyond simple CRUD', 'Completed',
     'Gym operations with rules enforced in the DB (waitlist promotion, clash detection, freeze arithmetic, refunds, churn analytics)'),
    ('Team of 2 with defined responsibilities; both work on DB and app', 'Completed',
     'SUKRUTH: schema, views, core procedures, triggers, events, MongoDB design and most pages. Gagan: gym setup + sp_add_trainer, profile/password + trigger, PT-cancel notification + audit trigger, waitlist weekly-limit fix, cardio minutes + validator — each change touches both the database and the UI.'),
    ('SQL database + NoSQL database (two paradigms)', 'Completed', 'MySQL 8 gym_db + MongoDB 8 gym_mongo (§4, §5, §6)'),
    ('ER diagram, relational schema, keys, relationships, constraints', 'Completed', 'Figures 1–2, §5.1–5.2; full data dictionary in the full documentation'),
    ('NoSQL data model: collections, indexes', 'Completed', '§6, Figure 3'),
    ('DDL: CREATE, ALTER, DROP, PK/FK, constraints, indexes, views', 'Completed', f'§5.2 — {n_tables} tables, {n_fk} FKs, {n_chk} CHECKs, {n_views} views'),
    ('DML: INSERT/UPDATE/DELETE/SELECT with JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries', 'Completed', '§5.3–5.4 (Q1–Q5)'),
    ('At least 4 advanced features', 'Completed',
     f'Transactions + row locks, {n_views} views, {n_fn} functions / {n_sp} procedures, {n_trg} triggers, {n_ev} events, indexing + FULLTEXT, window function, NoSQL aggregation, time-series + TTL'),
    ('Vector / semantic search (optional)', 'Not done (optional)', 'Planned as a future enhancement'),
    ('Next.js UI with forms, tables, search, filtering, dashboards', 'Completed', '§8.2'),
    ('Backend/API layer, no hard-coded credentials (env variables)', 'Completed', 'Server Actions + src/lib data-access layer; .env.local (not in Git), .env.example'),
    ('Authentication with at least 2 roles', 'Completed', 'Admin, trainer, member; bcrypt; signed httpOnly JWT; proxy.js + requireRole()'),
    ('Input validation at database level; integrity and consistency', 'Completed', f'CHECKs, triggers, procedures (SIGNAL), $jsonSchema; §5.10; automated tests {tests["passed"]}/{tests["total"]} passed'),
    ('Security basics', 'Completed', 'Hashed passwords, prepared statements, least-privilege gym_app (no DDL), payments cannot be deleted, audit log'),
    ('Documentation', 'Completed', 'This report + full documentation (problem, objectives, scope, requirements, ER, schema, data dictionary, architecture, queries, tests, conclusion)'),
    ('Git/GitHub with individual commits; README with setup/run', 'Completed',
     'github.com/SUKRUTH-ES/ironpulse-gym-management: 4 commits by SUKRUTH-ES, 6 commits by gags6030-sudo merged through pull request #1 (merge commit a8127c3); README with setup and run steps'),
    ('Demo: design, schema, queries, UI, integration, advanced features, test cases, contributions', 'Ready', 'Demo script prepared (docs/demo-script.md)'),
    ('Database choice justified by the nature of the data', 'Completed', 'Relational for money/slots/capacity; documents for nested, variable training data; time-series and TTL where they fit'),
]
badge = {'Completed': 'ok', 'Ready': 'ok', 'In progress': 'warn', 'Not done (optional)': 'off'}
rub = ''.join(f'<tr><td>{i}</td><td>{esc(c)}</td><td><span class="badge {badge[s]}">{esc(s)}</span></td><td>{esc(e)}</td></tr>'
              for i, (c, s, e) in enumerate(RUBRIC, 1))
done = sum(s in ('Completed', 'Ready') for _, s, _ in RUBRIC)
section('rubric', '9. Evaluation Rubrics — Completion Status', f'''
<p><strong>{done} of {len(RUBRIC)} criteria completed</strong>{f"; {sum(s == 'In progress' for _, s, _ in RUBRIC)} in progress" if any(s == 'In progress' for _, s, _ in RUBRIC) else ''};
the only open item is the optional vector search, which was not implemented.</p>
<table class="rubric"><thead><tr><th>#</th><th>Criterion (from the project brief)</th><th>Status</th><th>Evidence</th></tr></thead><tbody>{rub}</tbody></table>
<h2>Test summary</h2>
<p>{tests['passed']} of {tests['total']} automated database tests passed (run with <code>node docs/tools/run-tests.mjs</code> on a
separate copy of the database, as the application account): registration, memberships and payments, front desk, classes
and waitlist, personal training, scheduled events, least privilege and MongoDB validation. The complete table with inputs,
expected and actual results is in the full documentation.</p>''')

# ------------------------------------------------------------------ contents + page
toc_items = re.findall(r'<section id="([^"]+)"><h1>([^<]+)</h1>', ''.join(S))
toc = ('<section class="toc"><h1>Contents</h1><ol class="toc"><li>1. Title</li><li>2. Students SRN and Name</li>'
       + ''.join(f'<li><a href="#{i}">{t}</a></li>' for i, t in toc_items) + '</ol></section>')
CSS = '''
@page { size: A4; margin: 16mm 15mm 18mm 15mm;
        @bottom-center { content: "IronPulse — DBMS Level 3 Project · page " counter(page); font: 8.5pt "Segoe UI", Arial, sans-serif; color: #666; } }
@page cover { @bottom-center { content: none; } }
* { box-sizing: border-box; }
body { font: 10.5pt/1.5 "Segoe UI", Arial, sans-serif; color: #1f2933; margin: 0; }
h1 { font-size: 20pt; color: #0f766e; margin: 0 0 10pt; padding-bottom: 4pt; border-bottom: 2px solid #0f766e; }
h2 { font-size: 14pt; color: #134e4a; margin: 16pt 0 6pt; break-after: avoid; }
h3, h4 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid; }
section { break-before: page; }
section.cover { page: cover; break-before: auto; text-align: center; padding-top: 50mm; }
.brand { font-size: 12pt; letter-spacing: 1px; color: #0f766e; font-weight: 600; }
.title { font-size: 38pt; border: none; color: #111; margin: 10pt 0 2pt; }
.subtitle { font-size: 15pt; color: #444; margin-bottom: 28pt; }
table.team { margin: 0 auto 28pt; width: 64%; font-size: 12pt; }
table.team td, table.team th { padding: 6pt 10pt; }
.meta { color: #444; font-size: 11pt; }
ol.toc { font-size: 12.5pt; line-height: 2.1; list-style: none; padding-left: 0; }
ol.toc a { color: #1f2933; text-decoration: none; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
code { font: 8.8pt Consolas, monospace; background: #f1f5f4; padding: 0 2px; border-radius: 2px; }
.codetitle { font-size: 9pt; font-weight: 600; color: #134e4a; margin: 10pt 0 2pt; break-after: avoid; }
pre.code { font: 8pt/1.35 Consolas, monospace; background: #f7f9f9; border: 1px solid #dfe7e6; border-left: 3px solid #0f766e;
           padding: 6pt 8pt; white-space: pre-wrap; word-break: break-word; margin: 0 0 8pt; }
pre.code code { background: none; padding: 0; font: inherit; }
pre.tree { font-size: 8.4pt; line-height: 1.32; white-space: pre; }
table { width: 100%; border-collapse: collapse; margin: 0 0 10pt; font-size: 8.6pt; }
th, td { border: 1px solid #d5dedd; padding: 3pt 5pt; text-align: left; vertical-align: top; overflow-wrap: break-word; }
td code { overflow-wrap: anywhere; }
th { background: #e6f2f0; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
figure { margin: 8pt 0 14pt; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; border: 1px solid #ccd6d4; }
figure.screen img { max-height: 225mm; }
figcaption { font-size: 9pt; color: #555; margin-top: 4pt; }
.wide { break-before: page; break-after: page; }
.wide figure { margin: 0; }
.wide figure img { max-height: 250mm; border: none; }
.todo { background: #fff3c4; border: 1px solid #e9c46a; padding: 0 4pt; }
.badge { display: inline-block; padding: 1pt 6pt; border-radius: 8pt; font-weight: 600; white-space: nowrap; }
.badge.ok { background: #d1fae5; color: #065f46; } .badge.warn { background: #fef3c7; color: #92400e; } .badge.off { background: #e5e7eb; color: #374151; }
table.rubric td:first-child { width: 18pt; text-align: center; }
'''
doc = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>IronPulse — Project Report</title>
<style>{CSS}</style></head><body>{cover}{toc}{''.join(S)}</body></html>'''
doc = doc.replace('[SRN]', '<span class="todo">[SRN]</span>').replace('[Section]', '<span class="todo">[Section]</span>')
out = os.path.join(DOCS, 'IronPulse-Report.html')
open(out, 'w', encoding='utf-8').write(doc)
print('wrote', out, f'({FIG[0]} figures)')
pdf = os.path.join(DOCS, 'IronPulse-Report.pdf')
subprocess.run([r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', '--headless=new', '--disable-gpu',
                '--no-pdf-header-footer', f'--print-to-pdf={pdf}', 'file:///' + out.replace('\\', '/')], capture_output=True, timeout=180)
print('wrote', pdf, os.path.getsize(pdf) // 1024, 'KB')

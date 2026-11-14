# Builds the detailed documentation: docs/IronPulse-Full-Documentation.html (+ PDF with headless Edge).
# The course-format report is built by build_report.py.
# It reuses the generated documents (data dictionary, important queries, test cases),
# the diagrams and the screenshots, so re-run those generators first after any change.
# Run from the project root:  python docs/tools/build_full_report.py
import html, json, os, re, subprocess, datetime, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))      # docs/
schema = json.load(open(os.path.join(ROOT, 'tools', 'schema.json'), encoding='utf-8'))
tests = json.load(open(os.path.join(ROOT, 'test-results.json'), encoding='utf-8'))
esc = html.escape

# ------------------------------------------------------------------ fill these in
TEAM = [
    # (name, USN, GitHub login)
    ('SUKRUTH ES', 'PES1UG24CS160', 'SUKRUTH-ES'),
    ('Gagan Eswar', 'PES1UG24CS165', 'gags6030-sudo'),
]
SECTION = 'C'
REPO = 'https://github.com/SUKRUTH-ES/ironpulse-gym-management'

from mdlite import md_to_html  # tiny markdown converter (docs/tools/mdlite.py)

def md_file(name, shift):
    return md_to_html(open(os.path.join(ROOT, name), encoding='utf-8').read(), shift=shift)

# ------------------------------------------------------------------ report-sized copies of tall screenshots
ASSETS = os.path.join(ROOT, 'report-assets')
os.makedirs(ASSETS, exist_ok=True)
def shot(name, max_h=1850):
    src = os.path.join(ROOT, 'screenshots', name + '.png')
    im = Image.open(src)
    if im.height <= max_h:
        return f'screenshots/{name}.png', False
    im.crop((0, 0, im.width, max_h)).save(os.path.join(ASSETS, name + '.png'))
    return f'report-assets/{name}.png', True

def diagram(name):
    # copy of a diagram with the white border trimmed, so it can fill a landscape page
    from PIL import ImageOps
    im = Image.open(os.path.join(ROOT, 'diagrams', name + '.png')).convert('RGB')
    box = ImageOps.invert(im).getbbox()
    pad = 12
    box = (max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, im.width), min(box[3] + pad, im.height))
    # rotated 90° so the wide diagram fills a portrait page (read it with the page turned left)
    im.crop(box).rotate(90, expand=True).save(os.path.join(ASSETS, name + '.png'))
    return f'report-assets/{name}.png'

def figure(path, caption, cls=''):
    figure.n += 1
    return f'<figure class="{cls}"><img src="{path}" alt=""><figcaption>Figure {figure.n}: {caption}</figcaption></figure>'
figure.n = 0

def screen(name, caption):
    p, cut = shot(name)
    return figure(p, caption + (' (top part of the page)' if cut else ''), 'screen')

# ------------------------------------------------------------------ numbers from the live schema
n_tables, n_fk, n_chk = len(schema['tables']), len(schema['fks']), len(schema['checks'])
n_views, n_trg, n_ev = len(schema['views']), len(schema['triggers']), len(schema['events'])
n_fn = sum(r['type'] == 'FUNCTION' for r in schema['routines'])
n_sp = sum(r['type'] == 'PROCEDURE' for r in schema['routines'])
n_idx = len([i for i in schema['indexes'] if i['name'] != 'PRIMARY'])
rows = schema['rowCounts']
mongo_counts = {m['name']: m['count'] for m in schema['mongo']}
today = datetime.date.today().strftime('%d %B %Y')

S = []   # body sections
def section(id_, title, body):
    S.append(f'<section id="{id_}"><h1>{title}</h1>{body}</section>')

# ================================================================== 1. problem
section('problem', '1. Problem Statement and Motivation', f'''
<p>A typical neighbourhood gym runs on a register book, a spreadsheet of members and a WhatsApp group. That works for
fifty people but breaks as the gym grows: memberships expire without anyone noticing, popular classes are overbooked
while others stay empty, two trainers get booked into the same room, payments are hard to reconcile, and nobody can say
which members are about to stop coming.</p>
<p><strong>IronPulse</strong> is a web-based gym management system that replaces this with one source of truth. It covers
the whole member life-cycle — registration, buying and renewing plans, freezing them, checking in at the front desk,
booking group classes with an automatic waitlist, requesting personal training, following workout plans and logging
workouts — and gives the owner live business reports.</p>
<p>The problem is a good fit for a <em>polyglot</em> database design. Money, capacity and time slots need strict
consistency (ACID transactions, constraints, triggers), which is why they live in <strong>MySQL</strong>. Workout plans,
workout logs and body measurements are deeply nested, change shape often and are mostly read as whole documents, which
is why they live in <strong>MongoDB</strong>. The project is therefore not a CRUD form over one table: the business rules
are enforced inside the databases themselves.</p>''')

# ================================================================== 2. objectives
section('objectives', '2. Objectives', '''
<ol>
<li>Design a normalised relational schema (ER model → relations) for members, plans, memberships, payments, classes,
bookings, personal training and attendance, with every rule that can be expressed declaratively written as a key,
foreign key or CHECK constraint.</li>
<li>Enforce the remaining business rules <em>in the database</em> with triggers, stored procedures and functions, so the
data stays correct even if the application has a bug.</li>
<li>Use transactions and row locks for operations that touch several rows (buying a plan, booking the last seat,
promoting from the waitlist, completing a paid PT session).</li>
<li>Model training data as MongoDB documents with schema validation, and compute progress statistics with aggregation
pipelines.</li>
<li>Build a Next.js web interface with three roles (admin, trainer, member), forms, tables, search, filters and
dashboards, connected through a server-side data-access layer.</li>
<li>Apply security basics: hashed passwords, signed session cookies, role checks on every page and action, credentials
only in environment variables, and a least-privilege database account for the app.</li>
<li>Prove correctness with an automated test suite that runs against the real databases.</li>
</ol>''')

# ================================================================== 3. scope
section('scope', '3. Scope', '''
<table><thead><tr><th>In scope</th><th>Out of scope (see Future enhancements)</th></tr></thead><tbody><tr><td><ul>
<li>One gym branch with several rooms</li>
<li>Three roles: admin (owner / front desk), trainer, member</li>
<li>Membership plans with duration, price, weekly class limit, included PT sessions and freeze days</li>
<li>Payments in cash / card / UPI / net banking (recorded, not processed); refunds</li>
<li>Group classes with capacity, waitlist and attendance; personal training requests</li>
<li>Front-desk check-in / check-out by member code</li>
<li>Workout plans (by a trainer or self-made), workout logs, body weight, exercise library</li>
<li>In-app notifications; reports and dashboards</li>
</ul></td><td><ul>
<li>Real online payment gateway</li>
<li>Multiple branches / franchise management</li>
<li>E-mail or SMS delivery and password reset by e-mail</li>
<li>Mobile app, biometric or QR check-in hardware</li>
<li>Payroll and inventory</li>
<li>Vector / semantic search (optional in the brief, not implemented)</li>
</ul></td></tr></tbody></table>''')

# ================================================================== 4. functional requirements
FR = [
    ('Authentication', [
        ('FR-1', 'Visitors can register as a member; the database rejects ages outside 14–100, invalid phones/e-mails and duplicates.'),
        ('FR-2', 'Users log in with e-mail and password; sessions last 8 hours; deactivated users lose access immediately.'),
        ('FR-3', 'Every page and action checks the role (admin / trainer / member); other roles are redirected.'),
        ('FR-4', 'Members can edit their profile and change their password.')]),
    ('Admin', [
        ('FR-5', 'Dashboard: active members, people in the gym now, revenue this month vs last, renewals due, churn risk, revenue chart, peak-hour heat map, today\'s classes.'),
        ('FR-6', 'Front desk: check members in and out by member code; refuse expired or frozen members and double check-ins.'),
        ('FR-7', 'Members: search and filter by status / plan; member detail with history; sell plans and renewals; deactivate.'),
        ('FR-8', 'Payments: list and filter; refund (cancels the membership and notifies the member); payments are never deleted.'),
        ('FR-9', 'Classes: create classes up to 7 days ahead (no room or trainer clash, capacity ≤ room); cancel a class (bookings cancelled, members notified).'),
        ('FR-10', 'Plans: create plans and switch them off; Gym setup: add rooms, class types and trainers.'),
        ('FR-11', 'Reports: revenue by plan and by method, class popularity, trainer performance, most consistent members, churn risk, never-booked members, audit log.')]),
    ('Trainer', [
        ('FR-12', 'Weekly schedule of classes and PT sessions; confirm, decline or complete PT requests (payment recorded in the same transaction).'),
        ('FR-13', 'Take attendance for a class (editable for 2 days); create workout plans for members; receive notifications.')]),
    ('Member', [
        ('FR-14', 'Buy, renew, freeze and unfreeze a membership.'),
        ('FR-15', 'Book classes; join the waitlist when full; automatic promotion when a seat frees up (respecting the weekly limit).'),
        ('FR-16', 'Search trainers in plain words (full-text) and request PT sessions (≥ 2 h ahead, 06:00–22:00, no clashes).'),
        ('FR-17', 'Follow a trainer\'s plan or build their own; add private exercises; search the exercise library.'),
        ('FR-18', 'Log workouts (strength sets, timed holds, cardio in minutes) and body weight; see weekly volume, personal records and weight trend.'),
        ('FR-19', 'Receive notifications (waitlist promotion, class cancelled, PT updates, new plan, renewal reminder).')]),
]
fr_html = ''
for grp, items in FR:
    fr_html += f'<h3>{grp}</h3><table class="fr"><tbody>' + ''.join(f'<tr><td class="id">{i}</td><td>{esc(t)}</td></tr>' for i, t in items) + '</tbody></table>'
section('requirements', '4. Functional and Non-functional Requirements', fr_html + '''
<h3>Non-functional</h3>
<ul>
<li><strong>Integrity:</strong> invalid data is refused by the database (constraints, triggers, validators), not only by the forms.</li>
<li><strong>Concurrency:</strong> two people booking the last seat or buying overlapping plans at the same moment cannot both succeed (row locks).</li>
<li><strong>Security:</strong> bcrypt password hashes, httpOnly signed JWT cookie, prepared statements, no credentials in code, app account without DDL rights.</li>
<li><strong>Auditability:</strong> every change to memberships, payments and PT sessions is written to <code>audit_log</code> by triggers.</li>
<li><strong>Maintainability:</strong> plain JavaScript and raw SQL (no ORM) so every query can be explained; one script rebuilds both databases.</li>
</ul>''')

# ================================================================== 5. architecture
section('architecture', '5. System Architecture', f'''
<div class="wide">{figure(diagram('architecture'), 'System architecture')}</div>
<p>IronPulse is a three-tier web application.</p>
<ul>
<li><strong>Presentation:</strong> pages are React Server Components rendered on the server, so the browser receives
ready HTML (tables, forms, SVG charts). Forms submit to <em>Server Actions</em>; a few small client components only keep
form state and show messages.</li>
<li><strong>Application / API layer:</strong> the Next.js 16 server. <code>src/proxy.js</code> checks the session cookie
before any protected page; every page and action then calls <code>requireRole()</code> from <code>src/lib/auth.js</code>,
which verifies the JWT and re-reads the user from MySQL. <code>src/lib/db.js</code> wraps a <code>mysql2</code>
connection pool (prepared statements, <code>callProcedure()</code> for stored procedures, <code>transaction()</code>
for multi-statement work) and <code>src/lib/mongo.js</code> holds one shared MongoDB client.</li>
<li><strong>Data:</strong> MySQL 8 (<code>gym_db</code>) and MongoDB 8 (<code>gym_mongo</code>). The app connects to
MySQL as <code>gym_app</code>, which may only SELECT, INSERT, UPDATE, DELETE and EXECUTE. Tables, triggers, routines and
events are created once by <code>npm run db:setup</code> using the MySQL root account.</li>
</ul>
<p>All connection settings and the session secret come from <code>.env.local</code>, which is not in Git
(<code>.env.example</code> lists the names).</p>''')

# ================================================================== 6. design
section('design', '6. Database Design', f'''
<h2>6.1 ER diagram</h2>
<div class="wide">{figure(diagram('er-diagram'), 'ER diagram (Elmasri/Navathe notation with (min,max) participation)')}</div>
<p>Notation: rectangles are entity types, diamonds relationship types, ovals attributes (key attributes underlined,
derived attributes dashed). A double line means total participation (min ≥ 1); each line carries the (min,max) pair of the
entity it touches.</p>
<ul>
<li><strong>Specialisation:</strong> USER is specialised (disjoint, partial) into MEMBER and TRAINER. Admins are users that
belong to neither subclass.</li>
<li><strong>Weak entity:</strong> ATTENDANCE (a visit) has no identity of its own; it is identified by its owner MEMBER through
the identifying relationship CHECKS_IN and the partial key Check_in.</li>
<li><strong>M:N relationship with attributes:</strong> BOOKS between MEMBER and CLASS_SESSION carries Status and Booked_at
(Booked_at decides the waitlist order).</li>
<li><strong>Composite attribute:</strong> Emergency_contact(Name, Phone). <strong>Derived:</strong> Age, Days_left,
Seats_left, Duration — computed in views, never stored.</li>
<li><strong>Roles:</strong> a PAYMENT is made by a member (<em>Payer</em>) and may be recorded by a staff user
(<em>Recorder</em>); a PAYMENT pays for exactly one MEMBERSHIP or one PT_SESSION.</li>
<li>AUDIT_LOG stands alone: it is written only by triggers and refers to rows by table name and id.</li>
</ul>

<h2>6.2 Mapping the ER model to relations</h2>
<table><thead><tr><th>ER construct</th><th>Relational design</th></tr></thead><tbody>
<tr><td>Strong entities</td><td>One table each with a surrogate AUTO_INCREMENT primary key; natural keys (email, phone, member_code, plan/room/class-type names, transaction_ref) are UNIQUE.</td></tr>
<tr><td>USER specialisation</td><td>Superclass table <code>users</code> (with <code>role</code>) plus one table per subclass (<code>members</code>, <code>trainers</code>) whose <code>user_id</code> is a UNIQUE foreign key, ON DELETE CASCADE.</td></tr>
<tr><td>1:N relationships (HOLDS, OF_PLAN, TEACHES, OF_TYPE, HELD_IN, REQUESTS, CONDUCTS, MAKES, RECORDS)</td><td>Foreign key on the N side; NOT NULL where participation is total.</td></tr>
<tr><td>PAYS_FOR / COVERS</td><td>Two nullable foreign keys in <code>payments</code> plus <code>CHECK chk_payments_target</code>: exactly one of them is set.</td></tr>
<tr><td>M:N BOOKS</td><td>Table <code>class_bookings</code> with both foreign keys, UNIQUE(class_session_id, member_id) and the relationship attributes.</td></tr>
<tr><td>Weak ATTENDANCE</td><td>Table <code>attendance</code> with the owner's key <code>member_id</code>; a surrogate key replaces (member_id, check_in) for simpler references.</td></tr>
<tr><td>Composite attribute</td><td>Flattened into <code>emergency_contact_name</code>, <code>emergency_contact_phone</code>.</td></tr>
<tr><td>Derived attributes</td><td>Computed in views (<code>v_member_overview.age</code>, <code>v_current_memberships.days_left</code>, <code>v_class_schedule.seats_left</code>).</td></tr>
</tbody></table>

<h2>6.3 Relational schema</h2>
<div class="wide">{figure(diagram('relational-schema'), f'Relational schema: {n_tables} tables and {n_fk} foreign keys (generated from information_schema)')}</div>

<h2>6.4 Normalisation</h2>
<p>All tables are in third normal form: every non-key column depends on the whole key and only on the key. Repeating or
multi-valued data was split out (a member's memberships, a class's bookings, a member's visits), and descriptive data is
stored once (plan details in <code>membership_plans</code>, room capacity in <code>rooms</code>, trainer rates in
<code>trainers</code>). Values that could be derived are not stored; they are computed by views.</p>
<p>Three columns look redundant but are deliberate:</p>
<ul>
<li><code>pt_sessions.price</code> and <code>class_sessions.capacity</code> are snapshots: a trainer's rate or a room
may change later, but a past session must keep the price and capacity it had.</li>
<li><code>payments.member_id</code> records the payer directly, so payment history needs no join through two optional
foreign keys.</li>
<li><code>members.member_code</code> is the code printed on the card. It is derived from <code>user_id</code> once, at
registration, and its format is guarded by a CHECK constraint.</li>
</ul>

<h2>6.5 MongoDB document model</h2>
<div class="wide">{figure(diagram('mongodb-model'), 'MongoDB collections, fields, references and indexes')}</div>
<p>Embedding was chosen where data is always read together (a plan's days and exercises; a log's sets). References are
used across databases: <code>memberId</code>, <code>trainerId</code> and <code>userId</code> hold MySQL primary keys,
and the app checks them in MySQL before writing to MongoDB. Inside MongoDB, logs point to plans and exercises by
ObjectId.</p>

<h2>6.6 Database choice and justification</h2>
<table><thead><tr><th>Data</th><th>Where</th><th>Why</th></tr></thead><tbody>
<tr><td>Users, members, trainers, plans, memberships, payments</td><td>MySQL</td><td>Money and entitlements must be exact. Foreign keys, CHECK constraints and ACID transactions guarantee, for example, that a refund and its membership cancellation happen together.</td></tr>
<tr><td>Classes, bookings, PT sessions, attendance</td><td>MySQL</td><td>Capacity and time-slot rules need row locks and triggers (no double-booking, waitlist order, clash detection), and reports need JOINs, GROUP BY and window functions.</td></tr>
<tr><td>Workout plans and logs</td><td>MongoDB</td><td>Naturally nested (plan → days → exercises; log → exercises → sets) with a variable shape (weights, timed holds, cardio). One document read replaces 4–5 joins, and the aggregation pipeline computes progress.</td></tr>
<tr><td>Body measurements</td><td>MongoDB time-series</td><td>Append-only measurements over time; the time-series collection stores and groups them efficiently.</td></tr>
<tr><td>Notifications</td><td>MongoDB</td><td>Short-lived inbox items with free-form metadata; a TTL index deletes them after 60 days.</td></tr>
<tr><td>Exercise library</td><td>MongoDB</td><td>Arrays of muscles, equipment, tags and instructions; a weighted text index gives ranked search.</td></tr>
</tbody></table>''')

# ================================================================== 7. data dictionary
section('dictionary', '7. Data Dictionary', md_file('data-dictionary.md', 1).replace("','", "', '"))

# ================================================================== 8. implementation
section('implementation', '8. Implementation', f'''
<h2>8.1 SQL (MySQL 8)</h2>
<table><thead><tr><th>Object</th><th>Count</th><th>Where / examples</th></tr></thead><tbody>
<tr><td>Tables</td><td>{n_tables}</td><td><code>db/mysql/01_schema.sql</code> — CREATE TABLE with PK, FK, UNIQUE, CHECK, DEFAULT; also an <code>ALTER TABLE trainers ADD COLUMN accepts_pt</code> and a CREATE/DROP of a temporary import table to show DDL changes</td></tr>
<tr><td>Foreign keys / CHECK constraints</td><td>{n_fk} / {n_chk}</td><td>e.g. <code>chk_payments_target</code>, <code>chk_memberships_frozen</code>, phone and e-mail patterns with <code>REGEXP_LIKE</code></td></tr>
<tr><td>Secondary indexes</td><td>{n_idx}</td><td>composite indexes for the common lookups, two FULLTEXT indexes (<code>trainers</code>, <code>class_types</code>)</td></tr>
<tr><td>Views</td><td>{n_views}</td><td><code>02_views.sql</code> — current memberships, member overview, expiring memberships, class schedule, monthly revenue, trainer performance, churn risk</td></tr>
<tr><td>Functions / procedures</td><td>{n_fn} / {n_sp}</td><td><code>03_routines.sql</code> — register, add trainer, purchase, freeze, unfreeze, book class, cancel booking (with waitlist promotion), book PT, check-in, check-out; every multi-step procedure is a transaction with an EXIT HANDLER that rolls back</td></tr>
<tr><td>Triggers</td><td>{n_trg}</td><td><code>04_triggers.sql</code> — validation (age, overlaps, capacity, clashes, frozen check-in), automatic values (end dates, lower-case e-mail, password_changed_at), cascades (cancel class → cancel bookings), audit log, payments that cannot be edited or deleted</td></tr>
<tr><td>Events</td><td>{n_ev}</td><td><code>05_events.sql</code> — daily expiry of memberships; every 15 minutes close finished classes, mark no-shows, close forgotten visits, cancel stale PT requests</td></tr>
</tbody></table>
<p>Business errors are raised with <code>SIGNAL SQLSTATE '45000'</code> and a readable message. The app shows that
message in the form, so the database is the single place where rules live.</p>

<h2>8.2 NoSQL (MongoDB 8)</h2>
<ul>
<li>Five collections created by <code>db/mongo/collections.mjs</code>: exercises ({mongo_counts.get('exercises', 0)} documents now),
workout_plans ({mongo_counts.get('workout_plans', 0)}), workout_logs ({mongo_counts.get('workout_logs', 0)}),
body_metrics ({mongo_counts.get('body_metrics', 0)}, time-series) and notifications ({mongo_counts.get('notifications', 0)}).</li>
<li><code>$jsonSchema</code> validators (validationLevel strict, validationAction error) with types, ranges, enums,
required fields and <code>additionalProperties: false</code> on workout sets.</li>
<li>Indexes: unique slug, compound indexes for "my plans" and "my recent logs", a multikey index on
<code>exercises.exerciseId</code>, a weighted text index, and a TTL index.</li>
<li>Aggregation pipelines for weekly volume (<code>$unwind</code>, <code>$group</code> with <code>$dateTrunc</code>),
personal records (<code>$sort</code> + <code>$first</code>), popular exercises and each trainer's member activity.</li>
</ul>

<h2>8.3 Integration with the application</h2>
<ul>
<li>Every SQL statement uses <code>?</code> placeholders (prepared statements), so user input can never change the query.</li>
<li>Procedures are called through <code>callProcedure(name, inArgs, outNames)</code>, which reads the OUT parameters.</li>
<li>Operations spanning several statements in the app (refund = payment status + membership cancel; completing a PT
session = status + payment) run inside <code>transaction()</code>, which commits or rolls back as one unit.</li>
<li>Passwords are hashed with bcrypt (cost 12). The session is a JWT signed with <code>SESSION_SECRET</code> (HS256, 8 hours)
in an httpOnly, sameSite=lax cookie.</li>
<li>Cross-database writes check MySQL first (e.g. a member must exist and be active before a plan is stored for them).</li>
</ul>''')

# ================================================================== 9. queries
section('queries', '9. Important Queries', md_file('important-queries.md', 1))

# ================================================================== 10. screenshots
SHOTS = [
    ('01-landing', 'Landing page'), ('02-login', 'Login'), ('03-register', 'Member registration'),
    ('10-admin-dashboard', 'Admin dashboard: KPIs, revenue by month (view v_monthly_revenue), peak hours, renewals due, churn risk'),
    ('11-admin-front-desk', 'Front desk check-in / check-out (sp_check_in, trg_attendance_bi)'),
    ('12-admin-members', 'Members list with search and status / plan filters'),
    ('13-admin-member-detail', 'Member detail: membership history, payments, visits, selling a plan'),
    ('14-admin-classes', 'Class timetable and class creation'),
    ('15-admin-payments', 'Payments with filters and refunds'),
    ('16-admin-plans', 'Membership plans'),
    ('17-admin-reports', 'Reports: GROUP BY, HAVING, RANK(), NOT EXISTS, churn view, audit log'),
    ('18-admin-gym-setup', 'Gym setup: rooms, class types and trainers'),
    ('20-trainer-home', 'Trainer schedule, PT requests and class attendance'),
    ('21-trainer-members', 'Trainer: members, their activity (MongoDB aggregation) and the plan builder'),
    ('30-member-home', 'Member home: membership, visits, upcoming bookings, notifications'),
    ('31-member-classes', 'Booking classes and joining waitlists'),
    ('32-member-training-search', 'Full-text trainer search for "back pain" (MATCH … AGAINST) and PT request'),
    ('33-member-workouts', 'Workouts & progress: weekly volume and personal records (MongoDB aggregation), body-weight time series, workout logger'),
    ('34-member-plan-builder', 'Building an own workout plan'),
    ('35-member-exercises-search', 'Exercise library with weighted $text search for "shoulder press"'),
    ('36-member-membership', 'Membership: buy, renew, freeze / unfreeze'),
    ('37-member-profile', 'Profile and password change'),
    ('40-access-denied-redirect', 'A trainer opening /admin is redirected to the trainer area'),
]
section('screenshots', '10. Screenshots', ''.join(screen(n, c) for n, c in SHOTS))

# ================================================================== 11. testing
section('testing', '11. Testing', md_file('test-cases.md', 1))

# ================================================================== 12. contributions
section('contributions', '12. Individual Contributions', f'''
<p>Commit history on GitHub: 4 commits by <code>SUKRUTH-ES</code>; 6 commits by <code>gags6030-sudo</code>, merged into
<code>main</code> through pull request #1.</p>
<table><thead><tr><th>Member</th><th>Database work</th><th>Application work</th></tr></thead><tbody>
<tr><td><strong>{esc(TEAM[0][0])}</strong><br>{esc(TEAM[0][1])}<br><code>{TEAM[0][2]}</code></td>
<td>ER model and relational schema; tables, constraints and indexes; views; core procedures and functions (registration,
purchase, freeze, booking with waitlist, PT booking, check-in); validation, clash and audit triggers; scheduled events;
MongoDB collections, validators and indexes; least-privilege account; seed data</td>
<td>Project setup; authentication, sessions and role protection; data-access layer; admin dashboard, front desk, members,
classes, payments, plans and reports; trainer pages; member booking, training, workouts, exercises and membership pages;
charts; end-to-end testing and documentation</td></tr>
<tr><td><strong>{esc(TEAM[1][0])}</strong><br>{esc(TEAM[1][1])}<br><code>{TEAM[1][2]}</code></td>
<td><code>sp_add_trainer</code> (user + trainer in one transaction); <code>password_changed_at</code> column and trigger;
<code>trg_pt_sessions_au</code> audit trigger; weekly-limit check in <code>sp_cancel_class_booking</code>'s waitlist
promotion; validator change for cardio minutes</td>
<td>Admin Gym setup page; member profile and change-password page; trainer notification when a member cancels PT;
waitlist message on the classes page; workout logger in minutes for cardio</td></tr>
</tbody></table>''')

# ================================================================== 13. conclusion
section('conclusion', '13. Conclusion and Future Enhancements', f'''
<p>IronPulse meets the project brief with a MySQL + MongoDB design in which each database stores the data it suits best.
The relational side keeps money, capacity and schedules consistent through {n_chk} CHECK constraints, {n_trg} triggers,
{n_sp} stored procedures and transactional row locks; the document side stores nested training data with schema
validation and computes progress with aggregation pipelines. The Next.js interface gives three roles their own
workflows, and every rule shown in the interface is enforced again in the database. The automated suite
({tests['passed']} of {tests['total']} cases passed) and the manual browser tests show that invalid operations are refused
with clear messages and valid ones update every related row together.</p>
<p>What we learned: moving rules into the database (triggers and procedures instead of only form checks) made the app code
smaller and removed a whole class of bugs; and picking the database by the shape of the data made both sides simpler than
forcing everything into one model.</p>
<h3>Future enhancements</h3>
<ul>
<li><strong>Semantic search:</strong> store exercise and trainer-bio embeddings (e.g. in MongoDB Atlas Vector Search or
pgvector) so "something for my knees" finds low-impact exercises without matching words.</li>
<li>Online payments through a payment gateway with webhooks, replacing the simulated member self-purchase.</li>
<li>E-mail / SMS reminders for renewals and classes, and password reset by e-mail.</li>
<li>QR-code check-in at the door and a mobile app.</li>
<li>Multi-branch support (a <code>branches</code> table, branch-scoped admins and reports).</li>
<li>More flexible trainer plan builder (more than 3 days, custom sets and reps per member).</li>
</ul>''')

# ================================================================== appendix
section('appendix', 'Appendix: How to Run', f'''
<ol>
<li>Install Node.js 20.11+, MySQL 8 and MongoDB 8; clone <a href="{REPO}">{REPO}</a>.</li>
<li><code>npm install</code></li>
<li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in the MySQL root password (used only by the setup
script), a random <code>MYSQL_PASSWORD</code> for the app account and a random <code>SESSION_SECRET</code>.</li>
<li><code>npm run db:setup</code> — builds both databases and loads demo data (drops existing data).</li>
<li><code>npm run dev</code> and open <code>http://localhost:3000</code>. Demo logins are listed in the README.</li>
<li>Documentation tools (in <code>docs/tools/</code>): <code>node docs/tools/dump-schema.mjs</code>, <code>python docs/tools/make_schema.py</code>,
<code>python docs/tools/make_dictionary.py</code>, <code>node docs/tools/run-queries.mjs</code>,
<code>node docs/tools/screenshots.mjs</code>, <code>node docs/tools/run-tests.mjs</code> + <code>python docs/tools/make_testdoc.py</code>,
then <code>python docs/tools/build_report.py</code> (course report) and <code>python docs/tools/build_full_report.py</code> (this document).</li>
</ol>''')

# ------------------------------------------------------------------ cover + contents
team_rows = ''.join(f'<tr><td>{esc(n)}</td><td>{esc(u)}</td><td>{esc(g)}</td></tr>' for n, u, g in TEAM)
cover = f'''<section class="cover">
<div class="brand">IronPulse</div>
<h1 class="title">Gym Management System</h1>
<p class="subtitle">DBMS Experiential Learning — Level 3 Project<br>MySQL + MongoDB with a Next.js web interface</p>
<table class="team"><thead><tr><th>Name</th><th>SRN</th><th>GitHub</th></tr></thead><tbody>{team_rows}</tbody></table>
<p class="meta">Course: Database Management Systems · Section {esc(SECTION)}<br>Instructor: Dr. Nagasundari S<br>PES University<br>{today}</p>
<p class="meta">Repository: <a href="{REPO}">{REPO}</a></p>
</section>'''
toc_items = re.findall(r'<section id="([^"]+)"><h1>([^<]+)</h1>', ''.join(S))
toc = '<section class="toc"><h1>Contents</h1><ol class="toc">' + ''.join(f'<li><a href="#{i}">{esc(t)}</a></li>' for i, t in toc_items) + '</ol></section>'

CSS = '''
@page { size: A4; margin: 16mm 15mm 18mm 15mm;
        @bottom-center { content: "IronPulse — DBMS Level 3 Project · page " counter(page); font: 8.5pt "Segoe UI", Arial, sans-serif; color: #666; } }
@page cover { @bottom-center { content: none; } }
* { box-sizing: border-box; }
body { font: 10.5pt/1.5 "Segoe UI", Arial, sans-serif; color: #1f2933; margin: 0; }
h1 { font-size: 20pt; color: #0f766e; margin: 0 0 10pt; padding-bottom: 4pt; border-bottom: 2px solid #0f766e; }
h2 { font-size: 14pt; color: #134e4a; margin: 16pt 0 6pt; break-after: avoid; }
h3 { font-size: 12pt; margin: 12pt 0 5pt; break-after: avoid; }
h4, h5, h6 { font-size: 10.5pt; margin: 10pt 0 4pt; break-after: avoid; }
section { break-before: page; }
section.cover { page: cover; break-before: auto; text-align: center; padding-top: 55mm; }
.brand { font-size: 15pt; letter-spacing: 3px; color: #0f766e; font-weight: 700; text-transform: uppercase; }
.title { font-size: 32pt; border: none; color: #111; margin: 6pt 0; }
.subtitle { font-size: 13pt; color: #444; margin-bottom: 26pt; }
table.team { margin: 0 auto 26pt; width: 70%; font-size: 11pt; }
.meta { color: #444; font-size: 11pt; }
ol.toc { font-size: 12pt; line-height: 2; list-style: none; padding-left: 0; }
ol.toc a { color: #1f2933; text-decoration: none; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li { margin-bottom: 2pt; }
code { font: 8.8pt Consolas, monospace; background: #f1f5f4; padding: 0 2px; border-radius: 2px; }
pre.code { font: 8pt/1.35 Consolas, monospace; background: #f7f9f9; border: 1px solid #dfe7e6; border-left: 3px solid #0f766e;
           padding: 6pt 8pt; white-space: pre-wrap; word-break: break-word; margin: 0 0 8pt; }
pre.code code { background: none; padding: 0; font: inherit; }
table { width: 100%; border-collapse: collapse; margin: 0 0 10pt; font-size: 8.6pt; }
th, td { border: 1px solid #d5dedd; padding: 3pt 5pt; text-align: left; vertical-align: top; overflow-wrap: break-word; }
td code { overflow-wrap: anywhere; }
th { background: #e6f2f0; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
table.fr td.id { width: 46pt; font-weight: 600; color: #0f766e; white-space: nowrap; }
figure { margin: 8pt 0 12pt; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; border: 1px solid #ccd6d4; }
figure.screen img { max-height: 232mm; }
figcaption { font-size: 9pt; color: #555; margin-top: 4pt; }
.wide { break-before: page; break-after: page; }
.wide figure { margin: 0; }
.wide figure img { max-height: 250mm; max-width: 100%; border: none; }
.todo { background: #fff3c4; border: 1px solid #e9c46a; padding: 5pt 8pt; }
'''
doc = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>IronPulse — Full Documentation</title>
<style>{CSS}</style></head><body>{cover}{toc}{''.join(S)}</body></html>'''
doc = doc.replace('[SRN]', '<span class="todo">[SRN]</span>') \
         .replace('[Section]', '<span class="todo">[Section]</span>')
out = os.path.join(ROOT, 'IronPulse-Full-Documentation.html')
open(out, 'w', encoding='utf-8').write(doc)
print('wrote', out, f'({figure.n} figures)')

pdf = os.path.join(ROOT, 'IronPulse-Full-Documentation.pdf')
edge = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
subprocess.run([edge, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', f'--print-to-pdf={pdf}',
                'file:///' + out.replace('\\', '/')], capture_output=True, timeout=180)
print('wrote', pdf, os.path.getsize(pdf) // 1024, 'KB')

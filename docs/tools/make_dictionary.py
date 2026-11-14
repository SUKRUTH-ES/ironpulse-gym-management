# Builds docs/data-dictionary.md from docs/tools/schema.json (live database dump).
# Run from the project root:  python docs/tools/make_dictionary.py
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, 'tools', 'schema.json'), encoding='utf-8'))

TABLE_INFO = {
    'users': 'Every login account (admin, trainer or member). One row per person who can sign in.',
    'members': 'Gym member profile; 1:1 with a users row of role member.',
    'trainers': 'Trainer profile; 1:1 with a users row of role trainer.',
    'membership_plans': 'Catalogue of plans the gym sells (Monthly, Quarterly, Day Pass, …).',
    'memberships': 'One purchased plan period for a member (renewals are new rows queued after the current one).',
    'rooms': 'Physical studios where group classes take place.',
    'class_types': 'Kinds of group class (Yoga, HIIT, Spin, …).',
    'class_sessions': 'One scheduled occurrence of a class type, with a trainer, a room and a time.',
    'class_bookings': 'M:N between members and class sessions: a booking or a waitlist place.',
    'pt_sessions': 'One-to-one personal-training session requested by a member with a trainer.',
    'payments': 'Money received, either for a membership or for a PT session. Never deleted; refunds change the status.',
    'attendance': 'Gym visits recorded at the front desk (check-in / check-out).',
    'audit_log': 'History of changes to memberships, payments and PT sessions, written only by triggers.',
}

DESC = {
    'users.user_id': 'Surrogate key', 'users.email': 'Login e-mail, stored lower-case by trigger',
    'users.password_hash': 'bcrypt hash (60 chars), never the plain password',
    'users.password_changed_at': 'Set by trg_users_bu when the hash changes', 'users.role': 'admin / trainer / member',
    'users.full_name': 'Display name', 'users.phone': 'Indian mobile number, 10 digits',
    'users.is_active': '0 = account deactivated (cannot log in)', 'users.created_at': 'Account creation time',
    'users.last_login_at': 'Updated on each successful login',
    'members.member_id': 'Surrogate key', 'members.user_id': 'Login account of the member',
    'members.member_code': "Card code shown at the front desk = 'GM' + 6-digit user_id",
    'members.date_of_birth': 'Age must be 14–100 (trg_members_bi/bu)', 'members.gender': 'male / female / other',
    'members.height_cm': 'Optional, 100–250', 'members.fitness_goal': 'Goal chosen at registration',
    'members.emergency_contact_name': 'Composite attribute Emergency_contact (part 1)',
    'members.emergency_contact_phone': 'Composite attribute Emergency_contact (part 2)',
    'members.joined_on': 'Registration date',
    'trainers.trainer_id': 'Surrogate key', 'trainers.user_id': 'Login account of the trainer',
    'trainers.specialization': 'Searched with FULLTEXT (MATCH … AGAINST)', 'trainers.bio': 'Free text, FULLTEXT-indexed',
    'trainers.experience_years': '0–50', 'trainers.session_rate': 'Price of one PT hour (₹)',
    'trainers.accepts_pt': 'Added with ALTER TABLE; 0 hides the trainer from PT requests', 'trainers.hired_on': 'Hire date',
    'membership_plans.plan_id': 'Surrogate key', 'membership_plans.name': 'Plan name shown to members',
    'membership_plans.description': 'Marketing text', 'membership_plans.duration_days': '1–730 days',
    'membership_plans.price': 'Price in ₹', 'membership_plans.classes_per_week': 'NULL = unlimited group classes',
    'membership_plans.pt_sessions_included': 'Free PT sessions per membership',
    'membership_plans.max_freeze_days': 'Total days the membership may be frozen (≤ duration)',
    'membership_plans.is_active': '0 = no longer sold (old memberships keep it)',
    'memberships.membership_id': 'Surrogate key', 'memberships.member_id': 'Owner', 'memberships.plan_id': 'Plan bought',
    'memberships.start_date': 'First valid day', 'memberships.end_date': 'Last valid day; filled from the plan by trigger if NULL',
    'memberships.status': 'active / frozen / expired (event) / cancelled (refund)',
    'memberships.freeze_days_used': 'Days frozen so far', 'memberships.frozen_from': 'Set only while status = frozen',
    'memberships.created_at': 'Purchase time',
    'rooms.room_id': 'Surrogate key', 'rooms.name': 'Room name', 'rooms.capacity': 'Max people, 1–200',
    'class_types.class_type_id': 'Surrogate key', 'class_types.name': 'Class name',
    'class_types.description': 'FULLTEXT-indexed text', 'class_types.intensity': 'low / medium / high',
    'class_types.duration_min': 'Default length, 15–180 minutes',
    'class_sessions.class_session_id': 'Surrogate key', 'class_sessions.class_type_id': 'What is taught',
    'class_sessions.trainer_id': 'Instructor', 'class_sessions.room_id': 'Where',
    'class_sessions.starts_at': 'Start time (max 7 days ahead, checked in the app)',
    'class_sessions.ends_at': 'Filled from class_types.duration_min by trigger if NULL',
    'class_sessions.capacity': 'Seats; trigger checks ≤ room capacity',
    'class_sessions.status': 'scheduled / cancelled / completed (event)',
    'class_bookings.booking_id': 'Surrogate key', 'class_bookings.class_session_id': 'Class booked',
    'class_bookings.member_id': 'Who booked', 'class_bookings.status': 'booked / waitlisted / cancelled / attended / no_show',
    'class_bookings.booked_at': 'Millisecond precision → fair waitlist order', 'class_bookings.updated_at': 'Last status change',
    'pt_sessions.pt_session_id': 'Surrogate key', 'pt_sessions.trainer_id': 'Trainer', 'pt_sessions.member_id': 'Client',
    'pt_sessions.starts_at': '≥ 2 h ahead, 06:00–22:00', 'pt_sessions.ends_at': 'Start + 30/45/60/90 min',
    'pt_sessions.status': 'requested → confirmed → completed, or cancelled',
    'pt_sessions.price': '0 when covered by the plan, else trainer rate', 'pt_sessions.member_note': 'Request message',
    'pt_sessions.created_at': 'Request time',
    'payments.payment_id': 'Surrogate key', 'payments.member_id': 'Payer', 'payments.membership_id': 'Set for a membership payment',
    'payments.pt_session_id': 'Set for a PT payment', 'payments.amount': '> 0', 'payments.method': 'cash / card / upi / netbanking',
    'payments.status': 'completed / refunded (never back)', 'payments.transaction_ref': 'Unique receipt reference',
    'payments.paid_at': 'Payment time', 'payments.recorded_by': 'Staff user who took the payment (NULL = online)',
    'attendance.attendance_id': 'Surrogate key (partial key in the ER model is check_in)', 'attendance.member_id': 'Visitor',
    'attendance.check_in': 'Arrival time', 'attendance.check_out': 'NULL while inside; auto-closed after 4 h by event',
    'audit_log.audit_id': 'Surrogate key', 'audit_log.table_name': 'Table that changed', 'audit_log.record_id': 'PK of the changed row',
    'audit_log.action': 'INSERT / UPDATE / DELETE', 'audit_log.old_value': 'Row before (JSON)', 'audit_log.new_value': 'Row after (JSON)',
    'audit_log.changed_by': 'MySQL account (USER())', 'audit_log.changed_at': 'Time of change',
}

VIEW_INFO = {
    'v_current_memberships': 'Membership valid today per member, with plan limits and days_left.',
    'v_member_overview': 'One row per member: profile, age, current plan, status (active/frozen/expired/none), last visit.',
    'v_expiring_memberships': 'Active memberships ending in the next 7 days with no renewal queued.',
    'v_class_schedule': 'Classes with type, trainer, room, booked_count, waitlist_count, seats_left.',
    'v_monthly_revenue': 'Revenue per month split into memberships and PT (completed payments only).',
    'v_trainer_performance': 'Classes taught, average occupancy %, completed PT sessions and PT revenue per trainer.',
    'v_churn_risk': 'Members whose visits in the last 30 days fell below half of the 30 days before.',
}

cols = {}
for c in d['columns']:
    cols.setdefault(c['tbl'], []).append(c)
fk = {(f['tbl'], f['col']): f for f in d['fks']}
tables = [t['name'] for t in d['tables']]
ORDER = ['users', 'members', 'trainers', 'membership_plans', 'memberships', 'payments', 'rooms', 'class_types',
         'class_sessions', 'class_bookings', 'pt_sessions', 'attendance', 'audit_log']
assert sorted(ORDER) == sorted(tables), set(tables) ^ set(ORDER)

def clean_check(cl):
    cl = cl.replace('`', '').replace("_utf8mb4\\'", "'").replace("\\'", "'").replace('\\\\\\\\', '\\')
    return re.sub(r'\s+', ' ', cl)

def keys_for(t, c):
    out = []
    if c['ckey'] == 'PRI': out.append('PK')
    if (t, c['col']) in fk:
        f = fk[(t, c['col'])]
        out.append(f"FK → {f['ref_tbl']}.{f['ref_col']}" + (' (CASCADE)' if f['on_delete'] == 'CASCADE' else ''))
    if c['ckey'] == 'UNI': out.append('UQ')
    return ', '.join(out)

def default(c):
    v = c['def']
    if v is None: return ''
    if 'DEFAULT_GENERATED' in c['extra'] or v.startswith('CURRENT') or v.startswith('curdate') or v.startswith('('):
        return v.replace('curdate()', 'CURRENT_DATE')
    return v

L = ['# IronPulse — Data Dictionary', '',
     '_Generated from the live databases by `docs/tools/make_dictionary.py` (MySQL `information_schema` + MongoDB). '
     'Do not edit by hand; re-run `node docs/tools/dump-schema.mjs` and the script after a schema change._', '',
     f"MySQL database `gym_db`: **{len(tables)} tables, {len(d['fks'])} foreign keys, {len(d['checks'])} CHECK constraints, "
     f"{len(d['views'])} views, {sum(r['type'] == 'FUNCTION' for r in d['routines'])} functions, "
     f"{sum(r['type'] == 'PROCEDURE' for r in d['routines'])} procedures, {len(d['triggers'])} triggers, {len(d['events'])} events.** "
     f"MongoDB database `gym_mongo`: **{len(d['mongo'])} collections.**", '',
     'Key: PK primary key · FK foreign key · UQ unique · Null "NO" = NOT NULL.', '', '## 1. MySQL tables', '']

for i, t in enumerate(ORDER, 1):
    L += [f'### 1.{i} `{t}`', '', TABLE_INFO[t] + f" _(rows now: {d['rowCounts'][t]})_", '',
          '| Column | Type | Null | Key | Default | Description |', '|---|---|---|---|---|---|']
    for c in cols[t]:
        typ = c['type'].replace('|', '\\|')
        extra = ' AUTO_INCREMENT' if 'auto_increment' in c['extra'] else ''
        L.append(f"| `{c['col']}` | {typ}{extra} | {c['nullable']} | {keys_for(t, c)} | {default(c)} | {DESC.get(t + '.' + c['col'], '')} |")
    checks = [x for x in d['checks'] if x['tbl'] == t]
    idx = [x for x in d['indexes'] if x['tbl'] == t and x['name'] != 'PRIMARY']
    trg = [x for x in d['triggers'] if x['tbl'] == t]
    L.append('')
    if checks:
        L.append('**CHECK constraints:** ' + '; '.join(f"`{x['name']}`: `{clean_check(x['clause'])}`" for x in checks))
        L.append('')
    if idx:
        L.append('**Indexes:** ' + '; '.join(
            f"`{x['name']}` ({'UNIQUE ' if not x['non_unique'] else ''}{'FULLTEXT ' if x['type'] == 'FULLTEXT' else ''}{x['cols']})" for x in idx))
        L.append('')
    if trg:
        L.append('**Triggers:** ' + ', '.join(f"`{x['name']}` ({x['timing']} {x['ev']})" for x in trg))
        L.append('')

L += ['## 2. Views', '', '| View | Purpose | Columns |', '|---|---|---|']
for v in d['views']:
    vc = ', '.join(c['col'] for c in cols[v['name']])
    L.append(f"| `{v['name']}` | {VIEW_INFO.get(v['name'], '')} | {vc} |")
L += ['', '## 3. Stored routines, triggers and events', '',
      '**Functions:** ' + ', '.join(f"`{r['name']}`" for r in d['routines'] if r['type'] == 'FUNCTION'), '',
      '**Procedures:** ' + ', '.join(f"`{r['name']}`" for r in d['routines'] if r['type'] == 'PROCEDURE'), '',
      '**Events:** ' + ', '.join(f"`{e['name']}` (every {e['every']} {e['unit'].lower()}, {e['status'].lower()})" for e in d['events']), '']

# ------------------------------------------------------------------ MongoDB
MDESC = {
    'memberId': 'MySQL members.member_id (reference by value)', 'trainerId': 'MySQL trainers.trainer_id; null = self-made plan',
    'userId': 'MySQL users.user_id of the receiver', 'createdBy': 'member_id for a private exercise; null/absent = shared',
    'planId': 'workout_plans._id the workout followed', 'slug': 'URL-safe unique name',
    'days': 'Embedded training days', 'days.exercises': 'Embedded exercise prescriptions',
    'days.exercises.exerciseId': 'exercises._id', 'exercises': 'Exercises done in this workout',
    'exercises.exerciseId': 'exercises._id', 'exercises.sets': 'One entry per set',
    'exercises.sets.durationSec': 'For timed/cardio items (app asks minutes)', 'cardio': 'Cardio blocks',
    'rpe': 'Rate of perceived exertion', 'performedAt': 'When the workout happened', 'readAt': 'null = unread',
    'meta': 'Extra data, e.g. classSessionId', 'type': 'Kind of notification', 'status': 'Only one active plan per member',
    'instructions': 'Step-by-step text (text-indexed)', 'tags': 'Search keywords (text-indexed)',
}

def walk(schema, prefix='', req=()):
    rows = []
    props = schema.get('properties', {})
    for name, p in props.items():
        path = f'{prefix}{name}'
        t = p.get('bsonType', p.get('type', ''))
        t = ' \\| '.join(t) if isinstance(t, list) else t
        rule = []
        for k in ('minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern'):
            if k in p: rule.append(f'{k} {p[k]}')
        if 'enum' in p: rule.append('one of ' + ', '.join(str(x) for x in p['enum'] if x is not None))
        if not t and 'enum' in p: t = 'enum'
        rows.append((path, t, 'yes' if name in req else '', '; '.join(rule).replace('|', '\\|'),
                     p.get('description', '') or MDESC.get(path.replace('[]', ''), '')))
        if p.get('bsonType') == 'object' or 'properties' in p:
            rows += walk(p, path + '.', p.get('required', ()))
        items = p.get('items')
        if isinstance(items, dict) and ('properties' in items):
            rows += walk(items, path + '[].', items.get('required', ()))
    return rows

COLL_INFO = {
    'exercises': 'Exercise library (shared) plus member-private exercises (createdBy = member_id).',
    'workout_plans': 'Workout plans: built by a trainer (trainerId) or by the member (trainerId null). Days and exercises embedded.',
    'workout_logs': 'One document per finished workout, with embedded sets and cardio entries.',
    'body_metrics': 'Time-series collection of body weight / body-fat / waist measurements.',
    'notifications': 'In-app inbox messages; deleted automatically after 60 days by a TTL index.',
}
L += ['## 4. MongoDB collections', '']
for i, m in enumerate(sorted(d['mongo'], key=lambda m: list(COLL_INFO).index(m['name'])), 1):
    L += [f"### 4.{i} `{m['name']}`" + (' (time-series)' if m['type'] == 'timeseries' else ''), '',
          COLL_INFO[m['name']] + f" _(documents now: {m['count']})_", '']
    v = m['options'].get('validator', {}).get('$jsonSchema')
    if v:
        L += [f"Validator: `$jsonSchema`, validationLevel `{m['options'].get('validationLevel')}`, "
              f"validationAction `{m['options'].get('validationAction')}`" +
              (f", additionalProperties `{v['additionalProperties']}`" if 'additionalProperties' in v else ''), '',
              '| Field | BSON type | Required | Rule | Description |', '|---|---|---|---|---|']
        for r in walk(v, '', v.get('required', ())):
            L.append(f"| `{r[0]}` | {r[1]} | {r[2]} | {r[3]} | {r[4]} |")
    else:
        ts = m['options'].get('timeseries', {})
        L += [f"No validator. timeField `{ts.get('timeField')}`, metaField `{ts.get('metaField')}`, granularity `{ts.get('granularity')}`.",
              'Fields: `recordedAt` date, `memberId` int (→ members.member_id), `weightKg` double (app checks 25–300), '
              '`bodyFatPct` double (optional), `waistCm` double (optional).']
    L.append('')
    ix = [x for x in m['indexes'] if x['name'] != '_id_']
    if ix:
        def ixd(x):
            s = ', '.join(f'{k}: {v}' for k, v in x['key'].items())
            if x.get('unique'): s += ' · unique'
            if 'expireAfterSeconds' in x: s += f" · TTL {x['expireAfterSeconds'] // 86400} days"
            if 'weights' in x: s += ' · weights ' + ', '.join(f'{k} {v}' for k, v in x['weights'].items())
            return f"`{x['name']}` ({s})"
        L += ['**Indexes:** ' + '; '.join(ixd(x) for x in ix), '']

open(os.path.join(ROOT, 'data-dictionary.md'), 'w', encoding='utf-8').write('\n'.join(L))
print('data-dictionary.md', len(L), 'lines; columns without description:',
      [f"{c['tbl']}.{c['col']}" for c in d['columns'] if c['tbl'] in ORDER and f"{c['tbl']}.{c['col']}" not in DESC])

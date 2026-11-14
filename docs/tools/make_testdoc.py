# Builds docs/test-cases.md from docs/test-results.json (written by run-tests.mjs)
# plus the manual browser tests recorded during development.
# Run from the project root:  python docs/tools/make_testdoc.py
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
r = json.load(open(os.path.join(ROOT, 'test-results.json'), encoding='utf-8'))
esc = lambda s: str(s).replace('|', '\\|').replace('\n', ' ')

L = ['# IronPulse — Test Cases and Results', '',
     '## 1. Automated database tests', '',
     f"**Result: {r['passed']} of {r['total']} passed** (run {r['ranAt'][:16].replace('T', ' ')} UTC with `node docs/tools/run-tests.mjs`).", '',
     'How the suite works: it builds a separate copy of both databases (`gym_test`, `gym_test_mongo`) from the same `db/` scripts '
     'and demo seed, runs every case **as the application account `gym_app`** (the same least-privilege login the web app uses), '
     'records the real database response, and drops the copies at the end — the live data is never touched. '
     'A case passes only if the database gives exactly the expected result or the expected error.', '']

areas = []
for t in r['results']:
    if t['area'] not in areas: areas.append(t['area'])
for i, a in enumerate(areas, 1):
    rows = [t for t in r['results'] if t['area'] == a]
    ok = sum(t['pass'] for t in rows)
    L += [f'### 1.{i} {a} ({ok}/{len(rows)})', '',
          '| ID | Test case | Input / action | Expected | Actual (database response) | Result |', '|---|---|---|---|---|---|']
    for t in rows:
        L.append(f"| {t['id']} | {esc(t['title'])} | `{esc(t['input'])}` | {esc(t['expected'])} | {esc(t['actual'])} | {'✅ Pass' if t['pass'] else '❌ Fail'} |")
    L.append('')

MANUAL = [
    # id, screen/role, steps, expected, date
    ('Public', 'Register with phone "12345"', 'Browser blocks the form (pattern) before sending', '2026-11-02'),
    ('Public', 'Register with date of birth making the member 12', 'Form shows "Members must be at least 14 years old" (trigger); typed values stay in the form', '2026-11-02'),
    ('Public', 'Register with valid data', 'Account GM000120 created, logged in, redirected to member home', '2026-11-02'),
    ('Public', 'Log in with a wrong password', 'Error message shown, user stays logged out', '2026-11-02'),
    ('Security', 'Read document.cookie in the browser console after login', 'gym_session not visible (httpOnly)', '2026-10-31'),
    ('Security', 'Trainer opens /admin', 'Redirected to /trainer (proxy + requireRole)', '2026-10-31'),
    ('Admin', 'Front desk: check in an expired member / an active member / the same member again', 'Refused / checked in / "already checked in"', '2026-10-31'),
    ('Admin', 'Create class in a room already in use', 'Room-clash error from trigger', '2026-11-02'),
    ('Admin', 'Create class with capacity above the room capacity', 'Capacity error from trigger', '2026-11-02'),
    ('Admin', 'Create a valid class without end time', 'Class created, end time filled from class type', '2026-11-02'),
    ('Admin', 'Cancel a class (confirm dialog)', 'Bookings cancelled and members notified in their inbox', '2026-11-02'),
    ('Admin', 'Create plan with freeze days > duration', 'CHECK constraint error shown', '2026-11-02'),
    ('Admin', 'Switch a plan off', 'Plan disappears from the sell list; old memberships keep it', '2026-11-02'),
    ('Admin', 'Sell a renewal to a member with an active plan', 'New membership queued after the current end date', '2026-11-02'),
    ('Admin', 'Refund a payment (confirm dialog)', 'Payment refunded, membership cancelled, member notified, audit_log row', '2026-11-02'),
    ('Admin', 'Reports page', 'Revenue, class popularity (HAVING), ranking (RANK), churn, never-booked, audit log render', '2026-10-31'),
    ('Admin', 'Gym setup: add trainer / room / class type', 'Rows created (trainer via sp_add_trainer: users + trainers in one transaction)', '2026-11-11'),
    ('Trainer', 'Confirm a requested PT session', 'Status confirmed', '2026-10-31'),
    ('Trainer', 'Mark a paid PT session done (choose payment method)', 'Session completed and payment inserted in the same transaction, recorded_by = trainer', '2026-11-02'),
    ('Trainer', 'Mark attendance Present for a class from yesterday', 'Allowed (2-day window); older classes locked', '2026-11-02'),
    ('Trainer', 'Build a plan with no exercises / a valid plan', 'Error / plan saved in MongoDB and member notified', '2026-11-02'),
    ('Trainer', 'Member cancels a PT session', 'Trainer receives a notification', '2026-11-11'),
    ('Member', 'Buy a plan, freeze, unfreeze', 'Status changes and end date shown correctly', '2026-11-02'),
    ('Member', 'Book a full class, then another member cancels', 'Waitlisted, then promoted with a notification', '2026-11-02'),
    ('Member', 'Waitlisted member already at weekly limit', 'Skipped during promotion; next eligible member promoted', '2026-11-11'),
    ('Member', 'Search trainers for "back pain"', 'Kavya Iyer (mobility, lower back) listed first (FULLTEXT)', '2026-10-31'),
    ('Member', 'Log a workout incl. "20 min" cardio item', 'Saved; cardio typed in minutes, stored as seconds; charts update', '2026-11-11'),
    ('Member', 'Record body weight outside / inside 25–300 kg', 'Rejected / saved and chart updated', '2026-11-02'),
    ('Member', 'Add a private exercise, build and activate own plan, delete it', 'Exercise visible only to this member; plan active then deleted', '2026-11-02'),
    ('Member', 'Edit profile; change password', 'Profile saved; password changed and password_changed_at set by trigger', '2026-11-11'),
]
L += ['## 2. Manual end-to-end tests in the browser', '',
      'Run by hand through the Next.js UI on the dates shown (2026-10-31 first build, 2026-11-02 full screen-by-screen run, 2026-11-11 new features) (results checked afterwards in MySQL Workbench and MongoDB Compass). '
      'They cover the same rules as section 1 but through the real forms, plus UI-only behaviour (redirects, messages, notifications).', '',
      '| ID | Role / area | Steps | Expected and observed | Date | Result |', '|---|---|---|---|---|---|']
for i, (role, steps, exp, date) in enumerate(MANUAL, 1):
    L.append(f'| U{i:02d} | {role} | {esc(steps)} | {esc(exp)} | {date} | ✅ Pass |')
L += ['', '## 3. Build checks', '',
      '| Check | Command | Result |', '|---|---|---|',
      '| Lint (ESLint, Next.js rules) | `npm run lint` | No errors (2026-11-13) |',
      '| Production build | `npm run build` | Compiles, all routes built (2026-11-11) |',
      f"| Database test suite | `node docs/tools/run-tests.mjs` | {r['passed']}/{r['total']} passed ({r['ranAt'][:10]}) |", '']
open(os.path.join(ROOT, 'test-cases.md'), 'w', encoding='utf-8').write('\n'.join(L))
print('test-cases.md', r['passed'], '/', r['total'], '+', len(MANUAL), 'manual')

# IronPulse — Demo Script (about 15 minutes)

Follows the order of the course brief: problem → ER & design → schema → DB implementation → queries → UI → integration → advanced features → tests → contributions.
**A** = SUKRUTH ES, **B** = teammate. All demo passwords: `Gym@12345`.

## Before the demo (10 minutes earlier)

1. Start MySQL80 and MongoDB services (Windows Services, both "Running").
2. Reset the data so everything looks fresh:
   ```bash
   npm run db:setup
   ```
3. Start the app and open http://localhost:3000:
   ```bash
   npm run dev
   ```
4. Open these tabs/windows in advance:
   - Browser tab 1: http://localhost:3000/login (admin), browser tab 2 in a private window (member).
   - `docs/IronPulse-Report.pdf` (ER diagram page, relational schema page).
   - MySQL Workbench → Local instance MySQL80 → `gym_db`, with a query tab open.
   - MongoDB Compass → `mongodb://localhost:27017` → `gym_mongo`.
5. Accounts (stable because the seed uses a fixed random seed):
   - Admin: `admin@ironpulse.test`
   - Trainer: `kavya@ironpulse.test`
   - Member with lots of data: `harsh.pillai@mail.test` (code GM000055)
   - Expired member for the front-desk demo: GM000020 (Suresh Patel). Frozen member: GM000017.
   If a status differs on the day, pick one from Admin → Members using the status filter.

## 1. Problem and motivation — A (1 min)

- Gyms run on registers and spreadsheets: missed renewals, overbooked classes, room/trainer clashes, unreconciled payments, no idea who is about to quit.
- IronPulse = one system for admin, trainers and members. Rules are enforced **inside the databases**, so it is not a CRUD app.
- Why two databases: money, seats and time slots → MySQL (ACID, constraints, triggers); nested training data → MongoDB (documents, validators, aggregation).

## 2. ER diagram and design — A (2 min)

Show the ER page of the report.
- Entities and (min,max) notation; USER → MEMBER / TRAINER disjoint, **partial** (admins are neither).
- ATTENDANCE is a weak entity owned by MEMBER (identifying relationship CHECKS_IN).
- BOOKS is M:N with attributes Status and Booked_at (Booked_at gives the waitlist order).
- PAYMENT pays for exactly one MEMBERSHIP or one PT_SESSION → `CHECK chk_payments_target`.
- Derived attributes (Age, Days_left, Seats_left) are computed in views, not stored.

## 3. Relational schema — A (1 min)

Show the relational-schema page: 13 tables, 16 FKs, 3NF; mapping rules (subclass tables with UNIQUE `user_id`, M:N → `class_bookings` with UNIQUE(class, member)).
Then the MongoDB model page: embedded days/exercises/sets, references by MySQL ids, time-series and TTL.

## 4. Database implementation — A + B (2 min)

In Workbench, run:
```sql
SHOW FULL TABLES;
SHOW TRIGGERS;
SHOW PROCEDURE STATUS WHERE Db = 'gym_db';
SHOW EVENTS;
```
- A: open `sp_book_class` (Routines) — `START TRANSACTION`, `SELECT … FOR UPDATE`, `SIGNAL '45000'`.
- B: open `sp_add_trainer` and `trg_pt_sessions_au` (B's own database work).
- Compass: open `workout_logs` → Validation tab (the `$jsonSchema`) and Indexes tab.

## 5. Important queries — A (2 min)

Admin → **Reports** in the browser, and the same SQL in Workbench (copy from `docs/important-queries.md`):
- Revenue by plan (JOIN + GROUP BY), class popularity (**HAVING**), most consistent members (**RANK() OVER**), never-booked members (**NOT EXISTS**), churn risk (view).
- Member → Personal training → search **"back pain"** → Kavya comes first (**FULLTEXT MATCH … AGAINST**).
- Member → Workouts: weekly volume and personal records are **MongoDB aggregation pipelines** (show the pipeline in the doc).

## 6. Next.js UI walk-through — A + B (3 min)

**Admin (A)**
1. Dashboard: KPIs, revenue chart, peak-hours heat map, renewals due, churn risk.
2. Front desk: check in **GM000020** → "Member has no active membership for today"; check in **GM000055** → success; again → "Member is already checked in"; then check out.
3. Classes: try to create a class in a room that is already used at that time → room-clash error from the trigger.
4. Payments: refund one payment → confirm → status refunded; Reports → Audit log shows the change.

**Member (A)** — private window, log in as Harsh
5. Book classes: book a class; book a full class → "waitlisted".
6. Membership: freeze → status frozen; (back in admin) front desk check-in for that member → "Membership is frozen…"; unfreeze.

**B's features (B)**
7. Admin → **Gym setup**: add a room and a trainer (one transaction through `sp_add_trainer`).
8. Member → **My profile**: change phone, change password.
9. Member → Personal training: request a session with Kavya, then cancel it → log in as `kavya@ironpulse.test` → notification that the member cancelled.
10. Waitlist promotion respects the plan's weekly limit (explain the change in `sp_cancel_class_booking`).
11. Member → Workouts → log a cardio item in **minutes** (stored as seconds; validator updated).

## 7. Integration and security — B (1 min)

- `src/lib/db.js`: mysql2 pool, `?` placeholders, `callProcedure()`, `transaction()`.
- `src/proxy.js` + `requireRole()`: log in as trainer, open `/admin` → redirected to `/trainer`.
- Browser console: `document.cookie` → the session cookie is not visible (httpOnly).
- Workbench: `SHOW GRANTS FOR 'gym_app'@'localhost';` → only SELECT, INSERT, UPDATE, DELETE, EXECUTE; `.env.local` not in Git.

## 8. Test cases — B (1.5 min)

```bash
node docs/tools/run-tests.mjs
```
Runs 55 cases on a throwaway copy of the database as `gym_app` (about 1 minute) and prints PASS/FAIL. Show `docs/test-cases.md`: input → expected → actual database error, plus the 30 manual browser tests.

## 9. Individual contributions — A + B (1 min)

Show the GitHub commit history (`https://github.com/SUKRUTH-ES/ironpulse-gym-management/commits/main`) and the contributions table in the report: each member did database work **and** UI work.

## Likely viva questions (short answers)

- **Why not only MySQL?** Plans/logs are nested and change shape; storing them relationally needs 4–5 tables and joins for every read. MongoDB reads one document and the aggregation pipeline does the stats.
- **Why not only MongoDB?** Payments, seats and time slots need multi-row ACID transactions, foreign keys and row locks.
- **How do you stop two people taking the last seat?** `sp_book_class` locks the class row with `SELECT … FOR UPDATE` inside a transaction; the second booking waits and then sees the seat is taken → waitlisted.
- **Where is validation?** Forms check first for convenience, but the database is the authority: CHECK constraints, triggers, procedures (`SIGNAL`), and MongoDB `$jsonSchema`.
- **Normal form?** 3NF; snapshot columns (`pt_sessions.price`, `class_sessions.capacity`) are deliberate history, derived values are in views.
- **How are passwords stored?** bcrypt hashes (cost 12); the session is a signed JWT in an httpOnly cookie, and the user is re-checked in MySQL on every request.
- **What runs automatically?** MySQL events: daily expiry; every 15 minutes close finished classes, mark no-shows, close forgotten visits, cancel stale PT requests. MongoDB TTL deletes old notifications.

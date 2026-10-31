# IronPulse: Gym Management System

DBMS Level 3 mini project. A web app for running a gym: memberships and payments, class booking with automatic waitlists, personal training, front-desk check-in, workout plans and progress tracking, and business reports.

- **Frontend + API:** Next.js 16 (App Router, Server Actions), Tailwind CSS
- **SQL database:** MySQL 8: everything relational and transactional (members, plans, payments, bookings, attendance)
- **NoSQL database:** MongoDB 8: flexible and fast-changing documents (workout plans and logs, body measurements, notifications, exercise library)

## Roles

| Role | What they can do |
|---|---|
| **Admin** | Dashboard (revenue, peak hours, renewals due, churn risk), front-desk check-in/out, members, selling plans, refunds, class timetable, plans, reports, audit log |
| **Trainer** | Weekly schedule, confirm/decline/complete personal training, take class attendance, create workout plans for members |
| **Member** | Book classes (or join the waitlist), cancel, buy/renew/freeze membership, request personal training (full-text trainer search), log workouts, see progress charts, search the exercise library |

## Setup

Needs Node.js 20.11 or newer, MySQL 8 and MongoDB running locally.

1. Install packages:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill it in. `MYSQL_ADMIN_PASSWORD` is your MySQL root password: it is only used by the setup script. Pick any long random `MYSQL_PASSWORD` and `SESSION_SECRET`.
3. Build both databases and load demo data (this **drops and recreates** `gym_db` and `gym_mongo`):
   ```bash
   npm run db:setup
   ```
   Use `npm run db:setup -- --empty` for the schema without demo data.
4. Start the app and open http://localhost:3000:
   ```bash
   npm run dev
   ```

### Demo accounts

All demo accounts use the password **`Gym@12345`**.

| Role | E-mail |
|---|---|
| Admin | `admin@ironpulse.test` |
| Trainer | `arjun@ironpulse.test`, `kavya@ironpulse.test`, `rohan@ironpulse.test`, `sneha@ironpulse.test`, `vikram@ironpulse.test` |
| Member | any member e-mail from Admin → Members (e.g. `firstname.lastname@mail.test`) |

## Project structure

```
db/mysql/01_schema.sql    tables, keys, CHECK constraints, indexes, FULLTEXT, ALTER/DROP demo
db/mysql/02_views.sql     7 views (current memberships, schedule, revenue, churn risk...)
db/mysql/03_routines.sql  4 functions + 9 stored procedures (all multi-step ones are transactions)
db/mysql/04_triggers.sql  17 triggers (validation, clash detection, audit log, cascade cancel)
db/mysql/05_events.sql    scheduled events (expire memberships, close finished classes)
db/mongo/collections.mjs  MongoDB collections, $jsonSchema validators, indexes (text, TTL, time series)
scripts/db-setup.mjs      builds everything; creates the limited app account
scripts/seed-data.mjs     realistic demo data (~110 members, 10 months of history)
src/lib/                  db.js (MySQL pool), mongo.js, auth.js (data access layer), session.js
src/proxy.js              role-based route protection
src/app/admin|trainer|member/   pages + server actions per role
```

## How the requirements are covered

| Requirement | Where |
|---|---|
| SQL + NoSQL | MySQL `gym_db` + MongoDB `gym_mongo` (see justification below) |
| DDL: CREATE / ALTER / DROP, PK/FK, constraints, indexes, views | `01_schema.sql`, `02_views.sql` |
| DML with JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries | Admin → Reports, Dashboard, member pages (`src/app/**/page.js`) |
| Transactions | `sp_purchase_membership`, `sp_book_class` (row lock `FOR UPDATE`), `sp_cancel_class_booking`, refunds and PT completion in `actions.js` |
| Stored procedures / functions | `03_routines.sql` |
| Triggers | `04_triggers.sql` |
| Indexing / full-text search | composite indexes; MySQL `FULLTEXT` trainer search; MongoDB weighted text index on exercises |
| NoSQL aggregation | weekly volume, personal records, popular exercises, trainer's member activity |
| Window functions | "Most consistent members" (`RANK() OVER`) |
| Events (scheduler) | `05_events.sql` |
| Auth + roles (3) | bcrypt hashes, signed httpOnly JWT cookie, `proxy.js` + `requireRole()` on every page and action |
| Validation at DB level | CHECK constraints, triggers (age, overlaps, clashes, capacity), MongoDB `$jsonSchema` validators |
| Security | env vars for credentials, least-privilege `gym_app` MySQL account (no DDL), prepared statements, payments cannot be deleted |

### Why two databases?

- **MySQL** holds data where correctness matters most: money, capacity limits and dates that must not overlap. Foreign keys, CHECK constraints, triggers and ACID transactions guarantee, for example, that two members can't take the last seat in a class or that a refund and its membership cancellation happen together.
- **MongoDB** holds data that is naturally a nested document with a variable shape: a workout plan (days → exercises → sets) or a workout log (strength sets with reps/kg, timed holds, cardio with distance). Reading one document replaces 4–5 SQL joins, and the aggregation pipeline computes progress stats. Body measurements use a time-series collection; notifications use a TTL index so they delete themselves after 60 days.
- The two are linked by MySQL primary keys (`memberId`, `trainerId`, `userId`), and the app checks a member exists in MySQL before writing their plan to MongoDB.

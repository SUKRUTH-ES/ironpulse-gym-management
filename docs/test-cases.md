# IronPulse — Test Cases and Results

## 1. Automated database tests

**Result: 55 of 55 passed** (run 2026-11-14 18:10 UTC with `node docs/tools/run-tests.mjs`).

How the suite works: it builds a separate copy of both databases (`gym_test`, `gym_test_mongo`) from the same `db/` scripts and demo seed, runs every case **as the application account `gym_app`** (the same least-privilege login the web app uses), records the real database response, and drops the copies at the end — the live data is never touched. A case passes only if the database gives exactly the expected result or the expected error.

### 1.1 Registration and accounts (6/6)

| ID | Test case | Input / action | Expected | Actual (database response) | Result |
|---|---|---|---|---|---|
| T01 | Register a new member (procedure) | `CALL sp_register_member('Test.A@Example.test ', hash, 'Test A', phone, 25 y, …)` | member_id returned, code GM + 6 digits, e-mail stored lower-case and trimmed | member_id 111, code GM000117, e-mail "test.a@example.test" | ✅ Pass |
| T02 | Reject member younger than 14 | `sp_register_member with date of birth 10 years ago` | Error from trg_members_bi; user row rolled back | ERROR 1644 Members must be at least 14 years old; users before/after: 117/117 | ✅ Pass |
| T03 | Reject duplicate e-mail | `Register again with TEST.A@example.test` | Duplicate entry error (UNIQUE uq_users_email) | ERROR 1062 Duplicate entry 'test.a@example.test' for key 'users.uq_users_email' | ✅ Pass |
| T04 | Reject invalid phone number | `INSERT INTO users … phone '12345'` | CHECK constraint chk_users_phone violated | ERROR 3819 Check constraint 'chk_users_phone' is violated. | ✅ Pass |
| T05 | Reject invalid e-mail | `INSERT INTO users … email 'not-an-email'` | CHECK constraint chk_users_email violated | ERROR 3819 Check constraint 'chk_users_email' is violated. | ✅ Pass |
| T06 | Passwords are stored only as bcrypt hashes | `SELECT password_hash FROM users` | Every hash is 60 chars and starts with $2 | 117 of 117 rows are bcrypt hashes | ✅ Pass |

### 1.2 Memberships and payments (14/14)

| ID | Test case | Input / action | Expected | Actual (database response) | Result |
|---|---|---|---|---|---|
| T07 | Buy a membership | `CALL sp_purchase_membership(M1, 'Monthly Plus', 'upi', admin)` | Membership starts today, end date filled by trigger from plan duration, completed payment for the plan price | 2026-11-14 → 2026-12-13 (30 days, active); payment ₹2500.00 completed | ✅ Pass |
| T08 | Renewal is queued after the current plan | `Buy the same plan again for M1` | New membership starts the day after the current one ends (no overlap) | current ends 2026-12-13, renewal starts 2026-12-14 | ✅ Pass |
| T09 | Overlapping membership is blocked | `INSERT a second membership for M1 covering today` | Error from trg_memberships_bi | ERROR 1644 Member already has a membership covering these dates | ✅ Pass |
| T10 | Inactive plan cannot be bought | `sp_purchase_membership with a switched-off plan` | Error 'This plan is no longer offered' | ERROR 1644 This plan is no longer offered | ✅ Pass |
| T11 | Freeze a membership | `Member M4 buys 'Monthly Plus', then sp_freeze_membership` | Status frozen, frozen_from = today | status frozen, frozen_from 2026-11-14 | ✅ Pass |
| T12 | Frozen member cannot check in | `CALL sp_check_in('<M4 code>')` | Error from trg_attendance_bi: 'Membership is frozen…' | ERROR 1644 Membership is frozen. Unfreeze it to check in | ✅ Pass |
| T13 | Unfreeze adds the frozen days to the end date | `Set frozen_from 5 days back, then sp_unfreeze_membership` | days_added = 5, end date +5, freeze_days_used = 5, status active | days_added 5; end 2026-12-13 → 2026-12-18; used 5; active | ✅ Pass |
| T14 | Frozen flag and frozen_from must match | `UPDATE memberships SET status = 'frozen' (frozen_from stays NULL)` | CHECK constraint chk_memberships_frozen violated | ERROR 3819 Check constraint 'chk_memberships_frozen' is violated. | ✅ Pass |
| T15 | Payment must be for exactly one thing | `INSERT payment with membership_id and pt_session_id both NULL` | CHECK constraint chk_payments_target violated | ERROR 3819 Check constraint 'chk_payments_target' is violated. | ✅ Pass |
| T16 | Payment amount must be positive | `INSERT payment with amount 0` | CHECK constraint chk_payments_amount violated | ERROR 3819 Check constraint 'chk_payments_amount' is violated. | ✅ Pass |
| T17 | Payments cannot be deleted | `DELETE FROM payments WHERE payment_id = <M1 payment>` | Error from trg_payments_bd 'Payments cannot be deleted; refund them instead' | ERROR 1644 Payments cannot be deleted; refund them instead | ✅ Pass |
| T18 | Payment details cannot be edited | `UPDATE payments SET amount = 1` | Error from trg_payments_bu | ERROR 1644 Payment details cannot be edited; refund it instead | ✅ Pass |
| T19 | Refund is recorded in the audit log | `UPDATE payments SET status = 'refunded'` | Status refunded; trg_payments_au writes old/new JSON to audit_log | audit_log: {"status":"completed"} → {"status":"refunded"} by gym_app@localhost | ✅ Pass |
| T20 | A refund cannot be undone | `UPDATE payments SET status = 'completed' on the refunded payment` | Error from trg_payments_bu | ERROR 1644 A refunded payment cannot be restored | ✅ Pass |

### 1.3 Front desk (attendance) (6/6)

| ID | Test case | Input / action | Expected | Actual (database response) | Result |
|---|---|---|---|---|---|
| T21 | Check in an active member | `CALL sp_check_in(<M1 code>)` | attendance row created, member name returned | attendance_id 7649, name "Test A" (code typed lower-case with a space) | ✅ Pass |
| T22 | Double check-in is refused | `CALL sp_check_in(<M1 code>) again` | Error 'Member is already checked in' | ERROR 1644 Member is already checked in | ✅ Pass |
| T23 | Check out | `CALL sp_check_out(<M1 code>)` | Visit closed, minutes returned, check_out > check_in | 0 min, 2026-11-14 23:40:54 → 2026-11-14 23:41:54 | ✅ Pass |
| T24 | Member without a plan cannot check in | `Register M5 (no purchase), sp_check_in` | Error 'Member has no active membership for today' | ERROR 1644 Member has no active membership for today | ✅ Pass |
| T25 | Unknown member code | `CALL sp_check_in('GM999999')` | Error 'No active member with that code' | ERROR 1644 No active member with that code | ✅ Pass |
| T26 | Check-out before check-in is impossible | `UPDATE attendance SET check_out = check_in - 1 hour` | CHECK constraint chk_attendance_times violated | ERROR 3819 Check constraint 'chk_attendance_times' is violated. | ✅ Pass |

### 1.4 Group classes and waitlist (11/11)

| ID | Test case | Input / action | Expected | Actual (database response) | Result |
|---|---|---|---|---|---|
| T27 | Create a class; end time filled by trigger | `INSERT class_sessions (type 'Mobility & Stretch', ends_at NULL, capacity 1) on 2026-11-20 01:00` | ends_at = starts_at + 30 min | 2026-11-20 01:00:00 → 2026-11-20 01:30:00 (30 min) | ✅ Pass |
| T28 | Capacity cannot exceed the room | `INSERT class with capacity 13 in 'Functional Zone' (capacity 12)` | Error from trg_class_sessions_bi | ERROR 1644 Class capacity is larger than the room capacity | ✅ Pass |
| T29 | Room double-booking is blocked | `INSERT another class in 'Functional Zone' at the same time with another trainer` | Error from trg_class_sessions_bi (room clash) | ERROR 1644 Room is already booked for another class at that time | ✅ Pass |
| T30 | Trainer double-booking is blocked | `INSERT a class for the same trainer at the same time in another room` | Error from sp_assert_trainer_free (called by the trigger) | ERROR 1644 Trainer is already teaching a class at that time | ✅ Pass |
| T31 | First booking takes the seat | `M1 books class C1 (capacity 1)` | status 'booked' | booking 3935: booked | ✅ Pass |
| T32 | Full class puts the next member on the waitlist | `M2 buys 'Monthly Plus' and books C1` | status 'waitlisted' | booking 3936: waitlisted | ✅ Pass |
| T33 | Same class cannot be booked twice | `M1 books C1 again` | Error 'You have already booked this class' | ERROR 1644 You have already booked this class | ✅ Pass |
| T34 | Cancelling promotes the first waitlisted member | `M1 cancels with sp_cancel_class_booking` | M1 cancelled, M2 promoted to booked | promoted member 114 (M2 = 114); statuses cancelled, booked | ✅ Pass |
| T35 | No booking without a membership | `M5 (no plan) books a class` | Error 'You need an active membership…' | ERROR 1644 You need an active membership on the day of this class | ✅ Pass |
| T36 | Weekly class limit of the plan | `New member M3 on 'Monthly Basic' (3 classes/week) books 4 classes in one week` | First 3 booked, next one refused | booked, booked, booked; then ERROR 1644 Weekly class limit of your plan reached | ✅ Pass |
| T37 | Cancelling a class cancels its bookings | `UPDATE class_sessions SET status = 'cancelled' for C1` | trg_class_sessions_au sets every booking of C1 to cancelled | bookings still open: 0 | ✅ Pass |

### 1.5 Personal training (5/5)

| ID | Test case | Input / action | Expected | Actual (database response) | Result |
|---|---|---|---|---|---|
| T38 | Request a PT session | `sp_book_pt_session(M1, trainer 1, 2026-11-16 10:00:00, 60 min)` | status 'requested', price 0 if the plan includes PT else the trainer's hourly rate | pt_session 169: requested, price ₹0.00 (plan includes 1) | ✅ Pass |
| T39 | Trainer cannot have two sessions at once | `M2 requests the same trainer at the same time` | Error from trg_pt_sessions_bi | ERROR 1644 Trainer already has a personal training session at that time | ✅ Pass |
| T40 | PT must be booked 2 hours ahead | `Start time NOW() + 1 hour` | Error 'Book personal training at least 2 hours ahead' | ERROR 1644 Book personal training at least 2 hours ahead | ✅ Pass |
| T41 | PT only during opening hours | `Start 21:30 for 60 minutes` | Error 'The gym is open from 06:00 to 22:00' | ERROR 1644 The gym is open from 06:00 to 22:00 | ✅ Pass |
| T42 | Finished PT session cannot be reopened | `Set status completed, then back to 'requested'` | Error from trg_pt_sessions_bu; status change written to audit_log | ERROR 1644 A finished or cancelled session cannot change status; audit rows for this session: 2 | ✅ Pass |

### 1.6 Scheduled events (procedures they call) (2/2)

| ID | Test case | Input / action | Expected | Actual (database response) | Result |
|---|---|---|---|---|---|
| T43 | Expired memberships are closed | `Move M5's new membership into the past, CALL sp_expire_memberships()` | status becomes 'expired' | end 2026-10-14 → expired | ✅ Pass |
| T44 | Finished classes are completed and absentees marked no-show | `Move a booked class into the past, CALL sp_close_finished_classes()` | class 'completed', booking 'no_show' | class completed, booking no_show | ✅ Pass |

### 1.7 Security (least privilege) (3/3)

| ID | Test case | Input / action | Expected | Actual (database response) | Result |
|---|---|---|---|---|---|
| T45 | App account cannot DROP a table | `DROP TABLE payments` | Access denied for gym_app | ERROR 1142 DROP command denied to user 'gym_app'@'localhost' for table 'payments' | ✅ Pass |
| T46 | App account cannot ALTER a table | `ALTER TABLE users ADD COLUMN x INT` | Access denied for gym_app | ERROR 1142 ALTER command denied to user 'gym_app'@'localhost' for table 'users' | ✅ Pass |
| T47 | App account cannot create triggers | `CREATE TRIGGER t BEFORE INSERT ON users FOR EACH ROW SET NEW.role = 'admin'` | Access denied for gym_app | ERROR 1419 You do not have the SUPER privilege and binary logging is enabled (you *might* want to use the less safe log_bin_trust_function_creators variable) | ✅ Pass |

### 1.8 MongoDB validation and indexes (8/8)

| ID | Test case | Input / action | Expected | Actual (database response) | Result |
|---|---|---|---|---|---|
| T48 | Valid workout log is accepted | `insertOne({ memberId, performedAt, durationMin: 45, rpe: 7, exercises: [ … 3 sets … ] })` | Document inserted | inserted 6af8a42e4c7e6075a6349b7f | ✅ Pass |
| T49 | Workout of 2 minutes with RPE 15 is rejected | `insertOne({"durationMin":2,"rpe":15,"exercises":[]})` | Document failed validation (durationMin 5–300, rpe 1–10) | code 121: Document failed validation | ✅ Pass |
| T50 | Unknown field inside a set is rejected | `insertOne({"durationMin":30,"rpe":5,"exercises":[{"name":"x","sets":[{"reps":5,"hack":true}]}]})` | Document failed validation (additionalProperties false) | code 121: Document failed validation | ✅ Pass |
| T51 | Log without memberId is rejected | `insertOne({"durationMin":30,"rpe":5,"exercises":[]})` | Document failed validation (memberId required) | code 121: Document failed validation | ✅ Pass |
| T52 | Workout plan needs at least one day | `workout_plans.insertOne({ …, days: [] })` | Document failed validation (minItems 1) | code 121: Document failed validation | ✅ Pass |
| T53 | Exercise slug is unique | `insert a second exercise with an existing slug` | Duplicate key error E11000 (index uq_slug) | code 11000: E11000 duplicate key error collection: gym_test_mongo.exercises index: uq_slug | ✅ Pass |
| T54 | Weighted text search ranks name matches first | `find({ $text: { $search: 'squat' } }) sorted by textScore` | Exercises with "squat" in the name come first | Goblet Squat (8.10), Barbell Back Squat (6.67), Box Jump (0.63) | ✅ Pass |
| T55 | Notifications expire after 60 days | `notifications.indexes()` | TTL index on createdAt with expireAfterSeconds 5184000 | ttl_60_days: { createdAt: 1 }, expireAfterSeconds 5184000 | ✅ Pass |

## 2. Manual end-to-end tests in the browser

Run by hand through the Next.js UI on the dates shown (2026-10-31 first build, 2026-11-02 full screen-by-screen run, 2026-11-11 new features) (results checked afterwards in MySQL Workbench and MongoDB Compass). They cover the same rules as section 1 but through the real forms, plus UI-only behaviour (redirects, messages, notifications).

| ID | Role / area | Steps | Expected and observed | Date | Result |
|---|---|---|---|---|---|
| U01 | Public | Register with phone "12345" | Browser blocks the form (pattern) before sending | 2026-11-02 | ✅ Pass |
| U02 | Public | Register with date of birth making the member 12 | Form shows "Members must be at least 14 years old" (trigger); typed values stay in the form | 2026-11-02 | ✅ Pass |
| U03 | Public | Register with valid data | Account GM000120 created, logged in, redirected to member home | 2026-11-02 | ✅ Pass |
| U04 | Public | Log in with a wrong password | Error message shown, user stays logged out | 2026-11-02 | ✅ Pass |
| U05 | Security | Read document.cookie in the browser console after login | gym_session not visible (httpOnly) | 2026-10-31 | ✅ Pass |
| U06 | Security | Trainer opens /admin | Redirected to /trainer (proxy + requireRole) | 2026-10-31 | ✅ Pass |
| U07 | Admin | Front desk: check in an expired member / an active member / the same member again | Refused / checked in / "already checked in" | 2026-10-31 | ✅ Pass |
| U08 | Admin | Create class in a room already in use | Room-clash error from trigger | 2026-11-02 | ✅ Pass |
| U09 | Admin | Create class with capacity above the room capacity | Capacity error from trigger | 2026-11-02 | ✅ Pass |
| U10 | Admin | Create a valid class without end time | Class created, end time filled from class type | 2026-11-02 | ✅ Pass |
| U11 | Admin | Cancel a class (confirm dialog) | Bookings cancelled and members notified in their inbox | 2026-11-02 | ✅ Pass |
| U12 | Admin | Create plan with freeze days > duration | CHECK constraint error shown | 2026-11-02 | ✅ Pass |
| U13 | Admin | Switch a plan off | Plan disappears from the sell list; old memberships keep it | 2026-11-02 | ✅ Pass |
| U14 | Admin | Sell a renewal to a member with an active plan | New membership queued after the current end date | 2026-11-02 | ✅ Pass |
| U15 | Admin | Refund a payment (confirm dialog) | Payment refunded, membership cancelled, member notified, audit_log row | 2026-11-02 | ✅ Pass |
| U16 | Admin | Reports page | Revenue, class popularity (HAVING), ranking (RANK), churn, never-booked, audit log render | 2026-10-31 | ✅ Pass |
| U17 | Admin | Gym setup: add trainer / room / class type | Rows created (trainer via sp_add_trainer: users + trainers in one transaction) | 2026-11-11 | ✅ Pass |
| U18 | Trainer | Confirm a requested PT session | Status confirmed | 2026-10-31 | ✅ Pass |
| U19 | Trainer | Mark a paid PT session done (choose payment method) | Session completed and payment inserted in the same transaction, recorded_by = trainer | 2026-11-02 | ✅ Pass |
| U20 | Trainer | Mark attendance Present for a class from yesterday | Allowed (2-day window); older classes locked | 2026-11-02 | ✅ Pass |
| U21 | Trainer | Build a plan with no exercises / a valid plan | Error / plan saved in MongoDB and member notified | 2026-11-02 | ✅ Pass |
| U22 | Trainer | Member cancels a PT session | Trainer receives a notification | 2026-11-11 | ✅ Pass |
| U23 | Member | Buy a plan, freeze, unfreeze | Status changes and end date shown correctly | 2026-11-02 | ✅ Pass |
| U24 | Member | Book a full class, then another member cancels | Waitlisted, then promoted with a notification | 2026-11-02 | ✅ Pass |
| U25 | Member | Waitlisted member already at weekly limit | Skipped during promotion; next eligible member promoted | 2026-11-11 | ✅ Pass |
| U26 | Member | Search trainers for "back pain" | Kavya Iyer (mobility, lower back) listed first (FULLTEXT) | 2026-10-31 | ✅ Pass |
| U27 | Member | Log a workout incl. "20 min" cardio item | Saved; cardio typed in minutes, stored as seconds; charts update | 2026-11-11 | ✅ Pass |
| U28 | Member | Record body weight outside / inside 25–300 kg | Rejected / saved and chart updated | 2026-11-02 | ✅ Pass |
| U29 | Member | Add a private exercise, build and activate own plan, delete it | Exercise visible only to this member; plan active then deleted | 2026-11-02 | ✅ Pass |
| U30 | Member | Edit profile; change password | Profile saved; password changed and password_changed_at set by trigger | 2026-11-11 | ✅ Pass |

## 3. Build checks

| Check | Command | Result |
|---|---|---|
| Lint (ESLint, Next.js rules) | `npm run lint` | No errors (2026-11-13) |
| Production build | `npm run build` | Compiles, all routes built (2026-11-11) |
| Database test suite | `node docs/tools/run-tests.mjs` | 55/55 passed (2026-11-14) |

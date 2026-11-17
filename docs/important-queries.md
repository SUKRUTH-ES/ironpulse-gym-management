# IronPulse — Important Queries

_Every query below is copied from the application code or the `db/` scripts, and every output table was produced by running it on the demo database with `node docs/tools/run-queries.mjs` (generated 2026-11-17). Long results are cut to the first rows._

## 1. SQL queries (MySQL `gym_db`)

### Q1. Revenue per membership plan, last 6 months

**Shows:** three-table JOIN, WHERE with date arithmetic, GROUP BY, COUNT/SUM, ORDER BY. Used on the admin Reports page (`src/app/admin/reports/page.js`).

```sql
SELECT p.name, COUNT(*) AS sold, SUM(pay.amount) AS revenue
FROM payments pay
JOIN memberships ms     ON ms.membership_id = pay.membership_id
JOIN membership_plans p ON p.plan_id = ms.plan_id
WHERE pay.status = 'completed' AND pay.paid_at >= CURRENT_DATE - INTERVAL 6 MONTH
GROUP BY p.plan_id, p.name
ORDER BY revenue DESC;
```

**Output** (run as `gym_app`):

| name | sold | revenue |
|---|---|---|
| Quarterly | 67 | 435500.00 |
| Monthly Plus | 86 | 215000.00 |
| Half-Yearly | 13 | 149500.00 |
| Monthly Basic | 93 | 139500.00 |
| Summer Shred 2026 | 8 | 31992.00 |
| Annual | 1 | 19999.00 |

### Q2. Class popularity — only class types with 5+ finished sessions

**Shows:** derived table (subquery in FROM), conditional SUM, AVG, NULLIF, GROUP BY + HAVING. Reports page. The derived table counts seats used per session; HAVING filters groups after aggregation.

```sql
SELECT ct.name, COUNT(DISTINCT cs.class_session_id) AS sessions,
       ROUND(AVG(fill.booked / cs.capacity) * 100, 1) AS avg_fill_pct,
       ROUND(SUM(fill.no_show) / NULLIF(SUM(fill.booked), 0) * 100, 1) AS no_show_pct
FROM class_sessions cs
JOIN class_types ct ON ct.class_type_id = cs.class_type_id
JOIN (SELECT class_session_id,
             SUM(status IN ('attended','no_show')) AS booked,
             SUM(status = 'no_show') AS no_show
      FROM class_bookings GROUP BY class_session_id) fill
  ON fill.class_session_id = cs.class_session_id
WHERE cs.status = 'completed'
GROUP BY ct.class_type_id, ct.name
HAVING COUNT(DISTINCT cs.class_session_id) >= 5
ORDER BY avg_fill_pct DESC;
```

**Output** (run as `gym_app`):

| name | sessions | avg_fill_pct | no_show_pct |
|---|---|---|---|
| Zumba | 37 | 77.1 | 10.9 |
| Spin Cycle | 36 | 75.9 | 16.1 |
| CrossFit WOD | 37 | 71.5 | 16.0 |
| HIIT Blast | 37 | 67.9 | 13.3 |
| Yoga Flow | 37 | 60.4 | 11.0 |
| Strength Circuit | 28 | 58.6 | 14.2 |
| Power Yoga | 17 | 57.6 | 10.2 |
| Boxing Fit | 18 | 54.1 | 8.9 |

_…2 more rows (10 total)_

### Q3. Top 10 most consistent members (last 30 days)

**Shows:** window function RANK() OVER, subquery in FROM, GROUP BY. Reports page. Members with the same number of visits share a rank.

```sql
SELECT * FROM (
    SELECT m.member_id, u.full_name, COUNT(*) AS visits,
           RANK() OVER (ORDER BY COUNT(*) DESC) AS position
    FROM attendance a
    JOIN members m ON m.member_id = a.member_id
    JOIN users u   ON u.user_id = m.user_id
    WHERE a.check_in >= CURRENT_DATE - INTERVAL 30 DAY
    GROUP BY m.member_id, u.full_name) ranked
WHERE position <= 10
ORDER BY position, full_name;
```

**Output** (run as `gym_app`):

| member_id | full_name | visits | position |
|---|---|---|---|
| 78 | Priya Nair | 26 | 1 |
| 74 | Ananya Gupta | 25 | 2 |
| 55 | Isha Iyer | 25 | 2 |
| 77 | Pranav Verma | 25 | 2 |
| 45 | Kunal Joshi | 24 | 5 |
| 58 | Neha Reddy | 24 | 5 |
| 50 | Ritu Chatterjee | 24 | 5 |
| 46 | Shaurya Nair | 24 | 5 |

_…6 more rows (14 total)_

### Q4. Active members who never booked a class

**Shows:** correlated NOT EXISTS subquery on a view. Reports page — a list for the front desk to follow up.

```sql
SELECT mo.member_id, mo.full_name, mo.plan_name, mo.joined_on
FROM v_member_overview mo
WHERE mo.membership_status = 'active'
  AND NOT EXISTS (SELECT 1 FROM class_bookings cb WHERE cb.member_id = mo.member_id)
ORDER BY mo.joined_on DESC;
```

**Output** (run as `gym_app`):

_(no rows)_

### Q5. Full-text trainer search: "back pain"

**Shows:** FULLTEXT index `ft_trainers_profile`, MATCH … AGAINST in NATURAL LANGUAGE MODE, relevance score, prepared-statement parameters (?). Member → Training page (`src/app/member/training/page.js`). The member types a problem in plain words; MySQL ranks trainers by relevance.

```sql
SELECT t.trainer_id, u.full_name, t.specialization,
       MATCH(t.specialization, t.bio) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
FROM trainers t JOIN users u ON u.user_id = t.user_id
WHERE u.is_active AND MATCH(t.specialization, t.bio) AGAINST (? IN NATURAL LANGUAGE MODE)
ORDER BY score DESC;
```

**Output** (run as `gym_app`, parameters ["back pain","back pain"]):

| trainer_id | full_name | specialization | score |
|---|---|---|---|
| 2 | Kavya Iyer | Yoga, mobility and flexibility | 0.9771181344985962 |

### Q6. View `v_member_overview` (definition + use)

**Shows:** a view built on another view (LEFT JOIN v_current_memberships), CASE + EXISTS, a correlated scalar subquery (last_visit), derived attributes (age, days_left). Used by the admin Members list, member detail and the Reports page.

```sql
CREATE OR REPLACE VIEW v_member_overview AS
SELECT m.member_id, m.member_code, u.user_id, u.full_name, u.email, u.phone,
       u.is_active, m.gender, m.date_of_birth,
       TIMESTAMPDIFF(YEAR, m.date_of_birth, CURRENT_DATE) AS age,
       m.fitness_goal, m.joined_on,
       cm.membership_id, cm.plan_name, cm.end_date AS membership_end,
       cm.days_left,
       COALESCE(cm.status,
                CASE WHEN EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = m.member_id)
                     THEN 'expired' ELSE 'none' END) AS membership_status,
       (SELECT MAX(a.check_in) FROM attendance a WHERE a.member_id = m.member_id) AS last_visit
FROM members m
JOIN users u ON u.user_id = m.user_id
LEFT JOIN v_current_memberships cm ON cm.member_id = m.member_id;
```

**Output** of `SELECT member_code, full_name, age, plan_name, days_left, membership_status, last_visit FROM v_member_overview ORDER BY member_id LIMIT 6`:

| member_code | full_name | age | plan_name | days_left | membership_status | last_visit |
|---|---|---|---|---|---|---|
| GM000007 | Abhishek Kulkarni | 49 | NULL | NULL | none | NULL |
| GM000008 | Reyansh Gupta | 54 | NULL | NULL | none | NULL |
| GM000009 | Alex Sharma | 42 | NULL | NULL | none | NULL |
| GM000010 | Saanvi Rao | 47 | NULL | NULL | none | NULL |
| GM000011 | Kiara Mishra | 18 | NULL | NULL | expired | 2026-11-13 19:24:00 |
| GM000012 | Nandini Kulkarni | 54 | Monthly Plus | 3 | active | 2026-11-13 06:23:00 |

### Q7. Churn risk (view `v_churn_risk`)

**Shows:** view on top of a view, derived table with conditional SUM over two 30-day windows; queried like a table. Admin Reports: members whose visits in the last 30 days dropped below half of the 30 days before.

```sql
SELECT member_code, full_name, plan_name, visits_prev_30, visits_last_30, days_since_last_visit
FROM v_churn_risk
ORDER BY visits_last_30 / visits_prev_30
LIMIT 8;
```

**Output** (run as `gym_app`):

| member_code | full_name | plan_name | visits_prev_30 | visits_last_30 | days_since_last_visit |
|---|---|---|---|---|---|
| GM000040 | Rahul Kumar | Monthly Plus | 22 | 1 | 4 |
| GM000041 | Mohit Desai | Monthly Basic | 21 | 2 | 21 |
| GM000042 | Varun Sharma | Monthly Plus | 22 | 3 | 10 |
| GM000046 | Siddharth Sharma | Monthly Plus | 22 | 3 | 4 |
| GM000044 | Tejas Kumar | Monthly Basic | 20 | 3 | 11 |
| GM000039 | Varun Kumar | Quarterly | 19 | 3 | 18 |
| GM000035 | Shruti Kulkarni | Monthly Plus | 17 | 3 | 3 |
| GM000038 | Krishna Reddy | Quarterly | 21 | 4 | 12 |

### Q8. Monthly revenue (view `v_monthly_revenue`)

**Shows:** view with GROUP BY on DATE_FORMAT and conditional SUM(CASE …). Admin dashboard chart.

```sql
SELECT * FROM v_monthly_revenue ORDER BY month DESC LIMIT 6;
```

**Output** (run as `gym_app`):

| month | membership_revenue | pt_revenue | total_revenue | payment_count |
|---|---|---|---|---|
| 2026-11 | 107499.00 | 4800.00 | 112299.00 | 43 |
| 2026-10 | 186000.00 | 8100.00 | 194100.00 | 63 |
| 2026-09 | 139499.00 | 5300.00 | 144799.00 | 46 |
| 2026-08 | 161998.00 | 3000.00 | 164998.00 | 45 |
| 2026-07 | 165499.00 | 5600.00 | 171099.00 | 46 |
| 2026-06 | 151497.00 | 0.00 | 151497.00 | 36 |

### Q9. Stored function `fn_member_status` used inside a query

**Shows:** user-defined function in SELECT and in GROUP BY. A stored function can be used anywhere an expression is allowed; here it groups every member by current membership status (active / frozen / expired / none). This query is a demonstration in this document: the application pages use the related function `fn_active_membership_id`, which `sp_book_class`, `sp_cancel_class_booking` and `sp_book_pt_session` call to find the membership valid on a given day.

```sql
SELECT fn_member_status(member_id) AS status, COUNT(*) AS members
FROM members
GROUP BY status
ORDER BY members DESC;
```

**Output** (run as `gym_app`):

| status | members |
|---|---|
| active | 86 |
| expired | 17 |
| none | 4 |
| frozen | 3 |

### Q10. Stored procedure `sp_book_class` (transaction + row lock)

**Shows:** START TRANSACTION / COMMIT, `SELECT … FOR UPDATE` row lock so two members cannot take the last seat at the same time, business rules raised with `SIGNAL SQLSTATE '45000'`, EXIT HANDLER that rolls back, OUT parameters. Called from the member Classes page with `CALL sp_book_class(?, ?, @id, @status)`.

```sql
CREATE PROCEDURE sp_book_class(IN p_member_id INT UNSIGNED, IN p_class_session_id INT UNSIGNED,
                               OUT o_booking_id INT UNSIGNED, OUT o_status VARCHAR(12))
BEGIN
    DECLARE v_capacity SMALLINT UNSIGNED;
    DECLARE v_starts DATETIME;
    DECLARE v_session_status VARCHAR(12);
    DECLARE v_taken INT;
    DECLARE v_weekly_limit TINYINT UNSIGNED;
    DECLARE v_membership_id INT UNSIGNED;
    DECLARE v_existing_id INT UNSIGNED DEFAULT NULL;
    DECLARE v_existing_status VARCHAR(12) DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
        SELECT capacity, starts_at, status INTO v_capacity, v_starts, v_session_status
        FROM class_sessions WHERE class_session_id = p_class_session_id
        FOR UPDATE;

        IF v_starts IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Class not found';
        END IF;
        IF v_session_status <> 'scheduled' OR v_starts <= NOW() THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This class is no longer open for booking';
        END IF;

        SET v_membership_id = fn_active_membership_id(p_member_id, DATE(v_starts));
        IF v_membership_id IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You need an active membership on the day of this class';
        END IF;

        SELECT p.classes_per_week INTO v_weekly_limit
        FROM memberships ms JOIN membership_plans p ON p.plan_id = ms.plan_id
        WHERE ms.membership_id = v_membership_id;
        IF v_weekly_limit IS NOT NULL
           AND fn_classes_booked_in_week(p_member_id, DATE(v_starts)) >= v_weekly_limit THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Weekly class limit of your plan reached';
        END IF;

        SELECT booking_id, status INTO v_existing_id, v_existing_status
        FROM class_bookings
        WHERE class_session_id = p_class_session_id AND member_id = p_member_id;
        IF v_existing_status IN ('booked','waitlisted') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You have already booked this class';
        END IF;

        SELECT COUNT(*) INTO v_taken
        FROM class_bookings
        WHERE class_session_id = p_class_session_id AND status = 'booked';

        SET o_status = IF(v_taken < v_capacity, 'booked', 'waitlisted');

        IF v_existing_id IS NOT NULL THEN
            -- re-booking after an earlier cancellation: goes to the back of the queue
            UPDATE class_bookings SET status = o_status, booked_at = CURRENT_TIMESTAMP(3)
            WHERE booking_id = v_existing_id;
            SET o_booking_id = v_existing_id;
        ELSE
            INSERT INTO class_bookings (class_session_id, member_id, status)
            VALUES (p_class_session_id, p_member_id, o_status);
            SET o_booking_id = LAST_INSERT_ID();
        END IF;
    COMMIT;
END$$
```

### Q11. Trigger `trg_attendance_bi` (validation in the database)

**Shows:** BEFORE INSERT trigger that refuses a check-in when the membership is frozen, missing/expired, or the member is already inside — even if a bug in the app tried to insert the row.

```sql
CREATE TRIGGER trg_attendance_bi BEFORE INSERT ON attendance FOR EACH ROW
BEGIN
    IF EXISTS (SELECT 1 FROM memberships
               WHERE member_id = NEW.member_id AND status = 'frozen'
                 AND DATE(NEW.check_in) BETWEEN start_date AND end_date) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Membership is frozen. Unfreeze it to check in';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM memberships
                   WHERE member_id = NEW.member_id
                     AND status IN ('active','expired')
                     AND DATE(NEW.check_in) BETWEEN start_date AND end_date) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member has no active membership for today';
    END IF;

    IF EXISTS (SELECT 1 FROM attendance
               WHERE member_id = NEW.member_id AND check_out IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member is already checked in';
    END IF;
END$$
```

### Q12. Trigger `trg_payments_au` + `trg_payments_bd` (audit + no deletes)

**Shows:** AFTER UPDATE trigger writing a JSON before/after image into `audit_log`, and a BEFORE DELETE trigger that blocks deleting payments.

```sql
CREATE TRIGGER trg_payments_au AFTER UPDATE ON payments FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, record_id, action, old_value, new_value, changed_by)
    VALUES ('payments', NEW.payment_id, 'UPDATE',
            JSON_OBJECT('status', OLD.status), JSON_OBJECT('status', NEW.status), USER());
END$$

CREATE TRIGGER trg_payments_bd BEFORE DELETE ON payments FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payments cannot be deleted; refund them instead';
END$$
```

### Q13. Scheduled event `ev_class_housekeeping`

**Shows:** MySQL Event Scheduler running a procedure every 15 minutes: finished classes → completed, unattended bookings → no_show, forgotten check-outs closed after 4 h, stale PT requests cancelled.

```sql
CREATE PROCEDURE sp_close_finished_classes()
BEGIN
    UPDATE class_bookings cb
    JOIN class_sessions cs ON cs.class_session_id = cb.class_session_id
    SET cb.status = CASE cb.status WHEN 'booked' THEN 'no_show' ELSE 'cancelled' END
    WHERE cs.status = 'scheduled' AND cs.ends_at < NOW()
      AND cb.status IN ('booked','waitlisted');

    UPDATE class_sessions SET status = 'completed'
    WHERE status = 'scheduled' AND ends_at < NOW();

    UPDATE attendance SET check_out = check_in + INTERVAL 4 HOUR
    WHERE check_out IS NULL AND check_in < NOW() - INTERVAL 4 HOUR;

    UPDATE pt_sessions SET status = 'cancelled'
    WHERE status = 'requested' AND starts_at < NOW();
END$$

CREATE EVENT ev_class_housekeeping
    ON SCHEDULE EVERY 15 MINUTE
    DO CALL sp_close_finished_classes();
```

### Q14. Index use: EXPLAIN of a member's visit history

**Shows:** EXPLAIN, composite index. The composite index on attendance(member_id, check_in) lets MySQL read one member's visits without scanning all attendance rows.

```sql
EXPLAIN SELECT check_in, check_out
FROM attendance
WHERE member_id = ? AND check_in >= CURRENT_DATE - INTERVAL 30 DAY;
```

**Output** (run as `gym_app`, parameters [58]):

| table | type | possible_keys | key | key_len | rows | Extra |
|---|---|---|---|---|---|---|
| attendance | range | idx_attendance_member, idx_attendance_check_in | idx_attendance_member | 9 | 24 | Using index condition |

## 2. Integrity enforced by the database

Each statement below was sent **as the application account `gym_app`** inside a transaction that was then rolled back. The database itself refuses the bad data — the error text is the real MySQL response.

| # | Rule | Statement | MySQL response |
|---|---|---|---|
| 1 | CHECK constraint `chk_payments_target`: a payment must be for exactly one thing | `INSERT INTO payments (member_id, membership_id, pt_session_id, amount, method, transaction_ref) VALUES (1, NULL, NULL, 500, 'cash', 'DEMO-1');` | ERROR 3819 (HY000): Check constraint 'chk_payments_target' is violated. |
| 2 | CHECK constraint `chk_users_phone`: Indian mobile format | `INSERT INTO users (email, password_hash, role, full_name, phone) VALUES ('x@demo.test', REPEAT('x', 60), 'member', 'Test User', '12345');` | ERROR 3819 (HY000): Check constraint 'chk_users_phone' is violated. |
| 3 | UNIQUE `uq_users_email`: e-mail already registered | `INSERT INTO users (email, password_hash, role, full_name) SELECT email, REPEAT('x', 60), 'member', 'Copy' FROM users LIMIT 1;` | ERROR 1062 (23000): Duplicate entry 'aadhya.kumar@mail.test' for key 'users.uq_users_email' |
| 4 | Trigger `trg_members_bu`: member must be at least 14 | `UPDATE members SET date_of_birth = CURRENT_DATE - INTERVAL 10 YEAR WHERE member_id = 1;` | ERROR 1644 (45000): Members must be between 14 and 100 years old |
| 5 | Trigger `trg_payments_bd`: payments can never be deleted | `DELETE FROM payments WHERE payment_id = 1;` | ERROR 1644 (45000): Payments cannot be deleted; refund them instead |
| 6 | Trigger `trg_payments_bu`: amount of a recorded payment cannot be changed | `UPDATE payments SET amount = 1 WHERE payment_id = 1;` | ERROR 1644 (45000): Payment details cannot be edited; refund it instead |
| 7 | Foreign key: booking for a class that does not exist | `INSERT INTO class_bookings (class_session_id, member_id, status) VALUES (999999, 1, 'booked');` | ERROR 1216 (23000): Cannot add or update a child row: a foreign key constraint fails |
| 8 | Stored procedure business rule: check-in with an unknown member code | `CALL sp_check_in('GM999999', @a, @b);` | ERROR 1644 (45000): No active member with that code |
| 9 | Least privilege: the app account cannot drop tables | `DROP TABLE payments;` | ERROR 1142 (42000): DROP command denied to user 'gym_app'@'localhost' for table 'payments' |

## 3. MongoDB queries (`gym_mongo`)

_Member used for the per-member examples: memberId 58 (the member with the most workout logs)._

### Q15. Weekly training volume (aggregation pipeline)

**Shows:** $match, $unwind, $group with $dateTrunc, $sum of $multiply, $addToSet, $avg, $project, $size, $sort. Member → Workouts page chart (`src/app/member/workouts/page.js`). Two `$unwind`s flatten exercises and sets; `$dateTrunc` groups by Monday-start week in Indian time.

```js
db.workout_logs.aggregate([
  { $match: { memberId: 58, performedAt: { $gte: <8 weeks ago> } } },
  { $unwind: { path: '$exercises', preserveNullAndEmptyArrays: true } },
  { $unwind: { path: '$exercises.sets', preserveNullAndEmptyArrays: true } },
  { $group: {
      _id: { $dateTrunc: { date: '$performedAt', unit: 'week', startOfWeek: 'monday', timezone: 'Asia/Kolkata' } },
      volume:   { $sum: { $multiply: [{ $ifNull: ['$exercises.sets.reps', 0] }, { $ifNull: ['$exercises.sets.weightKg', 0] }] } },
      workouts: { $addToSet: '$_id' },
      avgRpe:   { $avg: '$rpe' } } },
  { $project: { volume: 1, workouts: { $size: '$workouts' }, avgRpe: { $round: ['$avgRpe', 1] } } },
  { $sort: { _id: 1 } }
])
```

**Output:**

| volume | week | workouts | avgRpe |
|---|---|---|---|
| 13257.5 | 2026-09-20 | 4 | 7 |
| 20040 | 2026-09-27 | 5 | 7.2 |
| 20425 | 2026-10-04 | 5 | 7.6 |
| 13530 | 2026-10-11 | 4 | 7 |
| 17792.5 | 2026-10-18 | 4 | 7.7 |
| 23465 | 2026-10-25 | 6 | 7.5 |
| 19087.5 | 2026-11-01 | 4 | 5.7 |
| 22332.5 | 2026-11-08 | 5 | 6.2 |

### Q16. Personal records (heaviest set per exercise)

**Shows:** $unwind, $match on nested field, $sort, $group with $first, $limit. Workouts page "Personal records" card. Sorting before `$group` lets `$first` pick the heaviest set and the date it happened.

```js
db.workout_logs.aggregate([
  { $match: { memberId: 58 } },
  { $unwind: '$exercises' },
  { $unwind: '$exercises.sets' },
  { $match: { 'exercises.sets.weightKg': { $gt: 0 } } },
  { $sort: { 'exercises.sets.weightKg': -1, performedAt: 1 } },
  { $group: { _id: '$exercises.name', bestKg: { $first: '$exercises.sets.weightKg' },
              reps: { $first: '$exercises.sets.reps' }, on: { $first: '$performedAt' } } },
  { $sort: { bestKg: -1 } },
  { $limit: 8 }
])
```

**Output:**

| bestKg | reps | on | exercise |
|---|---|---|---|
| 75 | 10 | 2026-11-14 06:55 | Leg Press |
| 45 | 9 | 2026-11-08 05:50 | Hip Thrust |
| 45 | 6 | 2026-11-08 05:50 | Barbell Back Squat |
| 37.5 | 7 | 2026-11-03 04:03 | Romanian Deadlift |
| 37.5 | 6 | 2026-11-09 09:34 | Barbell Bench Press |
| 30 | 11 | 2026-11-02 14:29 | Seated Cable Row |
| 30 | 8 | 2026-11-02 14:29 | Bent-Over Barbell Row |
| 30 | 11 | 2026-10-31 13:52 | Standing Calf Raise |

### Q17. Weighted full-text search over exercises: "shoulder press"

**Shows:** $text search, textScore projection and sort, $in with null for shared-or-mine visibility. Member → Exercises page. The text index weights name 10, primaryMuscle 6, tags 4, instructions 1; private exercises of other members are hidden.

```js
db.exercises.find(
  { createdBy: { $in: [null, 58] }, $text: { $search: 'shoulder press' } },
  { projection: { name: 1, primaryMuscle: 1, level: 1, score: { $meta: 'textScore' } },
    sort: { score: { $meta: 'textScore' } } }
).limit(6)
```

**Output:**

| name | primaryMuscle | level | score |
|---|---|---|---|
| Overhead Press | shoulders | intermediate | 14.1 |
| Leg Press | quadriceps | beginner | 8.75 |
| Barbell Bench Press | chest | intermediate | 7.93 |
| Incline Dumbbell Press | chest | beginner | 7.33 |
| Lateral Raise | shoulders | beginner | 6.6 |
| Face Pull | rear deltoids | beginner | 3.63 |

### Q18. Most logged exercises across all members (last 30 days)

**Shows:** $unwind, $group with $sum and $addToSet, $size, $sort, $limit. Exercises page "Popular right now".

```js
db.workout_logs.aggregate([
  { $match: { performedAt: { $gte: <30 days ago> } } },
  { $unwind: '$exercises' },
  { $group: { _id: '$exercises.name', times: { $sum: 1 }, members: { $addToSet: '$memberId' } } },
  { $project: { times: 1, members: { $size: '$members' } } },
  { $sort: { times: -1 } },
  { $limit: 6 }
])
```

**Output:**

| times | exercise | members |
|---|---|---|
| 156 | Face Pull | 28 |
| 155 | Plank | 31 |
| 129 | Incline Dumbbell Press | 29 |
| 128 | Dead Bug | 26 |
| 99 | Walking Lunge | 21 |
| 94 | Romanian Deadlift | 20 |

### Q19. Body-weight trend from the time-series collection

**Shows:** time-series collection, $group by $dateTrunc, $avg, $min/$max. Workouts page weight chart: one average per week, read from the `body_metrics` time-series collection.

```js
db.body_metrics.aggregate([
  { $match: { memberId: 58 } },
  { $group: { _id: { $dateTrunc: { date: '$recordedAt', unit: 'week' } },
              avgKg: { $avg: '$weightKg' }, minKg: { $min: '$weightKg' }, maxKg: { $max: '$weightKg' } } },
  { $sort: { _id: -1 } },
  { $limit: 6 }
])
```

**Output:**

| minKg | maxKg | week | avgKg |
|---|---|---|---|
| 72.2 | 72.2 | 2026-11-08 | 72.2 |
| 71.9 | 71.9 | 2026-11-01 | 71.9 |
| 71.4 | 71.4 | 2026-10-25 | 71.4 |
| 71.1 | 71.1 | 2026-10-18 | 71.1 |
| 70.6 | 70.6 | 2026-10-11 | 70.6 |
| 70.4 | 70.4 | 2026-10-04 | 70.4 |

### Q20. Schema validation in MongoDB

**Shows:** the `$jsonSchema` validator rejects a workout of 2 minutes with RPE 15 (allowed: 5–300 min, RPE 1–10).

```js
db.workout_logs.insertOne({ memberId: 58, performedAt: new Date(), durationMin: 2, rpe: 15, exercises: [] })
```

**Output:** `Document failed validation (code 121)`

## 4. Where each requirement is shown

| Requirement (course PDF) | Query |
|---|---|
| JOIN, GROUP BY, ORDER BY, aggregates | Q1, Q2, Q3 |
| HAVING | Q2 |
| Subqueries (FROM, NOT EXISTS, scalar) | Q2, Q3, Q4, Q6 |
| Views | Q6, Q7, Q8 |
| Functions / procedures | Q9, Q10 |
| Transactions + locking | Q10 |
| Triggers | Q11, Q12, section 2 |
| Events | Q13 |
| Indexing | Q5 (FULLTEXT), Q14 (EXPLAIN), Q17 (text index) |
| Full-text search | Q5, Q17 |
| NoSQL aggregation | Q15, Q16, Q18, Q19 |
| Validation at database level | section 2, Q20 |

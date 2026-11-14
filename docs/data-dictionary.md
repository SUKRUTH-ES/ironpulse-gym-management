# IronPulse — Data Dictionary

_Generated from the live databases by `docs/tools/make_dictionary.py` (MySQL `information_schema` + MongoDB). Do not edit by hand; re-run `node docs/tools/dump-schema.mjs` and the script after a schema change._

MySQL database `gym_db`: **13 tables, 16 foreign keys, 22 CHECK constraints, 7 views, 4 functions, 13 procedures, 18 triggers, 2 events.** MongoDB database `gym_mongo`: **5 collections.**

Key: PK primary key · FK foreign key · UQ unique · Null "NO" = NOT NULL.

## 1. MySQL tables

### 1.1 `users`

Every login account (admin, trainer or member). One row per person who can sign in. _(rows now: 116)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `user_id` | int unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `email` | varchar(255) | NO | UQ |  | Login e-mail, stored lower-case by trigger |
| `password_hash` | char(60) | NO |  |  | bcrypt hash (60 chars), never the plain password |
| `password_changed_at` | datetime | YES |  |  | Set by trg_users_bu when the hash changes |
| `role` | enum('admin','trainer','member') | NO |  |  | admin / trainer / member |
| `full_name` | varchar(100) | NO |  |  | Display name |
| `phone` | char(10) | YES | UQ |  | Indian mobile number, 10 digits |
| `is_active` | tinyint(1) | NO |  | 1 | 0 = account deactivated (cannot log in) |
| `created_at` | datetime | NO |  | CURRENT_TIMESTAMP | Account creation time |
| `last_login_at` | datetime | YES |  |  | Updated on each successful login |

**CHECK constraints:** `chk_users_email`: `regexp_like(email,'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')`; `chk_users_name`: `(char_length(trim(full_name)) >= 2)`; `chk_users_phone`: `regexp_like(phone,'^[6-9][0-9]{9}$')`

**Indexes:** `uq_users_email` (UNIQUE email); `uq_users_phone` (UNIQUE phone)

**Triggers:** `trg_users_bi` (BEFORE INSERT), `trg_users_bu` (BEFORE UPDATE)

### 1.2 `members`

Gym member profile; 1:1 with a users row of role member. _(rows now: 110)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `member_id` | int unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `user_id` | int unsigned | NO | FK → users.user_id (CASCADE), UQ |  | Login account of the member |
| `member_code` | char(8) | NO | UQ |  | Card code shown at the front desk = 'GM' + 6-digit user_id |
| `date_of_birth` | date | NO |  |  | Age must be 14–100 (trg_members_bi/bu) |
| `gender` | enum('male','female','other') | NO |  |  | male / female / other |
| `height_cm` | decimal(5,1) | YES |  |  | Optional, 100–250 |
| `fitness_goal` | enum('weight_loss','muscle_gain','endurance','flexibility','general_fitness') | NO |  | general_fitness | Goal chosen at registration |
| `emergency_contact_name` | varchar(100) | YES |  |  | Composite attribute Emergency_contact (part 1) |
| `emergency_contact_phone` | char(10) | YES |  |  | Composite attribute Emergency_contact (part 2) |
| `joined_on` | date | NO |  | CURRENT_DATE | Registration date |

**CHECK constraints:** `chk_members_code`: `regexp_like(member_code,'^GM[0-9]{6}$')`; `chk_members_ephone`: `((emergency_contact_phone is null) or regexp_like(emergency_contact_phone,'^[6-9][0-9]{9}$'))`; `chk_members_height`: `((height_cm is null) or (height_cm between 100 and 250))`

**Indexes:** `uq_members_code` (UNIQUE member_code); `uq_members_user` (UNIQUE user_id)

**Triggers:** `trg_members_bi` (BEFORE INSERT), `trg_members_bu` (BEFORE UPDATE)

### 1.3 `trainers`

Trainer profile; 1:1 with a users row of role trainer. _(rows now: 5)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `trainer_id` | int unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `user_id` | int unsigned | NO | FK → users.user_id (CASCADE), UQ |  | Login account of the trainer |
| `specialization` | varchar(100) | NO |  |  | Searched with FULLTEXT (MATCH … AGAINST) |
| `bio` | text | YES |  |  | Free text, FULLTEXT-indexed |
| `experience_years` | tinyint unsigned | NO |  | 0 | 0–50 |
| `session_rate` | decimal(8,2) | NO |  |  | Price of one PT hour (₹) |
| `accepts_pt` | tinyint(1) | NO |  | 1 | Added with ALTER TABLE; 0 hides the trainer from PT requests |
| `hired_on` | date | NO |  |  | Hire date |

**CHECK constraints:** `chk_trainers_exp`: `(experience_years <= 50)`; `chk_trainers_rate`: `(session_rate > 0)`

**Indexes:** `ft_trainers_profile` (FULLTEXT specialization,bio); `uq_trainers_user` (UNIQUE user_id)

### 1.4 `membership_plans`

Catalogue of plans the gym sells (Monthly, Quarterly, Day Pass, …). _(rows now: 7)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `plan_id` | smallint unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `name` | varchar(50) | NO | UQ |  | Plan name shown to members |
| `description` | varchar(255) | YES |  |  | Marketing text |
| `duration_days` | smallint unsigned | NO |  |  | 1–730 days |
| `price` | decimal(10,2) | NO |  |  | Price in ₹ |
| `classes_per_week` | tinyint unsigned | YES |  |  | NULL = unlimited group classes |
| `pt_sessions_included` | tinyint unsigned | NO |  | 0 | Free PT sessions per membership |
| `max_freeze_days` | smallint unsigned | NO |  | 0 | Total days the membership may be frozen (≤ duration) |
| `is_active` | tinyint(1) | NO |  | 1 | 0 = no longer sold (old memberships keep it) |

**CHECK constraints:** `chk_plans_duration`: `(duration_days between 1 and 730)`; `chk_plans_freeze`: `(max_freeze_days <= duration_days)`; `chk_plans_price`: `(price >= 0)`

**Indexes:** `uq_plans_name` (UNIQUE name)

### 1.5 `memberships`

One purchased plan period for a member (renewals are new rows queued after the current one). _(rows now: 371)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `membership_id` | int unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `member_id` | int unsigned | NO | FK → members.member_id |  | Owner |
| `plan_id` | smallint unsigned | NO | FK → membership_plans.plan_id |  | Plan bought |
| `start_date` | date | NO |  |  | First valid day |
| `end_date` | date | NO |  |  | Last valid day; filled from the plan by trigger if NULL |
| `status` | enum('active','frozen','expired','cancelled') | NO |  | active | active / frozen / expired (event) / cancelled (refund) |
| `freeze_days_used` | smallint unsigned | NO |  | 0 | Days frozen so far |
| `frozen_from` | date | YES |  |  | Set only while status = frozen |
| `created_at` | datetime | NO |  | CURRENT_TIMESTAMP | Purchase time |

**CHECK constraints:** `chk_memberships_dates`: `(end_date >= start_date)`; `chk_memberships_frozen`: `((status = 'frozen') = (frozen_from is not null))`

**Indexes:** `fk_memberships_plan` (plan_id); `idx_memberships_member_dates` (member_id,start_date,end_date); `idx_memberships_status_end` (status,end_date)

**Triggers:** `trg_memberships_au` (AFTER UPDATE), `trg_memberships_bi` (BEFORE INSERT), `trg_memberships_bu` (BEFORE UPDATE)

### 1.6 `payments`

Money received, either for a membership or for a PT session. Never deleted; refunds change the status. _(rows now: 400)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `payment_id` | int unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `member_id` | int unsigned | NO | FK → members.member_id |  | Payer |
| `membership_id` | int unsigned | YES | FK → memberships.membership_id |  | Set for a membership payment |
| `pt_session_id` | int unsigned | YES | FK → pt_sessions.pt_session_id |  | Set for a PT payment |
| `amount` | decimal(10,2) | NO |  |  | > 0 |
| `method` | enum('cash','card','upi','netbanking') | NO |  |  | cash / card / upi / netbanking |
| `status` | enum('completed','refunded') | NO |  | completed | completed / refunded (never back) |
| `transaction_ref` | varchar(40) | NO | UQ |  | Unique receipt reference |
| `paid_at` | datetime | NO |  | CURRENT_TIMESTAMP | Payment time |
| `recorded_by` | int unsigned | YES | FK → users.user_id |  | Staff user who took the payment (NULL = online) |

**CHECK constraints:** `chk_payments_amount`: `(amount > 0)`; `chk_payments_target`: `(((membership_id is not null) + (pt_session_id is not null)) = 1)`

**Indexes:** `fk_payments_membership` (membership_id); `fk_payments_pt` (pt_session_id); `fk_payments_recorder` (recorded_by); `idx_payments_member` (member_id,paid_at); `idx_payments_paid_at` (paid_at); `uq_payments_ref` (UNIQUE transaction_ref)

**Triggers:** `trg_payments_ai` (AFTER INSERT), `trg_payments_au` (AFTER UPDATE), `trg_payments_bd` (BEFORE DELETE), `trg_payments_bu` (BEFORE UPDATE)

### 1.7 `rooms`

Physical studios where group classes take place. _(rows now: 4)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `room_id` | smallint unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `name` | varchar(50) | NO | UQ |  | Room name |
| `capacity` | smallint unsigned | NO |  |  | Max people, 1–200 |

**CHECK constraints:** `chk_rooms_capacity`: `(capacity between 1 and 200)`

**Indexes:** `uq_rooms_name` (UNIQUE name)

### 1.8 `class_types`

Kinds of group class (Yoga, HIIT, Spin, …). _(rows now: 10)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `class_type_id` | smallint unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `name` | varchar(50) | NO | UQ |  | Class name |
| `description` | text | YES |  |  | FULLTEXT-indexed text |
| `intensity` | enum('low','medium','high') | NO |  |  | low / medium / high |
| `duration_min` | smallint unsigned | NO |  |  | Default length, 15–180 minutes |

**CHECK constraints:** `chk_class_types_duration`: `(duration_min between 15 and 180)`

**Indexes:** `ft_class_types` (FULLTEXT name,description); `uq_class_types_name` (UNIQUE name)

### 1.9 `class_sessions`

One scheduled occurrence of a class type, with a trainer, a room and a time. _(rows now: 339)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `class_session_id` | int unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `class_type_id` | smallint unsigned | NO | FK → class_types.class_type_id |  | What is taught |
| `trainer_id` | int unsigned | NO | FK → trainers.trainer_id |  | Instructor |
| `room_id` | smallint unsigned | NO | FK → rooms.room_id |  | Where |
| `starts_at` | datetime | NO |  |  | Start time (max 7 days ahead, checked in the app) |
| `ends_at` | datetime | NO |  |  | Filled from class_types.duration_min by trigger if NULL |
| `capacity` | smallint unsigned | NO |  |  | Seats; trigger checks ≤ room capacity |
| `status` | enum('scheduled','cancelled','completed') | NO |  | scheduled | scheduled / cancelled / completed (event) |

**CHECK constraints:** `chk_cs_capacity`: `(capacity > 0)`; `chk_cs_times`: `(ends_at > starts_at)`

**Indexes:** `fk_cs_type` (class_type_id); `idx_cs_room` (room_id,starts_at); `idx_cs_starts` (starts_at); `idx_cs_trainer` (trainer_id,starts_at)

**Triggers:** `trg_class_sessions_au` (AFTER UPDATE), `trg_class_sessions_bi` (BEFORE INSERT), `trg_class_sessions_bu` (BEFORE UPDATE)

### 1.10 `class_bookings`

M:N between members and class sessions: a booking or a waitlist place. _(rows now: 3934)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `booking_id` | int unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `class_session_id` | int unsigned | NO | FK → class_sessions.class_session_id |  | Class booked |
| `member_id` | int unsigned | NO | FK → members.member_id |  | Who booked |
| `status` | enum('booked','waitlisted','cancelled','attended','no_show') | NO |  |  | booked / waitlisted / cancelled / attended / no_show |
| `booked_at` | datetime(3) | NO |  | CURRENT_TIMESTAMP(3) | Millisecond precision → fair waitlist order |
| `updated_at` | datetime | NO |  | CURRENT_TIMESTAMP | Last status change |

**Indexes:** `idx_cb_member` (member_id,status); `idx_cb_session_status` (class_session_id,status,booked_at); `uq_cb_member_session` (UNIQUE class_session_id,member_id)

### 1.11 `pt_sessions`

One-to-one personal-training session requested by a member with a trainer. _(rows now: 168)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `pt_session_id` | int unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `trainer_id` | int unsigned | NO | FK → trainers.trainer_id |  | Trainer |
| `member_id` | int unsigned | NO | FK → members.member_id |  | Client |
| `starts_at` | datetime | NO |  |  | ≥ 2 h ahead, 06:00–22:00 |
| `ends_at` | datetime | NO |  |  | Start + 30/45/60/90 min |
| `status` | enum('requested','confirmed','completed','cancelled') | NO |  | requested | requested → confirmed → completed, or cancelled |
| `price` | decimal(8,2) | NO |  |  | 0 when covered by the plan, else trainer rate |
| `member_note` | varchar(255) | YES |  |  | Request message |
| `created_at` | datetime | NO |  | CURRENT_TIMESTAMP | Request time |

**CHECK constraints:** `chk_pt_price`: `(price >= 0)`; `chk_pt_times`: `(ends_at > starts_at)`

**Indexes:** `idx_pt_member` (member_id,starts_at); `idx_pt_trainer` (trainer_id,starts_at)

**Triggers:** `trg_pt_sessions_au` (AFTER UPDATE), `trg_pt_sessions_bi` (BEFORE INSERT), `trg_pt_sessions_bu` (BEFORE UPDATE)

### 1.12 `attendance`

Gym visits recorded at the front desk (check-in / check-out). _(rows now: 7648)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `attendance_id` | bigint unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key (partial key in the ER model is check_in) |
| `member_id` | int unsigned | NO | FK → members.member_id |  | Visitor |
| `check_in` | datetime | NO |  |  | Arrival time |
| `check_out` | datetime | YES |  |  | NULL while inside; auto-closed after 4 h by event |

**CHECK constraints:** `chk_attendance_times`: `((check_out is null) or (check_out > check_in))`

**Indexes:** `idx_attendance_check_in` (check_in); `idx_attendance_member` (member_id,check_in)

**Triggers:** `trg_attendance_bi` (BEFORE INSERT)

### 1.13 `audit_log`

History of changes to memberships, payments and PT sessions, written only by triggers. _(rows now: 683)_

| Column | Type | Null | Key | Default | Description |
|---|---|---|---|---|---|
| `audit_id` | bigint unsigned AUTO_INCREMENT | NO | PK |  | Surrogate key |
| `table_name` | varchar(64) | NO |  |  | Table that changed |
| `record_id` | bigint unsigned | NO |  |  | PK of the changed row |
| `action` | enum('INSERT','UPDATE','DELETE') | NO |  |  | INSERT / UPDATE / DELETE |
| `old_value` | json | YES |  |  | Row before (JSON) |
| `new_value` | json | YES |  |  | Row after (JSON) |
| `changed_by` | varchar(288) | NO |  |  | MySQL account (USER()) |
| `changed_at` | datetime | NO |  | CURRENT_TIMESTAMP | Time of change |

**Indexes:** `idx_audit_table_record` (table_name,record_id)

## 2. Views

| View | Purpose | Columns |
|---|---|---|
| `v_churn_risk` | Members whose visits in the last 30 days fell below half of the 30 days before. | member_id, member_code, full_name, phone, plan_name, membership_end, last_visit, visits_prev_30, visits_last_30, days_since_last_visit |
| `v_class_schedule` | Classes with type, trainer, room, booked_count, waitlist_count, seats_left. | class_session_id, starts_at, ends_at, status, capacity, class_type_id, class_name, intensity, trainer_id, trainer_name, room_id, room_name, booked_count, waitlist_count, seats_left |
| `v_current_memberships` | Membership valid today per member, with plan limits and days_left. | membership_id, member_id, plan_id, plan_name, start_date, end_date, status, frozen_from, freeze_days_used, max_freeze_days, classes_per_week, pt_sessions_included, days_left |
| `v_expiring_memberships` | Active memberships ending in the next 7 days with no renewal queued. | membership_id, member_id, full_name, email, phone, plan_name, end_date, days_left |
| `v_member_overview` | One row per member: profile, age, current plan, status (active/frozen/expired/none), last visit. | member_id, member_code, user_id, full_name, email, phone, is_active, gender, date_of_birth, age, fitness_goal, joined_on, membership_id, plan_name, membership_end, days_left, membership_status, last_visit |
| `v_monthly_revenue` | Revenue per month split into memberships and PT (completed payments only). | month, membership_revenue, pt_revenue, total_revenue, payment_count |
| `v_trainer_performance` | Classes taught, average occupancy %, completed PT sessions and PT revenue per trainer. | trainer_id, trainer_name, specialization, classes_taught, avg_occupancy_pct, pt_sessions_completed, pt_revenue |

## 3. Stored routines, triggers and events

**Functions:** `fn_active_membership_id`, `fn_classes_booked_in_week`, `fn_member_status`, `fn_pt_sessions_used`

**Procedures:** `sp_add_trainer`, `sp_assert_trainer_free`, `sp_book_class`, `sp_book_pt_session`, `sp_cancel_class_booking`, `sp_check_in`, `sp_check_out`, `sp_close_finished_classes`, `sp_expire_memberships`, `sp_freeze_membership`, `sp_purchase_membership`, `sp_register_member`, `sp_unfreeze_membership`

**Events:** `ev_daily_housekeeping` (every 1 day, enabled), `ev_class_housekeeping` (every 15 minute, enabled)

## 4. MongoDB collections

### 4.1 `exercises`

Exercise library (shared) plus member-private exercises (createdBy = member_id). _(documents now: 38)_

Validator: `$jsonSchema`, validationLevel `strict`, validationAction `error`

| Field | BSON type | Required | Rule | Description |
|---|---|---|---|---|
| `name` | string | yes | minLength 2 |  |
| `slug` | string | yes | pattern ^[a-z0-9-]+$ | URL-safe unique name |
| `category` | enum | yes | one of strength, cardio, mobility, plyometric |  |
| `primaryMuscle` | string | yes |  |  |
| `secondaryMuscles` | array |  |  |  |
| `equipment` | array | yes |  |  |
| `level` | enum | yes | one of beginner, intermediate, advanced |  |
| `instructions` | array | yes | minItems 1 | Step-by-step text (text-indexed) |
| `tags` | array |  |  | Search keywords (text-indexed) |
| `createdBy` | int |  |  | member_id for a private exercise; null/absent = shared |

**Indexes:** `uq_slug` (slug: 1 · unique); `muscle_level` (primaryMuscle: 1, level: 1); `by_creator` (createdBy: 1); `txt_exercise_search` (_fts: text, _ftsx: 1 · weights instructions 1, name 10, primaryMuscle 6, tags 4)

### 4.2 `workout_plans`

Workout plans: built by a trainer (trainerId) or by the member (trainerId null). Days and exercises embedded. _(documents now: 45)_

Validator: `$jsonSchema`, validationLevel `strict`, validationAction `error`

| Field | BSON type | Required | Rule | Description |
|---|---|---|---|---|
| `memberId` | int | yes |  | MySQL members.member_id (reference by value) |
| `trainerId` | int \| null |  |  | MySQL trainers.trainer_id; null = self-made plan |
| `title` | string | yes | minLength 3; maxLength 100 |  |
| `goal` | enum | yes | one of weight_loss, muscle_gain, endurance, flexibility, general_fitness |  |
| `durationWeeks` | int |  | minimum 1; maximum 52 |  |
| `status` | enum | yes | one of active, archived | Only one active plan per member |
| `days` | array | yes | minItems 1; maxItems 7 | Embedded training days |
| `days[].day` | int | yes | minimum 1; maximum 7 |  |
| `days[].title` | string | yes |  |  |
| `days[].exercises` | array | yes | minItems 1 | Embedded exercise prescriptions |
| `days[].exercises[].exerciseId` | objectId | yes |  | exercises._id |
| `days[].exercises[].name` | string | yes |  |  |
| `days[].exercises[].sets` | int | yes | minimum 1; maximum 10 |  |
| `days[].exercises[].reps` | string |  |  |  |
| `days[].exercises[].restSec` | int |  | minimum 0; maximum 600 |  |
| `days[].exercises[].notes` | string |  |  |  |
| `createdAt` | date | yes |  |  |
| `updatedAt` | date |  |  |  |

**Indexes:** `member_status` (memberId: 1, status: 1); `trainer_recent` (trainerId: 1, createdAt: -1)

### 4.3 `workout_logs`

One document per finished workout, with embedded sets and cardio entries. _(documents now: 1151)_

Validator: `$jsonSchema`, validationLevel `strict`, validationAction `error`

| Field | BSON type | Required | Rule | Description |
|---|---|---|---|---|
| `memberId` | int | yes |  | MySQL members.member_id (reference by value) |
| `planId` | objectId \| null |  |  | workout_plans._id the workout followed |
| `performedAt` | date | yes |  | When the workout happened |
| `durationMin` | int | yes | minimum 5; maximum 300 |  |
| `rpe` | int |  | minimum 1; maximum 10 | Rate of perceived exertion |
| `notes` | string |  | maxLength 500 |  |
| `exercises` | array |  |  | Exercises done in this workout |
| `exercises[].exerciseId` | objectId | yes |  | exercises._id |
| `exercises[].name` | string | yes |  |  |
| `exercises[].sets` | array | yes | minItems 1 | One entry per set |
| `exercises[].sets[].reps` | int |  | minimum 0; maximum 200 |  |
| `exercises[].sets[].weightKg` | double \| int |  | minimum 0; maximum 600 |  |
| `exercises[].sets[].durationSec` | int |  | minimum 1; maximum 10800 | For timed/cardio items (app asks minutes) |
| `cardio` | array |  |  | Cardio blocks |
| `cardio[].activity` | string | yes |  |  |
| `cardio[].minutes` | int | yes | minimum 1; maximum 300 |  |
| `cardio[].distanceKm` | double \| int |  | minimum 0 |  |

**Indexes:** `member_recent` (memberId: 1, performedAt: -1); `by_exercise` (exercises.exerciseId: 1)

### 4.4 `body_metrics` (time-series)

Time-series collection of body weight / body-fat / waist measurements. _(documents now: 585)_

No validator. timeField `recordedAt`, metaField `memberId`, granularity `hours`.
Fields: `recordedAt` date, `memberId` int (→ members.member_id), `weightKg` double (app checks 25–300), `bodyFatPct` double (optional), `waistCm` double (optional).

**Indexes:** `memberId_1_recordedAt_1` (memberId: 1, recordedAt: 1); `member_time` (memberId: 1, recordedAt: -1)

### 4.5 `notifications`

In-app inbox messages; deleted automatically after 60 days by a TTL index. _(documents now: 37)_

Validator: `$jsonSchema`, validationLevel `strict`, validationAction `error`

| Field | BSON type | Required | Rule | Description |
|---|---|---|---|---|
| `userId` | int | yes |  | MySQL users.user_id of the receiver |
| `type` | enum | yes | one of renewal_reminder, waitlist_promoted, class_cancelled, pt_update, plan_assigned, general | Kind of notification |
| `title` | string | yes |  |  |
| `message` | string |  |  |  |
| `readAt` | date \| null |  |  | null = unread |
| `createdAt` | date | yes |  |  |
| `meta` | object |  |  | Extra data, e.g. classSessionId |

**Indexes:** `user_inbox` (userId: 1, readAt: 1, createdAt: -1); `ttl_60_days` (createdAt: 1 · TTL 60 days)

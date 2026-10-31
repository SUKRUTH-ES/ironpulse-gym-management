-- =====================================================================
--  VIEWS: saved queries the app reads from directly.
--  They hide multi-table joins and keep report logic in the database.
-- =====================================================================
USE gym_db;

-- The membership that covers today for each member (active or frozen)
CREATE OR REPLACE VIEW v_current_memberships AS
SELECT ms.membership_id, ms.member_id, ms.plan_id, p.name AS plan_name,
       ms.start_date, ms.end_date, ms.status, ms.frozen_from,
       ms.freeze_days_used, p.max_freeze_days, p.classes_per_week,
       p.pt_sessions_included,
       DATEDIFF(ms.end_date, CURRENT_DATE) AS days_left
FROM memberships ms
JOIN membership_plans p ON p.plan_id = ms.plan_id
WHERE ms.status IN ('active','frozen')
  AND CURRENT_DATE BETWEEN ms.start_date AND ms.end_date;

-- One row per member with their account, current plan and last visit
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

-- Active memberships ending within 7 days where the member has not renewed yet
CREATE OR REPLACE VIEW v_expiring_memberships AS
SELECT cm.membership_id, cm.member_id, mo.full_name, mo.email, mo.phone,
       cm.plan_name, cm.end_date, cm.days_left
FROM v_current_memberships cm
JOIN v_member_overview mo ON mo.member_id = cm.member_id
WHERE cm.status = 'active'
  AND cm.days_left BETWEEN 0 AND 7
  AND NOT EXISTS (SELECT 1 FROM memberships nxt
                  WHERE nxt.member_id = cm.member_id
                    AND nxt.start_date > cm.end_date
                    AND nxt.status <> 'cancelled');

-- Class timetable with live seat counts
CREATE OR REPLACE VIEW v_class_schedule AS
SELECT cs.class_session_id, cs.starts_at, cs.ends_at, cs.status, cs.capacity,
       ct.class_type_id, ct.name AS class_name, ct.intensity,
       t.trainer_id, u.full_name AS trainer_name,
       r.room_id, r.name AS room_name,
       COALESCE(SUM(cb.status IN ('booked','attended','no_show')), 0) AS booked_count,
       COALESCE(SUM(cb.status = 'waitlisted'), 0)                    AS waitlist_count,
       cs.capacity - COALESCE(SUM(cb.status IN ('booked','attended','no_show')), 0) AS seats_left
FROM class_sessions cs
JOIN class_types ct ON ct.class_type_id = cs.class_type_id
JOIN trainers t     ON t.trainer_id = cs.trainer_id
JOIN users u        ON u.user_id = t.user_id
JOIN rooms r        ON r.room_id = cs.room_id
LEFT JOIN class_bookings cb ON cb.class_session_id = cs.class_session_id
GROUP BY cs.class_session_id;

-- Revenue per calendar month, split by what was paid for
CREATE OR REPLACE VIEW v_monthly_revenue AS
SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month,
       SUM(CASE WHEN membership_id IS NOT NULL THEN amount ELSE 0 END) AS membership_revenue,
       SUM(CASE WHEN pt_session_id IS NOT NULL THEN amount ELSE 0 END) AS pt_revenue,
       SUM(amount) AS total_revenue,
       COUNT(*)    AS payment_count
FROM payments
WHERE status = 'completed'
GROUP BY DATE_FORMAT(paid_at, '%Y-%m');

-- How each trainer is doing: classes taught, how full they are, PT income
CREATE OR REPLACE VIEW v_trainer_performance AS
SELECT t.trainer_id, u.full_name AS trainer_name, t.specialization,
       COALESCE(cls.classes_taught, 0)          AS classes_taught,
       COALESCE(cls.avg_occupancy_pct, 0)       AS avg_occupancy_pct,
       COALESCE(pt.pt_sessions_completed, 0)    AS pt_sessions_completed,
       COALESCE(pt.pt_revenue, 0)               AS pt_revenue
FROM trainers t
JOIN users u ON u.user_id = t.user_id
LEFT JOIN (
    SELECT s.trainer_id, COUNT(*) AS classes_taught,
           ROUND(AVG(s.booked_count / s.capacity) * 100, 1) AS avg_occupancy_pct
    FROM v_class_schedule s
    WHERE s.status = 'completed'
    GROUP BY s.trainer_id
) cls ON cls.trainer_id = t.trainer_id
LEFT JOIN (
    SELECT ps.trainer_id, COUNT(*) AS pt_sessions_completed,
           SUM(pay.amount) AS pt_revenue
    FROM pt_sessions ps
    LEFT JOIN payments pay ON pay.pt_session_id = ps.pt_session_id AND pay.status = 'completed'
    WHERE ps.status = 'completed'
    GROUP BY ps.trainer_id
) pt ON pt.trainer_id = t.trainer_id;

-- Churn risk: members with a current plan whose visits in the last 30 days
-- dropped to less than half of the 30 days before that (or who stopped coming)
CREATE OR REPLACE VIEW v_churn_risk AS
SELECT mo.member_id, mo.member_code, mo.full_name, mo.phone, mo.plan_name,
       mo.membership_end, mo.last_visit,
       v.visits_prev_30, v.visits_last_30,
       DATEDIFF(CURRENT_DATE, DATE(mo.last_visit)) AS days_since_last_visit
FROM v_member_overview mo
JOIN (
    SELECT member_id,
           SUM(check_in >= CURRENT_DATE - INTERVAL 30 DAY)                       AS visits_last_30,
           SUM(check_in <  CURRENT_DATE - INTERVAL 30 DAY
               AND check_in >= CURRENT_DATE - INTERVAL 60 DAY)                   AS visits_prev_30
    FROM attendance
    WHERE check_in >= CURRENT_DATE - INTERVAL 60 DAY
    GROUP BY member_id
) v ON v.member_id = mo.member_id
WHERE mo.membership_status = 'active'
  AND v.visits_prev_30 >= 4
  AND v.visits_last_30 < v.visits_prev_30 / 2;

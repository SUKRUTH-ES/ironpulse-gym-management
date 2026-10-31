-- =====================================================================
--  STORED FUNCTIONS and PROCEDURES
--  Every procedure that touches more than one row/table runs inside a
--  transaction and rolls back completely if any step fails.
--  Business-rule failures are raised with SIGNAL SQLSTATE '45000'
--  so the web app can show the message to the user.
-- =====================================================================
USE gym_db;

DROP FUNCTION  IF EXISTS fn_active_membership_id;
DROP FUNCTION  IF EXISTS fn_member_status;
DROP FUNCTION  IF EXISTS fn_classes_booked_in_week;
DROP FUNCTION  IF EXISTS fn_pt_sessions_used;
DROP PROCEDURE IF EXISTS sp_register_member;
DROP PROCEDURE IF EXISTS sp_purchase_membership;
DROP PROCEDURE IF EXISTS sp_freeze_membership;
DROP PROCEDURE IF EXISTS sp_unfreeze_membership;
DROP PROCEDURE IF EXISTS sp_book_class;
DROP PROCEDURE IF EXISTS sp_cancel_class_booking;
DROP PROCEDURE IF EXISTS sp_book_pt_session;
DROP PROCEDURE IF EXISTS sp_check_in;
DROP PROCEDURE IF EXISTS sp_check_out;

DELIMITER $$

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------

-- Membership (active, not frozen) that covers the given date, or NULL
CREATE FUNCTION fn_active_membership_id(p_member_id INT UNSIGNED, p_on DATE)
RETURNS INT UNSIGNED
READS SQL DATA
BEGIN
    DECLARE v_id INT UNSIGNED DEFAULT NULL;
    SELECT membership_id INTO v_id
    FROM memberships
    WHERE member_id = p_member_id
      AND status = 'active'
      AND p_on BETWEEN start_date AND end_date
    ORDER BY end_date DESC
    LIMIT 1;
    RETURN v_id;
END$$

-- 'active' | 'frozen' | 'expired' | 'none'
CREATE FUNCTION fn_member_status(p_member_id INT UNSIGNED)
RETURNS VARCHAR(10)
READS SQL DATA
BEGIN
    DECLARE v_status VARCHAR(10) DEFAULT NULL;
    SELECT status INTO v_status
    FROM memberships
    WHERE member_id = p_member_id
      AND status IN ('active','frozen')
      AND CURRENT_DATE BETWEEN start_date AND end_date
    LIMIT 1;
    IF v_status IS NOT NULL THEN
        RETURN v_status;
    END IF;
    IF EXISTS (SELECT 1 FROM memberships WHERE member_id = p_member_id) THEN
        RETURN 'expired';
    END IF;
    RETURN 'none';
END$$

-- Group classes a member holds a seat in during the Mon-Sun week of p_day
CREATE FUNCTION fn_classes_booked_in_week(p_member_id INT UNSIGNED, p_day DATE)
RETURNS INT
READS SQL DATA
BEGIN
    DECLARE v_week_start DATE DEFAULT p_day - INTERVAL WEEKDAY(p_day) DAY;
    DECLARE v_count INT DEFAULT 0;
    SELECT COUNT(*) INTO v_count
    FROM class_bookings cb
    JOIN class_sessions cs ON cs.class_session_id = cb.class_session_id
    WHERE cb.member_id = p_member_id
      AND cb.status IN ('booked','attended','no_show')
      AND cs.starts_at >= v_week_start
      AND cs.starts_at <  v_week_start + INTERVAL 7 DAY;
    RETURN v_count;
END$$

-- PT sessions already used (not cancelled) inside a membership period
CREATE FUNCTION fn_pt_sessions_used(p_membership_id INT UNSIGNED)
RETURNS INT
READS SQL DATA
BEGIN
    DECLARE v_count INT DEFAULT 0;
    SELECT COUNT(*) INTO v_count
    FROM pt_sessions ps
    JOIN memberships ms ON ms.member_id = ps.member_id
    WHERE ms.membership_id = p_membership_id
      AND ps.status <> 'cancelled'
      AND ps.price = 0
      AND DATE(ps.starts_at) BETWEEN ms.start_date AND ms.end_date;
    RETURN v_count;
END$$

-- ---------------------------------------------------------------------
-- sp_register_member: creates the login and the member profile together
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_register_member(
    IN  p_email VARCHAR(255), IN p_password_hash CHAR(60), IN p_full_name VARCHAR(100),
    IN  p_phone CHAR(10), IN p_dob DATE, IN p_gender VARCHAR(10), IN p_goal VARCHAR(20),
    OUT o_member_id INT UNSIGNED, OUT o_member_code CHAR(8))
BEGIN
    DECLARE v_user_id INT UNSIGNED;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
        INSERT INTO users (email, password_hash, role, full_name, phone)
        VALUES (LOWER(TRIM(p_email)), p_password_hash, 'member', TRIM(p_full_name), p_phone);
        SET v_user_id = LAST_INSERT_ID();
        SET o_member_code = CONCAT('GM', LPAD(v_user_id, 6, '0'));

        INSERT INTO members (user_id, member_code, date_of_birth, gender, fitness_goal)
        VALUES (v_user_id, o_member_code, p_dob, p_gender, COALESCE(p_goal, 'general_fitness'));
        SET o_member_id = LAST_INSERT_ID();
    COMMIT;
END$$

-- ---------------------------------------------------------------------
-- sp_purchase_membership: new plan or renewal + payment, all or nothing.
-- A renewal starts the day after the member's current plan ends.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_purchase_membership(
    IN  p_member_id INT UNSIGNED, IN p_plan_id SMALLINT UNSIGNED,
    IN  p_method VARCHAR(12), IN p_recorded_by INT UNSIGNED,
    OUT o_membership_id INT UNSIGNED, OUT o_payment_id INT UNSIGNED)
BEGIN
    DECLARE v_price DECIMAL(10,2);
    DECLARE v_plan_active BOOLEAN;
    DECLARE v_last_end DATE;
    DECLARE v_start DATE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
        SELECT price, is_active INTO v_price, v_plan_active
        FROM membership_plans WHERE plan_id = p_plan_id;
        IF v_price IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Membership plan does not exist';
        END IF;
        IF NOT v_plan_active THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This plan is no longer offered';
        END IF;

        -- Lock this member's memberships so two purchases cannot overlap
        SELECT MAX(end_date) INTO v_last_end
        FROM memberships
        WHERE member_id = p_member_id AND status IN ('active','frozen')
        FOR UPDATE;

        SET v_start = GREATEST(CURRENT_DATE, COALESCE(v_last_end + INTERVAL 1 DAY, CURRENT_DATE));

        -- end_date is filled in by trg_memberships_bi from the plan duration
        INSERT INTO memberships (member_id, plan_id, start_date, end_date)
        VALUES (p_member_id, p_plan_id, v_start, NULL);
        SET o_membership_id = LAST_INSERT_ID();

        SET o_payment_id = NULL;
        IF v_price > 0 THEN
            INSERT INTO payments (member_id, membership_id, amount, method, transaction_ref, recorded_by)
            VALUES (p_member_id, o_membership_id, v_price, p_method,
                    CONCAT('MS-', o_membership_id, '-', UNIX_TIMESTAMP()), p_recorded_by);
            SET o_payment_id = LAST_INSERT_ID();
        END IF;
    COMMIT;
END$$

-- ---------------------------------------------------------------------
-- Freeze / unfreeze: the days spent frozen are added to the end date,
-- limited by the plan's max_freeze_days.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_freeze_membership(IN p_membership_id INT UNSIGNED, IN p_member_id INT UNSIGNED)
BEGIN
    DECLARE v_status VARCHAR(10);
    DECLARE v_used SMALLINT UNSIGNED;
    DECLARE v_max SMALLINT UNSIGNED;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
        SELECT ms.status, ms.freeze_days_used, p.max_freeze_days
          INTO v_status, v_used, v_max
        FROM memberships ms JOIN membership_plans p ON p.plan_id = ms.plan_id
        WHERE ms.membership_id = p_membership_id AND ms.member_id = p_member_id
          AND CURRENT_DATE BETWEEN ms.start_date AND ms.end_date
        FOR UPDATE;

        IF v_status IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No current membership found to freeze';
        END IF;
        IF v_status <> 'active' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an active membership can be frozen';
        END IF;
        IF v_used >= v_max THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No freeze days left on this plan';
        END IF;

        UPDATE memberships SET status = 'frozen', frozen_from = CURRENT_DATE
        WHERE membership_id = p_membership_id;
    COMMIT;
END$$

CREATE PROCEDURE sp_unfreeze_membership(IN p_membership_id INT UNSIGNED, IN p_member_id INT UNSIGNED,
                                        OUT o_days_added INT)
BEGIN
    DECLARE v_status VARCHAR(10);
    DECLARE v_from DATE;
    DECLARE v_used SMALLINT UNSIGNED;
    DECLARE v_max SMALLINT UNSIGNED;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
        SELECT ms.status, ms.frozen_from, ms.freeze_days_used, p.max_freeze_days
          INTO v_status, v_from, v_used, v_max
        FROM memberships ms JOIN membership_plans p ON p.plan_id = ms.plan_id
        WHERE ms.membership_id = p_membership_id AND ms.member_id = p_member_id
        FOR UPDATE;

        IF v_status IS NULL OR v_status <> 'frozen' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This membership is not frozen';
        END IF;

        SET o_days_added = LEAST(DATEDIFF(CURRENT_DATE, v_from), v_max - v_used);

        -- Any renewal queued after this plan has to move back by the same amount
        UPDATE memberships
        SET start_date = start_date + INTERVAL o_days_added DAY,
            end_date   = end_date   + INTERVAL o_days_added DAY
        WHERE member_id = p_member_id
          AND membership_id <> p_membership_id
          AND status = 'active'
          AND start_date > CURRENT_DATE
        ORDER BY start_date DESC;

        UPDATE memberships
        SET status = 'active', frozen_from = NULL,
            freeze_days_used = freeze_days_used + o_days_added,
            end_date = end_date + INTERVAL o_days_added DAY
        WHERE membership_id = p_membership_id;
    COMMIT;
END$$

-- ---------------------------------------------------------------------
-- sp_book_class: takes a seat, or a waitlist spot when the class is full.
-- The class row is locked (FOR UPDATE) so two members booking the last
-- seat at the same moment cannot both get it.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- sp_cancel_class_booking: frees the seat and hands it to the first
-- member on the waitlist (returned in o_promoted_member_id).
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_cancel_class_booking(IN p_booking_id INT UNSIGNED, IN p_member_id INT UNSIGNED,
                                         OUT o_promoted_member_id INT UNSIGNED)
BEGIN
    DECLARE v_session_id INT UNSIGNED;
    DECLARE v_status VARCHAR(12);
    DECLARE v_starts DATETIME;
    DECLARE v_next_booking INT UNSIGNED DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SET o_promoted_member_id = NULL;
    START TRANSACTION;
        SELECT cb.class_session_id, cb.status, cs.starts_at
          INTO v_session_id, v_status, v_starts
        FROM class_bookings cb JOIN class_sessions cs ON cs.class_session_id = cb.class_session_id
        WHERE cb.booking_id = p_booking_id AND cb.member_id = p_member_id;

        IF v_session_id IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Booking not found';
        END IF;
        IF v_status NOT IN ('booked','waitlisted') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This booking cannot be cancelled';
        END IF;
        IF v_starts <= NOW() THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The class has already started';
        END IF;

        -- lock the class so promotion and new bookings do not race
        SELECT class_session_id INTO v_session_id
        FROM class_sessions WHERE class_session_id = v_session_id FOR UPDATE;

        UPDATE class_bookings SET status = 'cancelled' WHERE booking_id = p_booking_id;

        IF v_status = 'booked' THEN
            SELECT booking_id, member_id INTO v_next_booking, o_promoted_member_id
            FROM class_bookings
            WHERE class_session_id = v_session_id AND status = 'waitlisted'
            ORDER BY booked_at
            LIMIT 1;

            IF v_next_booking IS NOT NULL THEN
                UPDATE class_bookings SET status = 'booked' WHERE booking_id = v_next_booking;
            END IF;
        END IF;
    COMMIT;
END$$

-- ---------------------------------------------------------------------
-- sp_book_pt_session: free if the plan still has included sessions,
-- otherwise charged at the trainer's rate. Clashes are blocked by
-- trg_pt_sessions_bi.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_book_pt_session(
    IN  p_member_id INT UNSIGNED, IN p_trainer_id INT UNSIGNED, IN p_starts_at DATETIME,
    IN  p_duration_min SMALLINT, IN p_note VARCHAR(255),
    OUT o_pt_session_id INT UNSIGNED, OUT o_price DECIMAL(8,2))
BEGIN
    DECLARE v_rate DECIMAL(8,2);
    DECLARE v_accepts BOOLEAN;
    DECLARE v_membership_id INT UNSIGNED;
    DECLARE v_included TINYINT UNSIGNED DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_duration_min NOT IN (30, 45, 60, 90) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Session length must be 30, 45, 60 or 90 minutes';
    END IF;
    IF p_starts_at <= NOW() + INTERVAL 2 HOUR THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Book personal training at least 2 hours ahead';
    END IF;
    IF TIME(p_starts_at) < '06:00:00'
       OR TIME(p_starts_at + INTERVAL p_duration_min MINUTE) > '22:00:00'
       OR DATE(p_starts_at + INTERVAL p_duration_min MINUTE) <> DATE(p_starts_at) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The gym is open from 06:00 to 22:00';
    END IF;

    START TRANSACTION;
        -- lock the trainer row: serialises bookings for the same trainer
        SELECT session_rate, accepts_pt INTO v_rate, v_accepts
        FROM trainers WHERE trainer_id = p_trainer_id FOR UPDATE;
        IF v_rate IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trainer not found';
        END IF;
        IF NOT v_accepts THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This trainer is not taking personal training bookings';
        END IF;

        SET v_membership_id = fn_active_membership_id(p_member_id, DATE(p_starts_at));
        IF v_membership_id IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You need an active membership on the day of the session';
        END IF;

        SELECT p.pt_sessions_included INTO v_included
        FROM memberships ms JOIN membership_plans p ON p.plan_id = ms.plan_id
        WHERE ms.membership_id = v_membership_id;

        SET o_price = IF(fn_pt_sessions_used(v_membership_id) < v_included, 0,
                         ROUND(v_rate * p_duration_min / 60, 2));

        INSERT INTO pt_sessions (trainer_id, member_id, starts_at, ends_at, status, price, member_note)
        VALUES (p_trainer_id, p_member_id, p_starts_at, p_starts_at + INTERVAL p_duration_min MINUTE,
                'requested', o_price, p_note);
        SET o_pt_session_id = LAST_INSERT_ID();
    COMMIT;
END$$

-- ---------------------------------------------------------------------
-- Front-desk check-in / check-out by member code.
-- Validation (active membership, no open visit) is in trg_attendance_bi.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_check_in(IN p_member_code CHAR(8), OUT o_attendance_id BIGINT UNSIGNED,
                             OUT o_full_name VARCHAR(100))
BEGIN
    DECLARE v_member_id INT UNSIGNED;

    SELECT m.member_id, u.full_name INTO v_member_id, o_full_name
    FROM members m JOIN users u ON u.user_id = m.user_id
    WHERE m.member_code = UPPER(TRIM(p_member_code)) AND u.is_active;

    IF v_member_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No active member with that code';
    END IF;

    INSERT INTO attendance (member_id, check_in) VALUES (v_member_id, NOW());
    SET o_attendance_id = LAST_INSERT_ID();
END$$

CREATE PROCEDURE sp_check_out(IN p_member_code CHAR(8), OUT o_minutes INT)
BEGIN
    DECLARE v_attendance_id BIGINT UNSIGNED;
    DECLARE v_check_in DATETIME;

    SELECT a.attendance_id, a.check_in INTO v_attendance_id, v_check_in
    FROM attendance a JOIN members m ON m.member_id = a.member_id
    WHERE m.member_code = UPPER(TRIM(p_member_code)) AND a.check_out IS NULL
    ORDER BY a.check_in DESC LIMIT 1;

    IF v_attendance_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This member is not checked in';
    END IF;

    UPDATE attendance SET check_out = GREATEST(NOW(), v_check_in + INTERVAL 1 MINUTE)
    WHERE attendance_id = v_attendance_id;
    SET o_minutes = TIMESTAMPDIFF(MINUTE, v_check_in, NOW());
END$$

DELIMITER ;

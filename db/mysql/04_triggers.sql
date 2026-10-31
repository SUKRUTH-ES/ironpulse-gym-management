-- =====================================================================
--  TRIGGERS: rules the database enforces no matter which program
--  writes the data (the web app, Workbench, a seed script...).
-- =====================================================================
USE gym_db;

DROP PROCEDURE IF EXISTS sp_assert_trainer_free;
DROP TRIGGER IF EXISTS trg_users_bi;
DROP TRIGGER IF EXISTS trg_users_bu;
DROP TRIGGER IF EXISTS trg_members_bi;
DROP TRIGGER IF EXISTS trg_members_bu;
DROP TRIGGER IF EXISTS trg_memberships_bi;
DROP TRIGGER IF EXISTS trg_memberships_bu;
DROP TRIGGER IF EXISTS trg_memberships_au;
DROP TRIGGER IF EXISTS trg_class_sessions_bi;
DROP TRIGGER IF EXISTS trg_class_sessions_bu;
DROP TRIGGER IF EXISTS trg_class_sessions_au;
DROP TRIGGER IF EXISTS trg_pt_sessions_bi;
DROP TRIGGER IF EXISTS trg_pt_sessions_bu;
DROP TRIGGER IF EXISTS trg_attendance_bi;
DROP TRIGGER IF EXISTS trg_payments_ai;
DROP TRIGGER IF EXISTS trg_payments_bu;
DROP TRIGGER IF EXISTS trg_payments_au;
DROP TRIGGER IF EXISTS trg_payments_bd;

DELIMITER $$

-- Helper used by class and PT triggers: a trainer cannot be in two places
-- at once. p_skip_class / p_skip_pt exclude the row being updated.
CREATE PROCEDURE sp_assert_trainer_free(IN p_trainer_id INT UNSIGNED,
                                        IN p_starts DATETIME, IN p_ends DATETIME,
                                        IN p_skip_class INT UNSIGNED, IN p_skip_pt INT UNSIGNED)
BEGIN
    IF EXISTS (SELECT 1 FROM class_sessions
               WHERE trainer_id = p_trainer_id
                 AND status <> 'cancelled'
                 AND class_session_id <> COALESCE(p_skip_class, 0)
                 AND starts_at < p_ends AND ends_at > p_starts) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trainer is already teaching a class at that time';
    END IF;
    IF EXISTS (SELECT 1 FROM pt_sessions
               WHERE trainer_id = p_trainer_id
                 AND status IN ('requested','confirmed','completed')
                 AND pt_session_id <> COALESCE(p_skip_pt, 0)
                 AND starts_at < p_ends AND ends_at > p_starts) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trainer already has a personal training session at that time';
    END IF;
END$$

-- ---------------------------------------------------------------------
-- users: store e-mails in one canonical form so UNIQUE really works
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_users_bi BEFORE INSERT ON users FOR EACH ROW
BEGIN
    SET NEW.email = LOWER(TRIM(NEW.email));
    SET NEW.full_name = TRIM(NEW.full_name);
END$$

CREATE TRIGGER trg_users_bu BEFORE UPDATE ON users FOR EACH ROW
BEGIN
    SET NEW.email = LOWER(TRIM(NEW.email));
    SET NEW.full_name = TRIM(NEW.full_name);
END$$

-- ---------------------------------------------------------------------
-- members: age limits (CHECK cannot use CURRENT_DATE, a trigger can)
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_members_bi BEFORE INSERT ON members FOR EACH ROW
BEGIN
    IF TIMESTAMPDIFF(YEAR, NEW.date_of_birth, CURRENT_DATE) < 14 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Members must be at least 14 years old';
    END IF;
    IF TIMESTAMPDIFF(YEAR, NEW.date_of_birth, CURRENT_DATE) > 100 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Please check the date of birth';
    END IF;
END$$

CREATE TRIGGER trg_members_bu BEFORE UPDATE ON members FOR EACH ROW
BEGIN
    IF NEW.date_of_birth <> OLD.date_of_birth
       AND TIMESTAMPDIFF(YEAR, NEW.date_of_birth, CURRENT_DATE) NOT BETWEEN 14 AND 100 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Members must be between 14 and 100 years old';
    END IF;
END$$

-- ---------------------------------------------------------------------
-- memberships: end date from the plan, and no two overlapping periods
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_memberships_bi BEFORE INSERT ON memberships FOR EACH ROW
BEGIN
    DECLARE v_days SMALLINT UNSIGNED;
    SELECT duration_days INTO v_days FROM membership_plans WHERE plan_id = NEW.plan_id;

    IF NEW.end_date IS NULL THEN
        SET NEW.end_date = NEW.start_date + INTERVAL (v_days - 1) DAY;
    END IF;

    IF NEW.status <> 'cancelled' AND EXISTS (
        SELECT 1 FROM memberships
        WHERE member_id = NEW.member_id
          AND status <> 'cancelled'
          AND start_date <= NEW.end_date AND end_date >= NEW.start_date) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member already has a membership covering these dates';
    END IF;
END$$

CREATE TRIGGER trg_memberships_bu BEFORE UPDATE ON memberships FOR EACH ROW
BEGIN
    IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A cancelled membership cannot be re-activated';
    END IF;

    IF NEW.status <> 'cancelled'
       AND (NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date)
       AND EXISTS (
        SELECT 1 FROM memberships
        WHERE member_id = NEW.member_id
          AND membership_id <> NEW.membership_id
          AND status <> 'cancelled'
          AND start_date <= NEW.end_date AND end_date >= NEW.start_date) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member already has a membership covering these dates';
    END IF;
END$$

CREATE TRIGGER trg_memberships_au AFTER UPDATE ON memberships FOR EACH ROW
BEGIN
    IF NEW.status <> OLD.status OR NEW.end_date <> OLD.end_date THEN
        INSERT INTO audit_log (table_name, record_id, action, old_value, new_value, changed_by)
        VALUES ('memberships', NEW.membership_id, 'UPDATE',
                JSON_OBJECT('status', OLD.status, 'end_date', OLD.end_date),
                JSON_OBJECT('status', NEW.status, 'end_date', NEW.end_date),
                USER());
    END IF;
END$$

-- ---------------------------------------------------------------------
-- class_sessions: room big enough, room free, trainer free
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_class_sessions_bi BEFORE INSERT ON class_sessions FOR EACH ROW
BEGIN
    DECLARE v_room_cap SMALLINT UNSIGNED;
    DECLARE v_duration SMALLINT UNSIGNED;

    IF NEW.ends_at IS NULL THEN
        SELECT duration_min INTO v_duration FROM class_types WHERE class_type_id = NEW.class_type_id;
        SET NEW.ends_at = NEW.starts_at + INTERVAL v_duration MINUTE;
    END IF;

    SELECT capacity INTO v_room_cap FROM rooms WHERE room_id = NEW.room_id;
    IF NEW.capacity > v_room_cap THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Class capacity is larger than the room capacity';
    END IF;

    IF EXISTS (SELECT 1 FROM class_sessions
               WHERE room_id = NEW.room_id AND status <> 'cancelled'
                 AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Room is already booked for another class at that time';
    END IF;

    CALL sp_assert_trainer_free(NEW.trainer_id, NEW.starts_at, NEW.ends_at, NULL, NULL);
END$$

CREATE TRIGGER trg_class_sessions_bu BEFORE UPDATE ON class_sessions FOR EACH ROW
BEGIN
    DECLARE v_room_cap SMALLINT UNSIGNED;
    DECLARE v_booked INT;

    IF NEW.capacity <> OLD.capacity OR NEW.room_id <> OLD.room_id THEN
        SELECT capacity INTO v_room_cap FROM rooms WHERE room_id = NEW.room_id;
        IF NEW.capacity > v_room_cap THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Class capacity is larger than the room capacity';
        END IF;
        SELECT COUNT(*) INTO v_booked FROM class_bookings
        WHERE class_session_id = NEW.class_session_id AND status = 'booked';
        IF NEW.capacity < v_booked THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'More members are already booked than the new capacity';
        END IF;
    END IF;

    IF NEW.status <> 'cancelled'
       AND (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at
            OR NEW.room_id <> OLD.room_id OR NEW.trainer_id <> OLD.trainer_id) THEN
        IF EXISTS (SELECT 1 FROM class_sessions
                   WHERE room_id = NEW.room_id AND status <> 'cancelled'
                     AND class_session_id <> NEW.class_session_id
                     AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Room is already booked for another class at that time';
        END IF;
        CALL sp_assert_trainer_free(NEW.trainer_id, NEW.starts_at, NEW.ends_at, NEW.class_session_id, NULL);
    END IF;
END$$

-- Cancelling a class cancels every seat and waitlist spot in it
CREATE TRIGGER trg_class_sessions_au AFTER UPDATE ON class_sessions FOR EACH ROW
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
        UPDATE class_bookings SET status = 'cancelled'
        WHERE class_session_id = NEW.class_session_id AND status IN ('booked','waitlisted');
    END IF;
END$$

-- ---------------------------------------------------------------------
-- pt_sessions: trainer and member must both be free
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_pt_sessions_bi BEFORE INSERT ON pt_sessions FOR EACH ROW
BEGIN
    CALL sp_assert_trainer_free(NEW.trainer_id, NEW.starts_at, NEW.ends_at, NULL, NULL);

    IF EXISTS (SELECT 1 FROM pt_sessions
               WHERE member_id = NEW.member_id
                 AND status IN ('requested','confirmed','completed')
                 AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You already have a personal training session at that time';
    END IF;
END$$

CREATE TRIGGER trg_pt_sessions_bu BEFORE UPDATE ON pt_sessions FOR EACH ROW
BEGIN
    IF OLD.status IN ('completed','cancelled') AND NEW.status <> OLD.status THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A finished or cancelled session cannot change status';
    END IF;

    IF NEW.status <> 'cancelled'
       AND (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.trainer_id <> OLD.trainer_id) THEN
        CALL sp_assert_trainer_free(NEW.trainer_id, NEW.starts_at, NEW.ends_at, NULL, NEW.pt_session_id);
    END IF;
END$$

-- ---------------------------------------------------------------------
-- attendance: only members with a valid plan can check in, and only once
-- at a time. A frozen membership does not allow entry.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- payments: financial records are never deleted or edited, only refunded.
-- Every change is written to audit_log.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_payments_ai AFTER INSERT ON payments FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, record_id, action, new_value, changed_by)
    VALUES ('payments', NEW.payment_id, 'INSERT',
            JSON_OBJECT('member_id', NEW.member_id, 'amount', NEW.amount,
                        'method', NEW.method, 'ref', NEW.transaction_ref),
            USER());
END$$

CREATE TRIGGER trg_payments_bu BEFORE UPDATE ON payments FOR EACH ROW
BEGIN
    IF NEW.amount <> OLD.amount OR NEW.member_id <> OLD.member_id
       OR NOT (NEW.membership_id <=> OLD.membership_id)
       OR NOT (NEW.pt_session_id <=> OLD.pt_session_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment details cannot be edited; refund it instead';
    END IF;
    IF OLD.status = 'refunded' AND NEW.status <> 'refunded' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A refunded payment cannot be restored';
    END IF;
END$$

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

DELIMITER ;

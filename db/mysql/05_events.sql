-- =====================================================================
--  SCHEDULED EVENTS: housekeeping MySQL runs by itself
--  (needs event_scheduler=ON, the default in MySQL 8)
-- =====================================================================
USE gym_db;

DROP EVENT IF EXISTS ev_daily_housekeeping;
DROP EVENT IF EXISTS ev_class_housekeeping;
DROP PROCEDURE IF EXISTS sp_expire_memberships;
DROP PROCEDURE IF EXISTS sp_close_finished_classes;

DELIMITER $$

-- Memberships whose last day has passed become 'expired'
CREATE PROCEDURE sp_expire_memberships()
BEGIN
    UPDATE memberships SET status = 'expired'
    WHERE status = 'active' AND end_date < CURRENT_DATE;
END$$

-- Finished classes become 'completed'; anyone still 'booked' did not show up.
-- Visits left open for more than 4 hours are closed automatically.
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
END$$

DELIMITER ;

CREATE EVENT ev_daily_housekeeping
    ON SCHEDULE EVERY 1 DAY STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 5 MINUTE)
    DO CALL sp_expire_memberships();

CREATE EVENT ev_class_housekeeping
    ON SCHEDULE EVERY 15 MINUTE
    DO CALL sp_close_finished_classes();

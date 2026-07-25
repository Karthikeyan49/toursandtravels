-- 007_operations.sql — on-ground execution: trip assignments, day sheets, feedback

SET FOREIGN_KEY_CHECKS = 0;

-- Vehicle + driver assigned to a booking for a date range. The uniqueness of a
-- vehicle/driver on a given day is enforced in PHP (TripAssignment::hasClash)
-- rather than by a constraint, because split-day and shared transfers are legal.
CREATE TABLE IF NOT EXISTS trip_assignments (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id         BIGINT UNSIGNED NOT NULL,
  booking_service_id BIGINT UNSIGNED     NULL,
  vehicle_id         BIGINT UNSIGNED     NULL,
  driver_id          BIGINT UNSIGNED     NULL,
  guide_id           BIGINT UNSIGNED     NULL,   -- users.id or drivers.id per guide_source
  guide_source       ENUM('staff','supplier') NOT NULL DEFAULT 'supplier',
  supplier_id        BIGINT UNSIGNED     NULL,
  from_date          DATE            NOT NULL,
  to_date            DATE            NOT NULL,
  pickup_point       VARCHAR(255)        NULL,
  pickup_time        TIME                NULL,
  drop_point         VARCHAR(255)        NULL,
  route_summary      VARCHAR(500)        NULL,
  estimated_km       INT UNSIGNED    NOT NULL DEFAULT 0,
  status             ENUM('planned','confirmed','dispatched','in_progress','completed','cancelled') NOT NULL DEFAULT 'planned',
  previous_status    VARCHAR(20)         NULL,
  driver_notified_at DATETIME            NULL,
  notes              VARCHAR(500)        NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by         BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY idx_trip_assignments_booking (booking_id),
  KEY idx_trip_assignments_vehicle (vehicle_id, from_date, to_date),
  KEY idx_trip_assignments_driver (driver_id, from_date, to_date),
  KEY idx_trip_assignments_dates (from_date, to_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Filled in by the driver / tour manager at the end of a trip; drives the
-- reconciliation of estimated vs actual transport cost.
CREATE TABLE IF NOT EXISTS trip_sheets (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trip_assignment_id BIGINT UNSIGNED NOT NULL,
  sheet_date         DATE            NOT NULL,
  start_km           INT UNSIGNED    NOT NULL DEFAULT 0,
  end_km             INT UNSIGNED    NOT NULL DEFAULT 0,
  total_km           INT UNSIGNED    NOT NULL DEFAULT 0,
  start_time         TIME                NULL,
  end_time           TIME                NULL,
  fuel_amount        DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  toll_amount        DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  parking_amount     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  driver_allowance   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  other_amount       DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  total_amount       DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  odometer_photo     VARCHAR(255)        NULL,
  remarks            VARCHAR(500)        NULL,
  status             ENUM('draft','submitted','approved','rejected') NOT NULL DEFAULT 'draft',
  approved_by        BIGINT UNSIGNED     NULL,
  approved_at        DATETIME            NULL,
  rejection_reason   VARCHAR(255)        NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by         BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY idx_trip_sheets_assignment (trip_assignment_id, sheet_date),
  KEY idx_trip_sheets_status (status, sheet_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The ops board: one row per booking per travel day, auto-generated on confirm.
CREATE TABLE IF NOT EXISTS ops_daysheets (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id    BIGINT UNSIGNED NOT NULL,
  sheet_date    DATE            NOT NULL,
  day_no        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  city_id       BIGINT UNSIGNED     NULL,
  hotel_id      BIGINT UNSIGNED     NULL,
  summary       VARCHAR(400)        NULL,
  checklist_json TEXT               NULL,   -- [{label, done, by, at}]
  status        ENUM('pending','ready','in_progress','done','issue') NOT NULL DEFAULT 'pending',
  issue_note    VARCHAR(500)        NULL,
  owner_id      BIGINT UNSIGNED     NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ops_daysheets_day (booking_id, sheet_date),
  KEY idx_ops_daysheets_date (sheet_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Anything that went wrong on tour. Feeds supplier ratings and post-tour service recovery.
CREATE TABLE IF NOT EXISTS trip_incidents (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id    BIGINT UNSIGNED NOT NULL,
  incident_date DATE            NOT NULL,
  category      ENUM('hotel','transport','activity','guide','medical','weather','flight','customer','other') NOT NULL,
  supplier_id   BIGINT UNSIGNED     NULL,
  severity      ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  title         VARCHAR(200)    NOT NULL,
  description   TEXT                NULL,
  action_taken  TEXT                NULL,
  cost_impact   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  status        ENUM('open','investigating','resolved','closed') NOT NULL DEFAULT 'open',
  resolved_at   DATETIME            NULL,
  reported_by   BIGINT UNSIGNED     NULL,
  assigned_to   BIGINT UNSIGNED     NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trip_incidents_booking (booking_id, status),
  KEY idx_trip_incidents_supplier (supplier_id, category),
  KEY idx_trip_incidents_status (status, severity, incident_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Post-tour feedback. Ratings roll up into suppliers.rating.
CREATE TABLE IF NOT EXISTS trip_feedback (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id      BIGINT UNSIGNED NOT NULL,
  customer_id     BIGINT UNSIGNED     NULL,
  overall_rating  TINYINT UNSIGNED NOT NULL DEFAULT 5,
  hotel_rating    TINYINT UNSIGNED    NULL,
  transport_rating TINYINT UNSIGNED   NULL,
  guide_rating    TINYINT UNSIGNED    NULL,
  value_rating    TINYINT UNSIGNED    NULL,
  would_recommend TINYINT(1)          NULL,
  comments        TEXT                NULL,
  is_published    TINYINT(1)      NOT NULL DEFAULT 0,
  submitted_at    DATETIME        NOT NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trip_feedback_booking (booking_id),
  KEY idx_trip_feedback_rating (overall_rating, submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

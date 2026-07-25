-- 003_packages.sql — tour packages, itineraries, departures, pricing slabs

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS packages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(20)     NOT NULL,     -- PKG-2026-0001
  name            VARCHAR(200)    NOT NULL,
  destination_id  BIGINT UNSIGNED NOT NULL,
  package_type    ENUM('fixed_departure','customised','fit','group','honeymoon','pilgrimage','corporate','mice') NOT NULL DEFAULT 'fit',
  scope           ENUM('domestic','international') NOT NULL DEFAULT 'domestic',
  nights          TINYINT UNSIGNED NOT NULL DEFAULT 1,
  days            TINYINT UNSIGNED NOT NULL DEFAULT 2,
  min_pax         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  max_pax         SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- 0 = unlimited
  summary         VARCHAR(500)        NULL,
  description     TEXT                NULL,
  inclusions      TEXT                NULL,     -- one per line
  exclusions      TEXT                NULL,
  terms           TEXT                NULL,
  cancellation_policy TEXT            NULL,
  hero_image      VARCHAR(255)        NULL,
  -- Indicative headline price; the authoritative price comes from package_prices
  -- resolved server-side. Never trust a client-supplied price.
  base_price_adult DECIMAL(15,2)  NOT NULL DEFAULT 0.00,
  currency        CHAR(3)         NOT NULL DEFAULT 'INR',
  markup_pct      DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  gst_pct         DECIMAL(6,3)    NOT NULL DEFAULT 5.000,
  status          ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
  is_deleted      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_packages_code (code),
  KEY idx_packages_destination (destination_id, status, is_deleted),
  KEY idx_packages_type (package_type, scope, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Day-by-day itinerary. day_no is 1-based and unique per package.
CREATE TABLE IF NOT EXISTS package_days (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  package_id    BIGINT UNSIGNED NOT NULL,
  day_no        TINYINT UNSIGNED NOT NULL,
  title         VARCHAR(200)    NOT NULL,   -- 'Arrival at Cochin – transfer to Munnar'
  description   TEXT                NULL,
  city_id       BIGINT UNSIGNED     NULL,
  overnight_city_id BIGINT UNSIGNED NULL,
  meal_plan     ENUM('none','B','L','D','BL','BD','LD','BLD') NOT NULL DEFAULT 'B',
  distance_km   SMALLINT UNSIGNED   NULL,
  drive_hours   DECIMAL(4,1)        NULL,
  image_path    VARCHAR(255)        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_package_days_no (package_id, day_no),
  KEY idx_package_days_package (package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What each day consumes: a hotel night, an activity, a transfer. Drives costing.
CREATE TABLE IF NOT EXISTS package_day_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  package_day_id BIGINT UNSIGNED NOT NULL,
  item_type      ENUM('hotel','activity','transport','flight','meal','other') NOT NULL,
  ref_id         BIGINT UNSIGNED     NULL,   -- hotels.id / activities.id / vehicle_types.id
  label          VARCHAR(200)    NOT NULL,
  quantity       DECIMAL(10,2)   NOT NULL DEFAULT 1.00,
  unit_cost      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  is_optional    TINYINT(1)      NOT NULL DEFAULT 0,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_package_day_items_day (package_day_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Price slabs. A package is priced by pax-count band × occupancy × hotel category
-- × season. This is the authoritative sell price; the server resolves it.
CREATE TABLE IF NOT EXISTS package_prices (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  package_id      BIGINT UNSIGNED NOT NULL,
  label           VARCHAR(80)     NOT NULL DEFAULT 'Standard',
  hotel_category  ENUM('budget','3star','4star','5star','luxury') NOT NULL DEFAULT '3star',
  pax_from        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  pax_to          SMALLINT UNSIGNED NOT NULL DEFAULT 999,
  valid_from      DATE            NOT NULL,
  valid_to        DATE            NOT NULL,
  currency        CHAR(3)         NOT NULL DEFAULT 'INR',
  cost_per_adult  DECIMAL(15,2)   NOT NULL DEFAULT 0.00,   -- net supplier cost
  price_single    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  price_double    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,   -- per person on twin sharing
  price_triple    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  price_child_bed DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  price_child_nobed DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  price_infant    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  extra_bed_price DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_package_prices_lookup (package_id, hotel_category, valid_from, valid_to, is_active),
  KEY idx_package_prices_pax (package_id, pax_from, pax_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fixed-departure batches with seat inventory.
-- seats_held is released when a hold expires or a booking is cancelled;
-- availability is ALWAYS computed as seats_total - seats_booked - seats_held.
CREATE TABLE IF NOT EXISTS package_departures (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  package_id     BIGINT UNSIGNED NOT NULL,
  batch_code     VARCHAR(30)     NOT NULL,
  departure_date DATE            NOT NULL,
  return_date    DATE            NOT NULL,
  departure_city_id BIGINT UNSIGNED NULL,
  seats_total    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  seats_booked   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  seats_held     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  price_override DECIMAL(15,2)       NULL,
  tour_manager_id BIGINT UNSIGNED    NULL,   -- users.id
  status         ENUM('open','filling','full','closed','departed','cancelled') NOT NULL DEFAULT 'open',
  previous_status VARCHAR(20)        NULL,   -- lets a status change be reverted
  notes          VARCHAR(500)        NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by     BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_package_departures_batch (package_id, batch_code),
  KEY idx_package_departures_date (departure_date, status),
  KEY idx_package_departures_package (package_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

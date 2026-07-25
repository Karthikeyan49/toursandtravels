-- 002_masters.sql — reference data for a tours & travel business
-- Masters use SOFT DELETE (is_deleted). Financial documents use VOID, never delete.

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Geography
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS countries (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  iso2         CHAR(2)         NOT NULL,
  name         VARCHAR(100)    NOT NULL,
  currency     CHAR(3)         NOT NULL DEFAULT 'INR',
  dial_code    VARCHAR(8)          NULL,
  visa_required TINYINT(1)     NOT NULL DEFAULT 0,   -- for the agency's home nationality
  is_active    TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_countries_iso2 (iso2)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A "destination" is the sellable geography unit: Goa, Bali, Kashmir, Dubai.
CREATE TABLE IF NOT EXISTS destinations (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code          VARCHAR(20)     NOT NULL,
  name          VARCHAR(120)    NOT NULL,
  country_id    BIGINT UNSIGNED     NULL,
  region        VARCHAR(80)         NULL,   -- 'South India', 'South East Asia'
  scope         ENUM('domestic','international') NOT NULL DEFAULT 'domestic',
  description   TEXT                NULL,
  best_season   VARCHAR(120)        NULL,   -- 'Oct-Mar'
  hero_image    VARCHAR(255)        NULL,
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted    TINYINT(1)      NOT NULL DEFAULT 0,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_destinations_code (code),
  KEY idx_destinations_scope (scope, is_active, is_deleted),
  KEY idx_destinations_country (country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cities (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  destination_id BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(120)    NOT NULL,
  airport_code   VARCHAR(5)          NULL,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted     TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_cities_destination (destination_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Suppliers — one table for every kind of vendor the agency buys from
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS suppliers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(20)     NOT NULL,
  name           VARCHAR(160)    NOT NULL,
  supplier_type  ENUM('hotel','transport','activity','dmc','airline','visa','insurance','guide','other') NOT NULL,
  destination_id BIGINT UNSIGNED     NULL,
  contact_person VARCHAR(120)        NULL,
  phone          VARCHAR(20)         NULL,
  alt_phone      VARCHAR(20)         NULL,
  email          VARCHAR(190)        NULL,
  address        VARCHAR(400)        NULL,
  city           VARCHAR(120)        NULL,
  state          VARCHAR(120)        NULL,
  country_id     BIGINT UNSIGNED     NULL,
  gstin          VARCHAR(15)         NULL,
  pan            VARCHAR(10)         NULL,
  currency       CHAR(3)         NOT NULL DEFAULT 'INR',
  credit_days    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  credit_limit   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  bank_name      VARCHAR(120)        NULL,
  bank_account   VARCHAR(40)         NULL,
  bank_ifsc      VARCHAR(15)         NULL,
  rating         DECIMAL(3,2)        NULL,   -- 0.00 – 5.00, internal ops rating
  notes          TEXT                NULL,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by     BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_code (code),
  KEY idx_suppliers_type (supplier_type, is_active, is_deleted),
  KEY idx_suppliers_destination (destination_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Hotels & room inventory
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hotels (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id    BIGINT UNSIGNED     NULL,   -- billing entity, if contracted directly
  code           VARCHAR(20)     NOT NULL,
  name           VARCHAR(160)    NOT NULL,
  destination_id BIGINT UNSIGNED NOT NULL,
  city_id        BIGINT UNSIGNED     NULL,
  category       ENUM('budget','3star','4star','5star','luxury','resort','homestay','houseboat','camp') NOT NULL DEFAULT '3star',
  address        VARCHAR(400)        NULL,
  phone          VARCHAR(20)         NULL,
  email          VARCHAR(190)        NULL,
  check_in_time  TIME            NOT NULL DEFAULT '14:00:00',
  check_out_time TIME            NOT NULL DEFAULT '11:00:00',
  child_free_age TINYINT UNSIGNED NOT NULL DEFAULT 5,   -- below this age = free, no bed
  amenities      TEXT                NULL,   -- comma separated
  notes          TEXT                NULL,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by     BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotels_code (code),
  KEY idx_hotels_destination (destination_id, category, is_active),
  KEY idx_hotels_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hotel_room_types (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id     BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(120)    NOT NULL,   -- 'Deluxe Garden View'
  max_adults   TINYINT UNSIGNED NOT NULL DEFAULT 2,
  max_children TINYINT UNSIGNED NOT NULL DEFAULT 1,
  extra_beds   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_active    TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted   TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_hotel_room_types_hotel (hotel_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contracted rates. Season-dated so the same room has different cost across the year.
-- Rates are per ROOM per NIGHT unless rate_basis='per_person'.
CREATE TABLE IF NOT EXISTS hotel_rates (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id      BIGINT UNSIGNED NOT NULL,
  room_type_id  BIGINT UNSIGNED NOT NULL,
  season_name   VARCHAR(80)     NOT NULL DEFAULT 'Standard',
  valid_from    DATE            NOT NULL,
  valid_to      DATE            NOT NULL,
  meal_plan     ENUM('EP','CP','MAP','AP') NOT NULL DEFAULT 'CP',
  rate_basis    ENUM('per_room','per_person') NOT NULL DEFAULT 'per_room',
  currency      CHAR(3)         NOT NULL DEFAULT 'INR',
  cost_single   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  cost_double   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  cost_triple   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  cost_extra_bed DECIMAL(15,2)  NOT NULL DEFAULT 0.00,
  cost_child_no_bed DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  tax_pct       DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY idx_hotel_rates_lookup (hotel_id, room_type_id, valid_from, valid_to, is_active),
  KEY idx_hotel_rates_dates (valid_from, valid_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Transport
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vehicle_types (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)     NOT NULL,   -- 'Innova Crysta', '17-seat Tempo Traveller'
  seat_count  TINYINT UNSIGNED NOT NULL DEFAULT 4,
  luggage_cap VARCHAR(40)         NULL,
  is_ac       TINYINT(1)      NOT NULL DEFAULT 1,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted  TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_types_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id    BIGINT UNSIGNED     NULL,   -- NULL = agency-owned fleet
  vehicle_type_id BIGINT UNSIGNED NOT NULL,
  registration_no VARCHAR(20)    NOT NULL,
  model_year     SMALLINT UNSIGNED   NULL,
  destination_id BIGINT UNSIGNED     NULL,   -- home base
  permit_expiry  DATE                NULL,
  insurance_expiry DATE              NULL,
  fitness_expiry DATE                NULL,
  puc_expiry     DATE                NULL,
  is_owned       TINYINT(1)      NOT NULL DEFAULT 0,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicles_registration (registration_no),
  KEY idx_vehicles_type (vehicle_type_id, is_active),
  KEY idx_vehicles_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drivers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id     BIGINT UNSIGNED     NULL,
  full_name       VARCHAR(150)    NOT NULL,
  phone           VARCHAR(20)     NOT NULL,
  alt_phone       VARCHAR(20)         NULL,
  licence_no      VARCHAR(40)         NULL,
  licence_expiry  DATE                NULL,
  languages       VARCHAR(160)        NULL,
  destination_id  BIGINT UNSIGNED     NULL,
  rating          DECIMAL(3,2)        NULL,
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_drivers_active (is_active, is_deleted),
  KEY idx_drivers_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Transport rate card: point-to-point transfer or per-day disposal.
CREATE TABLE IF NOT EXISTS transport_rates (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id     BIGINT UNSIGNED NOT NULL,
  vehicle_type_id BIGINT UNSIGNED NOT NULL,
  destination_id  BIGINT UNSIGNED     NULL,
  rate_type       ENUM('transfer','disposal_day','per_km','airport_pickup','airport_drop') NOT NULL DEFAULT 'disposal_day',
  route_label     VARCHAR(160)        NULL,   -- 'Cochin Airport → Munnar'
  valid_from      DATE            NOT NULL,
  valid_to        DATE            NOT NULL,
  currency        CHAR(3)         NOT NULL DEFAULT 'INR',
  base_cost       DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  included_km     INT UNSIGNED    NOT NULL DEFAULT 0,
  extra_km_cost   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  driver_allowance DECIMAL(15,2)  NOT NULL DEFAULT 0.00,
  toll_parking     DECIMAL(15,2)  NOT NULL DEFAULT 0.00,
  tax_pct         DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transport_rates_lookup (supplier_id, vehicle_type_id, valid_from, valid_to, is_active),
  KEY idx_transport_rates_dest (destination_id, rate_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Activities / sightseeing / add-ons
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activities (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(20)     NOT NULL,
  name           VARCHAR(160)    NOT NULL,
  destination_id BIGINT UNSIGNED NOT NULL,
  supplier_id    BIGINT UNSIGNED     NULL,
  activity_type  ENUM('sightseeing','adventure','cruise','show','entry_ticket','wellness','transfer','meal','other') NOT NULL DEFAULT 'sightseeing',
  duration_hours DECIMAL(4,1)        NULL,
  pricing_basis  ENUM('per_person','per_group','per_vehicle') NOT NULL DEFAULT 'per_person',
  cost_adult     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  cost_child     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  sell_adult     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  sell_child     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tax_pct        DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  min_pax        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  description    TEXT                NULL,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by     BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_activities_code (code),
  KEY idx_activities_destination (destination_id, activity_type, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- B2B agencies (sub-agents who sell the operator's packages)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agencies (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(20)     NOT NULL,
  name            VARCHAR(160)    NOT NULL,
  contact_person  VARCHAR(120)        NULL,
  phone           VARCHAR(20)         NULL,
  email           VARCHAR(190)        NULL,
  address         VARCHAR(400)        NULL,
  gstin           VARCHAR(15)         NULL,
  pan             VARCHAR(10)         NULL,
  commission_pct  DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  credit_days     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  credit_limit    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agencies_code (code),
  KEY idx_agencies_active (is_active, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Customers (the traveller / lead owner)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(20)     NOT NULL,
  full_name      VARCHAR(150)    NOT NULL,
  email          VARCHAR(190)        NULL,
  phone          VARCHAR(20)     NOT NULL,
  alt_phone      VARCHAR(20)         NULL,
  whatsapp       VARCHAR(20)         NULL,
  address        VARCHAR(400)        NULL,
  city           VARCHAR(120)        NULL,
  state          VARCHAR(120)        NULL,
  pincode        VARCHAR(10)         NULL,
  country_id     BIGINT UNSIGNED     NULL,
  date_of_birth  DATE                NULL,
  anniversary    DATE                NULL,
  gstin          VARCHAR(15)         NULL,   -- corporate clients
  customer_type  ENUM('individual','corporate','agency') NOT NULL DEFAULT 'individual',
  agency_id      BIGINT UNSIGNED     NULL,   -- booked through this sub-agent
  source         VARCHAR(60)         NULL,
  notes          TEXT                NULL,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  is_deleted     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by     BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_code (code),
  KEY idx_customers_phone (phone),
  KEY idx_customers_email (email),
  KEY idx_customers_agency (agency_id),
  KEY idx_customers_active (is_active, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

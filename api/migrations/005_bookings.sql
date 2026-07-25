-- 005_bookings.sql — bookings, passengers, services, rooming, documents, vouchers

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS bookings (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_no       VARCHAR(30)     NOT NULL,   -- BKG-2026-0001
  quotation_id     BIGINT UNSIGNED     NULL,
  lead_id          BIGINT UNSIGNED     NULL,
  customer_id      BIGINT UNSIGNED NOT NULL,
  agency_id        BIGINT UNSIGNED     NULL,
  package_id       BIGINT UNSIGNED     NULL,
  departure_id     BIGINT UNSIGNED     NULL,
  destination_id   BIGINT UNSIGNED     NULL,
  booking_type     ENUM('package','custom','hotel_only','transport_only','activity_only','visa_only') NOT NULL DEFAULT 'package',
  booking_date     DATE            NOT NULL,
  travel_from      DATE            NOT NULL,
  travel_to        DATE            NOT NULL,
  nights           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  adults           SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  children         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  infants          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  hotel_category   VARCHAR(20)         NULL,
  lead_pax_name    VARCHAR(150)        NULL,
  contact_phone    VARCHAR(20)         NULL,
  contact_email    VARCHAR(190)        NULL,
  emergency_contact VARCHAR(150)       NULL,
  emergency_phone  VARCHAR(20)         NULL,
  currency         CHAR(3)         NOT NULL DEFAULT 'INR',
  -- Money. Recomputed server-side from booking_services; never client-supplied.
  subtotal         DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  discount_amount  DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  taxable_amount   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  gst_pct          DECIMAL(6,3)    NOT NULL DEFAULT 5.000,
  gst_amount       DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tcs_amount       DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  grand_total      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  cost_total       DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  agency_commission DECIMAL(15,2)  NOT NULL DEFAULT 0.00,
  -- amount_paid is a materialised cache of SUM(payments). Outstanding is NEVER
  -- stored: it is always grand_total - amount_paid, computed at read time.
  amount_paid      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  last_payment_at  DATETIME            NULL,
  payment_status   ENUM('unpaid','advance_paid','partially_paid','paid','refunded','overpaid') NOT NULL DEFAULT 'unpaid',
  status           ENUM('draft','confirmed','vouchered','in_progress','completed','cancelled','no_show') NOT NULL DEFAULT 'draft',
  previous_status  VARCHAR(20)         NULL,
  confirmed_at     DATETIME            NULL,
  completed_at     DATETIME            NULL,
  -- Cancellation: bookings are NEVER deleted. They are cancelled with a reason,
  -- a retention amount and a refund amount, all auditable.
  cancelled_at     DATETIME            NULL,
  cancelled_by     BIGINT UNSIGNED     NULL,
  cancellation_reason VARCHAR(500)     NULL,
  cancellation_charge DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  refund_amount    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  special_requests TEXT                NULL,
  internal_notes   TEXT                NULL,
  owner_id         BIGINT UNSIGNED     NULL,   -- sales owner
  ops_owner_id     BIGINT UNSIGNED     NULL,   -- operations owner
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by       BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookings_no (booking_no),
  KEY idx_bookings_customer (customer_id, status),
  KEY idx_bookings_travel (travel_from, travel_to, status),
  KEY idx_bookings_status (status, payment_status),
  KEY idx_bookings_departure (departure_id),
  KEY idx_bookings_owner (owner_id, status),
  KEY idx_bookings_agency (agency_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Passenger manifest.
CREATE TABLE IF NOT EXISTS booking_pax (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id      BIGINT UNSIGNED NOT NULL,
  pax_no          SMALLINT UNSIGNED NOT NULL,
  title           ENUM('Mr','Mrs','Ms','Mstr','Dr','Prof') NOT NULL DEFAULT 'Mr',
  first_name      VARCHAR(100)    NOT NULL,
  last_name       VARCHAR(100)        NULL,
  pax_type        ENUM('adult','child','infant') NOT NULL DEFAULT 'adult',
  gender          ENUM('male','female','other')  NULL,
  date_of_birth   DATE                NULL,
  age             TINYINT UNSIGNED    NULL,
  nationality_id  BIGINT UNSIGNED     NULL,
  phone           VARCHAR(20)         NULL,
  email           VARCHAR(190)        NULL,
  -- Travel documents
  passport_no     VARCHAR(20)         NULL,
  passport_issue  DATE                NULL,
  passport_expiry DATE                NULL,
  passport_country CHAR(2)            NULL,
  visa_no         VARCHAR(30)         NULL,
  visa_status     ENUM('not_required','pending','applied','approved','rejected') NOT NULL DEFAULT 'not_required',
  visa_expiry     DATE                NULL,
  -- Ops
  meal_preference ENUM('none','veg','non_veg','jain','vegan','halal') NOT NULL DEFAULT 'none',
  medical_notes   VARCHAR(500)        NULL,
  is_lead_pax     TINYINT(1)      NOT NULL DEFAULT 0,
  insurance_no    VARCHAR(40)         NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_pax_no (booking_id, pax_no),
  KEY idx_booking_pax_booking (booking_id),
  KEY idx_booking_pax_passport_expiry (passport_expiry),
  KEY idx_booking_pax_visa (visa_status, visa_expiry)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every purchasable line on a booking. This is the join between what the client
-- pays (sell_total) and what the agency owes a supplier (cost_total) — margin per
-- booking falls straight out of this table.
CREATE TABLE IF NOT EXISTS booking_services (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id      BIGINT UNSIGNED NOT NULL,
  service_type    ENUM('hotel','transport','activity','flight','train','visa','insurance','guide','meal','other') NOT NULL,
  ref_id          BIGINT UNSIGNED     NULL,   -- hotels.id / activities.id / vehicles.id
  supplier_id     BIGINT UNSIGNED     NULL,
  description     VARCHAR(400)    NOT NULL,
  day_no          TINYINT UNSIGNED    NULL,
  service_date    DATE                NULL,
  service_end_date DATE               NULL,   -- checkout for hotels
  city_id         BIGINT UNSIGNED     NULL,
  quantity        DECIMAL(10,2)   NOT NULL DEFAULT 1.00,
  unit            VARCHAR(20)     NOT NULL DEFAULT 'pax',
  nights          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  pax_count       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  unit_cost       DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  unit_price      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  cost_total      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  sell_total      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tax_pct         DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  currency        CHAR(3)         NOT NULL DEFAULT 'INR',
  fx_rate         DECIMAL(12,6)   NOT NULL DEFAULT 1.000000,
  -- Supplier-side confirmation lifecycle, independent of the client booking status.
  confirmation_no VARCHAR(60)         NULL,
  supplier_status ENUM('pending','requested','confirmed','waitlisted','cancelled','no_show') NOT NULL DEFAULT 'pending',
  confirmed_at    DATETIME            NULL,
  voucher_sent_at DATETIME            NULL,
  supplier_bill_id BIGINT UNSIGNED    NULL,   -- set once billed
  notes           VARCHAR(500)        NULL,
  sort_order      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY idx_booking_services_booking (booking_id, day_no, sort_order),
  KEY idx_booking_services_supplier (supplier_id, supplier_status),
  KEY idx_booking_services_date (service_date, service_type),
  KEY idx_booking_services_bill (supplier_bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rooming list: which pax share which room at which hotel.
CREATE TABLE IF NOT EXISTS booking_rooms (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id         BIGINT UNSIGNED NOT NULL,
  booking_service_id BIGINT UNSIGNED     NULL,   -- the hotel service line
  room_no            SMALLINT UNSIGNED NOT NULL,
  room_type_id       BIGINT UNSIGNED     NULL,
  room_type_label    VARCHAR(120)        NULL,
  occupancy          ENUM('single','double','triple','quad') NOT NULL DEFAULT 'double',
  extra_bed          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  pax_ids            VARCHAR(255)        NULL,   -- comma-separated booking_pax.id
  hotel_room_no      VARCHAR(20)         NULL,   -- filled at check-in
  notes              VARCHAR(255)        NULL,
  PRIMARY KEY (id),
  KEY idx_booking_rooms_booking (booking_id, room_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generated client-facing documents (hotel voucher, transport voucher, tour kit).
CREATE TABLE IF NOT EXISTS vouchers (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_no         VARCHAR(30)     NOT NULL,   -- VCH-2026-0001
  booking_id         BIGINT UNSIGNED NOT NULL,
  booking_service_id BIGINT UNSIGNED     NULL,
  voucher_type       ENUM('hotel','transport','activity','flight','tour','visa','insurance') NOT NULL,
  supplier_id        BIGINT UNSIGNED     NULL,
  issued_to          VARCHAR(200)        NULL,
  valid_from         DATE                NULL,
  valid_to           DATE                NULL,
  content_json       TEXT                NULL,   -- snapshot rendered into the PDF
  file_path          VARCHAR(255)        NULL,
  status             ENUM('draft','issued','sent','cancelled') NOT NULL DEFAULT 'draft',
  issued_at          DATETIME            NULL,
  sent_at            DATETIME            NULL,
  cancelled_at       DATETIME            NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vouchers_no (voucher_no),
  KEY idx_vouchers_booking (booking_id, voucher_type),
  KEY idx_vouchers_status (status, issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cancellation slabs: days-before-departure → charge. Resolved server-side.
CREATE TABLE IF NOT EXISTS cancellation_policies (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope_type  ENUM('global','package','destination') NOT NULL DEFAULT 'global',
  scope_id    BIGINT UNSIGNED     NULL,
  days_before_min SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  days_before_max SMALLINT UNSIGNED NOT NULL DEFAULT 9999,
  charge_type ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
  charge_value DECIMAL(15,2)  NOT NULL DEFAULT 0.00,
  label       VARCHAR(120)        NULL,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_cancellation_policies_scope (scope_type, scope_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- 010_quotation_builder.sql — the toggle set behind the "Dynamic Quotation Builder"
-- (Tours_Travels_Software_Requirements.md §3). One row per quotation and, once
-- converted, one row per booking so the choices the customer agreed to travel
-- forward unchanged even if the quote is later edited or archived.
--
-- This is deliberately a separate table rather than more columns bolted onto
-- `quotations`/`bookings`: the toggle set is a cohesive, versioned concept (it
-- gets copied wholesale on conversion) and keeping it apart stops those two
-- already-wide tables from growing a second, unrelated column family.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS quotation_options (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_id              BIGINT UNSIGNED NOT NULL,
  transport_mode            ENUM('flight','train','bus','mixed','none') NOT NULL DEFAULT 'none',
  room_category             ENUM('normal','ac','non_ac','deluxe','super_deluxe','executive','suite','other') NOT NULL DEFAULT 'normal',
  food_included             TINYINT(1)      NOT NULL DEFAULT 1,
  diet_type                 ENUM('veg','non_veg','brahmin','jain') NOT NULL DEFAULT 'veg',
  baggage_included          TINYINT(1)      NOT NULL DEFAULT 0,
  baggage_notes             VARCHAR(255)        NULL,
  local_transport_included  TINYINT(1)      NOT NULL DEFAULT 0,
  sightseeing_included      TINYINT(1)      NOT NULL DEFAULT 0,
  insurance_included        TINYINT(1)      NOT NULL DEFAULT 0,
  created_at                TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quotation_options_quote (quotation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Same shape on the booking, copied verbatim by QuotationController::convert()
-- and BookingController::store() so operations always sees what was promised —
-- editing a live booking's toggles after the fact is a distinct, audited action,
-- not a side effect of someone re-opening the original quote.
CREATE TABLE IF NOT EXISTS booking_options (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id                BIGINT UNSIGNED NOT NULL,
  transport_mode            ENUM('flight','train','bus','mixed','none') NOT NULL DEFAULT 'none',
  room_category             ENUM('normal','ac','non_ac','deluxe','super_deluxe','executive','suite','other') NOT NULL DEFAULT 'normal',
  food_included             TINYINT(1)      NOT NULL DEFAULT 1,
  diet_type                 ENUM('veg','non_veg','brahmin','jain') NOT NULL DEFAULT 'veg',
  baggage_included          TINYINT(1)      NOT NULL DEFAULT 0,
  baggage_notes             VARCHAR(255)        NULL,
  local_transport_included  TINYINT(1)      NOT NULL DEFAULT 0,
  sightseeing_included      TINYINT(1)      NOT NULL DEFAULT 0,
  insurance_included        TINYINT(1)      NOT NULL DEFAULT 0,
  created_at                TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_options_booking (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

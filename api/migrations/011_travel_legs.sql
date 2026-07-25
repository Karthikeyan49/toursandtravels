-- 011_travel_legs.sql — actual travel logistics captured after a quote converts to
-- a booking (Tours_Travels_Software_Requirements.md §4): real flight/train/bus
-- numbers, PNR, exact departure/arrival timings, and finalised baggage rules.
--
-- Deliberately separate from `booking_services` (which drives supplier costing
-- and billing): a travel leg is operational/logistics data for the printable
-- itinerary handout, entered by staff once the actual PNR is issued — it may or
-- may not have a corresponding costed service line (e.g. a flight the customer
-- booked themselves still needs its timing on the handout).

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS booking_travel_legs (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id          BIGINT UNSIGNED NOT NULL,
  leg_no              SMALLINT UNSIGNED NOT NULL,
  mode                ENUM('flight','train','bus','car','other') NOT NULL DEFAULT 'flight',
  direction           ENUM('onward','return','internal') NOT NULL DEFAULT 'onward',
  carrier_name        VARCHAR(120)        NULL,   -- airline / rail operator / bus company
  vehicle_number      VARCHAR(30)         NULL,   -- flight no / train no / bus no
  pnr                 VARCHAR(20)         NULL,
  seat_class          VARCHAR(40)         NULL,   -- Economy, Sleeper 3AC, AC Seater, …
  from_location       VARCHAR(160)    NOT NULL,
  to_location         VARCHAR(160)    NOT NULL,
  departure_date      DATE            NOT NULL,
  departure_time      TIME                NULL,
  arrival_date        DATE                NULL,
  arrival_time        TIME                NULL,
  baggage_allowance   VARCHAR(120)        NULL,   -- '15kg check-in + 7kg cabin'
  confirmation_status ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
  notes               VARCHAR(500)        NULL,
  sort_order          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_travel_legs_no (booking_id, leg_no),
  KEY idx_booking_travel_legs_booking (booking_id, sort_order),
  KEY idx_booking_travel_legs_date (departure_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The assigned local driver's name/phone for pickup, drop-off and sightseeing
-- already exist via `trip_assignments` + `drivers`; nothing further needed there.

SET FOREIGN_KEY_CHECKS = 1;

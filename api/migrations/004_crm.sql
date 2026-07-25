-- 004_crm.sql — enquiries, follow-ups, quotations

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS lead_sources (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(80)     NOT NULL,   -- Walk-in, Website, Instagram, Referral, JustDial…
  is_paid    TINYINT(1)      NOT NULL DEFAULT 0,
  is_active  TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_sources_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leads (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_no         VARCHAR(30)     NOT NULL,   -- LEAD-2026-0001
  customer_id     BIGINT UNSIGNED     NULL,   -- linked once the enquirer is saved as a customer
  -- Denormalised contact so a lead can be captured before a customer record exists.
  contact_name    VARCHAR(150)    NOT NULL,
  phone           VARCHAR(20)     NOT NULL,
  email           VARCHAR(190)        NULL,
  city            VARCHAR(120)        NULL,
  source_id       BIGINT UNSIGNED     NULL,
  agency_id       BIGINT UNSIGNED     NULL,
  destination_id  BIGINT UNSIGNED     NULL,
  package_id      BIGINT UNSIGNED     NULL,
  travel_date     DATE                NULL,
  travel_date_flexible TINYINT(1) NOT NULL DEFAULT 0,
  nights          TINYINT UNSIGNED    NULL,
  adults          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  children        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  infants         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  budget_min      DECIMAL(15,2)       NULL,
  budget_max      DECIMAL(15,2)       NULL,
  requirement     TEXT                NULL,
  status          ENUM('new','contacted','quoted','negotiating','won','lost','dropped') NOT NULL DEFAULT 'new',
  previous_status VARCHAR(20)         NULL,
  lost_reason     VARCHAR(255)        NULL,
  priority        ENUM('low','medium','high','hot') NOT NULL DEFAULT 'medium',
  assigned_to     BIGINT UNSIGNED     NULL,   -- users.id (sales staff)
  next_followup_at DATETIME           NULL,
  last_contacted_at DATETIME          NULL,
  converted_booking_id BIGINT UNSIGNED NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leads_no (lead_no),
  KEY idx_leads_status (status, next_followup_at),
  KEY idx_leads_assigned (assigned_to, status),
  KEY idx_leads_phone (phone),
  KEY idx_leads_destination (destination_id, status),
  KEY idx_leads_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_followups (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id      BIGINT UNSIGNED NOT NULL,
  channel      ENUM('call','whatsapp','email','meeting','sms','other') NOT NULL DEFAULT 'call',
  direction    ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound',
  outcome      ENUM('connected','no_answer','busy','interested','not_interested','callback','quoted','closed') NOT NULL DEFAULT 'connected',
  note         VARCHAR(1000)       NULL,
  next_action  VARCHAR(255)        NULL,
  next_due_at  DATETIME            NULL,
  done_at      DATETIME        NOT NULL,
  actor_id     BIGINT UNSIGNED     NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_followups_lead (lead_id, done_at),
  KEY idx_lead_followups_due (next_due_at, actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quotations (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_no        VARCHAR(30)     NOT NULL,   -- QTN-2026-0001
  version         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  parent_quote_id BIGINT UNSIGNED     NULL,   -- revision chain
  lead_id         BIGINT UNSIGNED     NULL,
  customer_id     BIGINT UNSIGNED     NULL,
  agency_id       BIGINT UNSIGNED     NULL,
  package_id      BIGINT UNSIGNED     NULL,
  departure_id    BIGINT UNSIGNED     NULL,
  destination_id  BIGINT UNSIGNED     NULL,
  title           VARCHAR(200)    NOT NULL,
  quote_date      DATE            NOT NULL,
  valid_until     DATE                NULL,
  travel_from     DATE                NULL,
  travel_to       DATE                NULL,
  nights          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  adults          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  children        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  infants         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  hotel_category  VARCHAR(20)         NULL,
  currency        CHAR(3)         NOT NULL DEFAULT 'INR',
  -- Totals are recomputed server-side from quotation_items on every save.
  subtotal        DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  taxable_amount  DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  gst_pct         DECIMAL(6,3)    NOT NULL DEFAULT 5.000,
  gst_amount      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tcs_amount      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,   -- overseas tour packages
  grand_total     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  cost_total      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,   -- internal, never sent to client
  margin_amount   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  inclusions      TEXT                NULL,
  exclusions      TEXT                NULL,
  terms           TEXT                NULL,
  notes           TEXT                NULL,
  status          ENUM('draft','sent','viewed','revised','accepted','rejected','expired') NOT NULL DEFAULT 'draft',
  previous_status VARCHAR(20)         NULL,
  sent_at         DATETIME            NULL,
  accepted_at     DATETIME            NULL,
  rejected_reason VARCHAR(255)        NULL,
  converted_booking_id BIGINT UNSIGNED NULL,
  owner_id        BIGINT UNSIGNED     NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quotations_no (quote_no, version),
  KEY idx_quotations_lead (lead_id),
  KEY idx_quotations_customer (customer_id, status),
  KEY idx_quotations_status (status, quote_date),
  KEY idx_quotations_owner (owner_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_id  BIGINT UNSIGNED NOT NULL,
  item_type     ENUM('package','hotel','transport','activity','flight','visa','insurance','meal','guide','other') NOT NULL,
  ref_id        BIGINT UNSIGNED     NULL,
  description   VARCHAR(400)    NOT NULL,
  day_no        TINYINT UNSIGNED    NULL,
  service_date  DATE                NULL,
  quantity      DECIMAL(10,2)   NOT NULL DEFAULT 1.00,
  unit          VARCHAR(20)     NOT NULL DEFAULT 'pax',
  unit_cost     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,   -- internal
  unit_price    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,   -- client-facing
  line_cost     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  line_total    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  is_optional   TINYINT(1)      NOT NULL DEFAULT 0,
  sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_quotation_items_quote (quotation_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshot of the itinerary as quoted, so later edits to the package template
-- never rewrite history on a sent quote.
CREATE TABLE IF NOT EXISTS quotation_days (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_id  BIGINT UNSIGNED NOT NULL,
  day_no        TINYINT UNSIGNED NOT NULL,
  day_date      DATE                NULL,
  title         VARCHAR(200)    NOT NULL,
  description   TEXT                NULL,
  hotel_id      BIGINT UNSIGNED     NULL,
  hotel_name    VARCHAR(160)        NULL,
  meal_plan     VARCHAR(10)     NOT NULL DEFAULT 'B',
  PRIMARY KEY (id),
  UNIQUE KEY uq_quotation_days_no (quotation_id, day_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

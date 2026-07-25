-- 006_finance.sql — receivables, payables, the polymorphic payment ledger, expenses
--
-- Rule enforced throughout: financial documents are NEVER deleted. They are voided
-- with voided_by / voided_at / void_reason. Outstanding balances are NEVER stored;
-- they are computed as total - SUM(non-void payments).

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Sales invoices (receivable side)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoices (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_no      VARCHAR(30)     NOT NULL,   -- INV-2026-27-0001
  booking_id      BIGINT UNSIGNED     NULL,
  customer_id     BIGINT UNSIGNED NOT NULL,
  agency_id       BIGINT UNSIGNED     NULL,
  invoice_type    ENUM('tax_invoice','proforma','credit_note','debit_note') NOT NULL DEFAULT 'tax_invoice',
  invoice_date    DATE            NOT NULL,
  due_date        DATE                NULL,
  place_of_supply VARCHAR(60)         NULL,
  seller_state    VARCHAR(60)         NULL,
  customer_state  VARCHAR(60)         NULL,
  customer_gstin  VARCHAR(15)         NULL,
  currency        CHAR(3)         NOT NULL DEFAULT 'INR',
  fx_rate         DECIMAL(12,6)   NOT NULL DEFAULT 1.000000,
  subtotal        DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  taxable_amount  DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  -- Tour operators in India commonly bill under a margin/composite scheme; both
  -- intra-state (CGST+SGST) and inter-state (IGST) splits are carried explicitly.
  cgst_amount     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  sgst_amount     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  igst_amount     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tcs_amount      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  round_off       DECIMAL(6,2)    NOT NULL DEFAULT 0.00,
  grand_total     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  amount_paid     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  payment_status  ENUM('unpaid','partially_paid','paid','overdue','written_off') NOT NULL DEFAULT 'unpaid',
  last_payment_at DATETIME            NULL,
  status          ENUM('draft','issued','sent','paid','cancelled','void') NOT NULL DEFAULT 'draft',
  notes           TEXT                NULL,
  terms           TEXT                NULL,
  voided_by       BIGINT UNSIGNED     NULL,
  voided_at       DATETIME            NULL,
  void_reason     VARCHAR(255)        NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoices_no (invoice_no),
  KEY idx_invoices_booking (booking_id),
  KEY idx_invoices_customer (customer_id, payment_status),
  KEY idx_invoices_date (invoice_date, status),
  KEY idx_invoices_due (due_date, payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id   BIGINT UNSIGNED NOT NULL,
  description  VARCHAR(400)    NOT NULL,
  sac_code     VARCHAR(10)         NULL,   -- 9985 / 998555 for tour operator services
  quantity     DECIMAL(10,2)   NOT NULL DEFAULT 1.00,
  unit         VARCHAR(20)     NOT NULL DEFAULT 'pax',
  unit_price   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  discount_pct DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  taxable_value DECIMAL(15,2)  NOT NULL DEFAULT 0.00,
  gst_pct      DECIMAL(6,3)    NOT NULL DEFAULT 5.000,
  gst_amount   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  line_total   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_invoice_items_invoice (invoice_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- The polymorphic payment ledger — the single most reusable table in the schema.
-- Serves booking advances/instalments, invoice receipts, supplier payments,
-- refunds and agent commission payouts. One shape, one set of reports.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_no    VARCHAR(30)     NOT NULL,   -- PAY-2026-27-0001
  ref_type      ENUM('booking','invoice','supplier_bill','commission','refund','expense') NOT NULL,
  ref_id        BIGINT UNSIGNED NOT NULL,
  seq           SMALLINT UNSIGNED NOT NULL DEFAULT 1,   -- instalment number
  label         VARCHAR(120)        NULL,   -- 'Advance', 'Balance before departure'
  direction     ENUM('in','out')  NOT NULL DEFAULT 'in',
  amount        DECIMAL(15,2)   NOT NULL,
  currency      CHAR(3)         NOT NULL DEFAULT 'INR',
  fx_rate       DECIMAL(12,6)   NOT NULL DEFAULT 1.000000,
  mode          ENUM('cash','bank_transfer','upi','cheque','card','wallet','adjustment','online_gateway') NOT NULL DEFAULT 'bank_transfer',
  utr_no        VARCHAR(60)         NULL,
  bank_account  VARCHAR(80)         NULL,
  gateway_ref   VARCHAR(120)        NULL,
  due_on        DATE                NULL,   -- set for a scheduled, unpaid instalment
  paid_on       DATE                NULL,   -- NULL = scheduled but not yet received
  status        ENUM('scheduled','paid','bounced','void') NOT NULL DEFAULT 'paid',
  remarks       VARCHAR(400)        NULL,
  voided_by     BIGINT UNSIGNED     NULL,
  voided_at     DATETIME            NULL,
  void_reason   VARCHAR(255)        NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_no (payment_no),
  KEY idx_payments_ref (ref_type, ref_id, status),
  KEY idx_payments_paid_on (paid_on, direction, status),
  KEY idx_payments_due (due_on, status),
  KEY idx_payments_mode (mode, paid_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Payables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_bills (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bill_no         VARCHAR(30)     NOT NULL,   -- internal SB-2026-27-0001
  supplier_ref_no VARCHAR(60)         NULL,   -- the supplier's own invoice number
  supplier_id     BIGINT UNSIGNED NOT NULL,
  booking_id      BIGINT UNSIGNED     NULL,
  bill_date       DATE            NOT NULL,
  due_date        DATE                NULL,
  currency        CHAR(3)         NOT NULL DEFAULT 'INR',
  fx_rate         DECIMAL(12,6)   NOT NULL DEFAULT 1.000000,
  subtotal        DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tax_amount      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tds_amount      DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  grand_total     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  amount_paid     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  payment_status  ENUM('unpaid','partially_paid','paid','overdue','disputed') NOT NULL DEFAULT 'unpaid',
  status          ENUM('draft','approved','paid','cancelled','void') NOT NULL DEFAULT 'draft',
  approved_by     BIGINT UNSIGNED     NULL,
  approved_at     DATETIME            NULL,
  notes           TEXT                NULL,
  voided_by       BIGINT UNSIGNED     NULL,
  voided_at       DATETIME            NULL,
  void_reason     VARCHAR(255)        NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_bills_no (bill_no),
  KEY idx_supplier_bills_supplier (supplier_id, payment_status),
  KEY idx_supplier_bills_booking (booking_id),
  KEY idx_supplier_bills_due (due_date, payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_bill_items (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_bill_id   BIGINT UNSIGNED NOT NULL,
  booking_service_id BIGINT UNSIGNED     NULL,
  description        VARCHAR(400)    NOT NULL,
  quantity           DECIMAL(10,2)   NOT NULL DEFAULT 1.00,
  unit_cost          DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tax_pct            DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  line_total         DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  sort_order         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_supplier_bill_items_bill (supplier_bill_id, sort_order),
  KEY idx_supplier_bill_items_service (booking_service_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Overheads and agent commission
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expenses (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  expense_no    VARCHAR(30)     NOT NULL,
  expense_date  DATE            NOT NULL,
  category      VARCHAR(60)     NOT NULL,   -- Marketing, Office Rent, Salaries, Fuel…
  subcategory   VARCHAR(60)         NULL,
  booking_id    BIGINT UNSIGNED     NULL,   -- direct-cost expenses attach to a booking
  supplier_id   BIGINT UNSIGNED     NULL,
  description   VARCHAR(400)    NOT NULL,
  amount        DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tax_amount    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  total_amount  DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  mode          ENUM('cash','bank_transfer','upi','cheque','card') NOT NULL DEFAULT 'cash',
  paid_by       BIGINT UNSIGNED     NULL,   -- users.id, for reimbursements
  is_reimbursable TINYINT(1)    NOT NULL DEFAULT 0,
  reimbursed_at DATETIME            NULL,
  status        ENUM('draft','submitted','approved','rejected','paid','void') NOT NULL DEFAULT 'draft',
  approved_by   BIGINT UNSIGNED     NULL,
  approved_at   DATETIME            NULL,
  rejection_reason VARCHAR(255)     NULL,
  voided_by     BIGINT UNSIGNED     NULL,
  voided_at     DATETIME            NULL,
  void_reason   VARCHAR(255)        NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expenses_no (expense_no),
  KEY idx_expenses_date (expense_date, category),
  KEY idx_expenses_booking (booking_id),
  KEY idx_expenses_status (status, expense_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS commissions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  commission_no VARCHAR(30)     NOT NULL,
  payee_type    ENUM('agency','staff','referrer') NOT NULL DEFAULT 'agency',
  payee_id      BIGINT UNSIGNED NOT NULL,   -- agencies.id | users.id | customers.id
  booking_id    BIGINT UNSIGNED NOT NULL,
  basis         ENUM('percent_of_sale','percent_of_margin','fixed') NOT NULL DEFAULT 'percent_of_sale',
  basis_value   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  base_amount   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  amount        DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  tds_pct       DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  tds_amount    DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  net_payable   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  amount_paid   DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  status        ENUM('pending','approved','paid','cancelled','void') NOT NULL DEFAULT 'pending',
  approved_by   BIGINT UNSIGNED     NULL,
  approved_at   DATETIME            NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_commissions_no (commission_no),
  KEY idx_commissions_payee (payee_type, payee_id, status),
  KEY idx_commissions_booking (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

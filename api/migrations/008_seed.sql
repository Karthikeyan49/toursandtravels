-- 008_seed.sql — reference data only. NO user accounts here.
-- The bootstrap admin is created by `php api/install.php` so that a password hash
-- is never committed to the repository.

INSERT IGNORE INTO settings (setting_key, setting_value, value_type, description, is_public) VALUES
  ('company_name',          'Your Travel Company',  'string',  'Legal name on invoices and vouchers', 1),
  ('company_legal_name',    'Your Travel Company Pvt Ltd', 'string', 'Full registered name', 0),
  ('company_address',       '',                     'string',  'Registered address block', 1),
  ('company_city',          '',                     'string',  'City', 1),
  ('company_state',         'Tamil Nadu',           'string',  'Home state — drives CGST/SGST vs IGST', 0),
  ('company_pincode',       '',                     'string',  'PIN code', 1),
  ('company_phone',         '',                     'string',  'Primary contact number', 1),
  ('company_email',         '',                     'string',  'Primary contact email', 1),
  ('company_website',       '',                     'string',  'Website URL', 1),
  ('company_gstin',         '',                     'string',  'GSTIN', 0),
  ('company_pan',           '',                     'string',  'PAN', 0),
  ('company_logo',          '',                     'string',  'Relative path to logo used on PDFs', 1),
  ('company_primary_color', '#0F766E',              'string',  'Brand colour applied to the UI and PDFs', 1),
  ('iata_number',           '',                     'string',  'IATA / TAFI / IATO registration', 0),

  ('bank_name',             '',                     'string',  'Bank name printed on invoices', 0),
  ('bank_account_name',     '',                     'string',  'Account holder name', 0),
  ('bank_account_no',       '',                     'string',  'Account number', 0),
  ('bank_ifsc',             '',                     'string',  'IFSC code', 0),
  ('bank_upi_id',           '',                     'string',  'UPI VPA for collections', 0),

  ('default_gst_pct',       '5.000',                'decimal', 'GST on tour operator services (SAC 9985)', 0),
  ('default_tcs_pct',       '5.000',                'decimal', 'TCS on overseas tour packages', 0),
  ('default_markup_pct',    '15.000',               'decimal', 'Default markup applied when costing a new package', 0),
  ('default_currency',      'INR',                  'string',  'Base reporting currency', 0),
  ('quote_validity_days',   '7',                    'int',     'Default validity window on a new quotation', 0),
  ('advance_percent',       '25.000',               'decimal', 'Advance required to confirm a booking', 0),
  ('balance_due_days_before','15',                  'int',     'Balance must be cleared N days before departure', 0),
  ('lead_idle_alert_hours', '48',                   'int',     'Raise a notification if a lead has no follow-up in N hours', 0),
  ('passport_expiry_alert_days','180',              'int',     'Warn when a pax passport expires within N days of travel', 0),
  ('hold_expiry_hours',     '48',                   'int',     'Seat hold released after N hours without an advance', 0),

  ('seq_QTN_prefix',        'QTN',                  'string',  'Quotation number prefix', 0),
  ('seq_BKG_prefix',        'BKG',                  'string',  'Booking number prefix', 0),
  ('seq_INV_prefix',        'INV',                  'string',  'Invoice number prefix', 0),
  ('seq_PAY_prefix',        'PAY',                  'string',  'Payment number prefix', 0),
  ('seq_VCH_prefix',        'VCH',                  'string',  'Voucher number prefix', 0),
  ('seq_SB_prefix',         'SB',                   'string',  'Supplier bill prefix', 0),
  ('seq_EXP_prefix',        'EXP',                  'string',  'Expense number prefix', 0),
  ('seq_LEAD_prefix',       'LEAD',                 'string',  'Lead number prefix', 0),
  ('seq_PKG_prefix',        'PKG',                  'string',  'Package code prefix', 0),
  ('seq_CUS_prefix',        'CUS',                  'string',  'Customer code prefix', 0),
  ('seq_SUP_prefix',        'SUP',                  'string',  'Supplier code prefix', 0),
  ('seq_COM_prefix',        'COM',                  'string',  'Commission number prefix', 0);

INSERT IGNORE INTO lead_sources (name, is_paid, is_active) VALUES
  ('Walk-in',        0, 1),
  ('Phone Enquiry',  0, 1),
  ('Website',        0, 1),
  ('WhatsApp',       0, 1),
  ('Instagram',      1, 1),
  ('Facebook Ads',   1, 1),
  ('Google Ads',     1, 1),
  ('Referral',       0, 1),
  ('Repeat Customer',0, 1),
  ('Travel Agent',   0, 1),
  ('Exhibition',     1, 1),
  ('Other',          0, 1);

INSERT IGNORE INTO countries (iso2, name, currency, dial_code, visa_required, is_active) VALUES
  ('IN','India','INR','+91',0,1),
  ('AE','United Arab Emirates','AED','+971',1,1),
  ('TH','Thailand','THB','+66',1,1),
  ('SG','Singapore','SGD','+65',1,1),
  ('MY','Malaysia','MYR','+60',1,1),
  ('ID','Indonesia','IDR','+62',1,1),
  ('LK','Sri Lanka','LKR','+94',1,1),
  ('NP','Nepal','NPR','+977',0,1),
  ('MV','Maldives','MVR','+960',0,1),
  ('BT','Bhutan','BTN','+975',0,1),
  ('VN','Vietnam','VND','+84',1,1),
  ('GB','United Kingdom','GBP','+44',1,1),
  ('US','United States','USD','+1',1,1),
  ('CH','Switzerland','CHF','+41',1,1),
  ('FR','France','EUR','+33',1,1),
  ('IT','Italy','EUR','+39',1,1),
  ('TR','Turkey','TRY','+90',1,1),
  ('EG','Egypt','EGP','+20',1,1),
  ('AZ','Azerbaijan','AZN','+994',1,1),
  ('GE','Georgia','GEL','+995',1,1),
  ('AU','Australia','AUD','+61',1,1),
  ('NZ','New Zealand','NZD','+64',1,1),
  ('JP','Japan','JPY','+81',1,1),
  ('MU','Mauritius','MUR','+230',0,1);

-- Default cancellation slabs (global scope). Operator can override per package.
INSERT IGNORE INTO cancellation_policies (id, scope_type, scope_id, days_before_min, days_before_max, charge_type, charge_value, label, is_active) VALUES
  (1, 'global', NULL, 30, 9999, 'percent', 10.00, '30+ days before departure', 1),
  (2, 'global', NULL, 15,   29, 'percent', 25.00, '15–29 days before departure', 1),
  (3, 'global', NULL,  7,   14, 'percent', 50.00, '7–14 days before departure', 1),
  (4, 'global', NULL,  3,    6, 'percent', 75.00, '3–6 days before departure', 1),
  (5, 'global', NULL,  0,    2, 'percent',100.00, 'Within 48 hours / no-show', 1);

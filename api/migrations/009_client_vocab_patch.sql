-- 009_client_vocab_patch.sql — vocabulary gaps found against the client's call-recording
-- requirements (Tours_Travels_Software_Requirements.md): 2-Star hotels, Bus as a transport
-- mode, Brahmin food, and a Full-Package/Independent split on quotations.
--
-- MODIFY COLUMN on an ENUM is naturally idempotent (re-running restates the same
-- widened set), so no guard is needed for these. ADD COLUMN IF NOT EXISTS is used
-- for the new columns so this file is safe to re-run.

SET FOREIGN_KEY_CHECKS = 0;

-- Hotel category: client's list is Budget, 2-Star, 3-Star, 4-Star, 5-Star.
ALTER TABLE hotels
  MODIFY COLUMN category ENUM('budget','2star','3star','4star','5star','luxury','resort','homestay','houseboat','camp')
    NOT NULL DEFAULT '3star';

ALTER TABLE package_prices
  MODIFY COLUMN hotel_category ENUM('budget','2star','3star','4star','5star','luxury') NOT NULL DEFAULT '3star';

-- Transport mode: client explicitly lists Flight / Train / Bus / Mixed. 'train' and
-- 'flight' already existed as service types; 'bus' did not.
ALTER TABLE booking_services
  MODIFY COLUMN service_type ENUM('hotel','transport','activity','flight','train','bus','visa','insurance','guide','meal','other') NOT NULL;

ALTER TABLE quotation_items
  MODIFY COLUMN item_type ENUM('package','hotel','transport','activity','flight','train','bus','visa','insurance','meal','guide','other') NOT NULL;

ALTER TABLE package_day_items
  MODIFY COLUMN item_type ENUM('hotel','activity','transport','flight','train','bus','meal','other') NOT NULL;

-- Dietary options: client lists Vegetarian, Non-Vegetarian, Brahmin Food, Jain Food.
ALTER TABLE booking_pax
  MODIFY COLUMN meal_preference ENUM('none','veg','non_veg','brahmin','jain','vegan','halal') NOT NULL DEFAULT 'none';

-- Cash / Non-GST billing alongside the existing tax invoice.
ALTER TABLE invoices
  MODIFY COLUMN invoice_type ENUM('tax_invoice','cash_bill','proforma','credit_note','debit_note') NOT NULL DEFAULT 'tax_invoice';

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS is_gst_applicable TINYINT(1) NOT NULL DEFAULT 1 AFTER invoice_type;

-- Full Package vs Independent/Individual booking, using the same vocabulary as
-- bookings.booking_type so the quote and the booking it converts to always agree.
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS quote_type ENUM('package','custom','hotel_only','transport_only','activity_only','visa_only')
    NOT NULL DEFAULT 'package' AFTER package_id;

-- Standard room-type picklist (Normal, AC, Non-AC, Deluxe, Super Deluxe, Executive,
-- Suite) as a filterable tag on top of the hotel's own free-text room type name.
ALTER TABLE hotel_room_types
  ADD COLUMN IF NOT EXISTS room_category ENUM('normal','ac','non_ac','deluxe','super_deluxe','executive','suite','other')
    NOT NULL DEFAULT 'normal' AFTER name;

-- New document-number series for the cash/non-GST bill.
INSERT IGNORE INTO settings (setting_key, setting_value, value_type, description, is_public) VALUES
  ('seq_CASH_prefix', 'CASH', 'string', 'Cash / non-GST bill number prefix', 0);

SET FOREIGN_KEY_CHECKS = 1;

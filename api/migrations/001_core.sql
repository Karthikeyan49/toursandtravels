-- 001_core.sql — identity, security, and cross-cutting infrastructure
-- MariaDB / InnoDB. Charset+collation are declared EXPLICITLY on every table:
-- relying on the server default (utf8mb4_uca1400_ai_ci on MariaDB 11.x) breaks every
-- JOIN with errno 1267 "Illegal mix of collations".
-- All migrations are idempotent and safe to re-run.

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name         VARCHAR(150)    NOT NULL,
  email             VARCHAR(190)        NULL,
  phone             VARCHAR(20)         NULL,
  password_hash     VARCHAR(255)    NOT NULL,
  -- Coarse tier. `agent` = B2B travel agent portal, `customer` = B2C traveller portal.
  user_type         ENUM('staff','agent','customer') NOT NULL DEFAULT 'staff',
  -- Fine-grained role, validated in PHP against AdminMiddleware::ROLES.
  staff_role        VARCHAR(30)         NULL,
  agency_id         BIGINT UNSIGNED     NULL,   -- set when user_type='agent'
  avatar_path       VARCHAR(255)        NULL,
  is_active         TINYINT(1)      NOT NULL DEFAULT 1,
  last_login_at     TIMESTAMP           NULL,
  failed_logins     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until      TIMESTAMP           NULL,
  must_change_pw    TINYINT(1)      NOT NULL DEFAULT 0,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by        BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone),
  KEY idx_users_type_active (user_type, is_active),
  KEY idx_users_agency (agency_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  token_hash    VARCHAR(64)     NOT NULL,          -- sha256 hex, never the raw token
  client_type   VARCHAR(20)     NOT NULL DEFAULT 'web',
  user_agent    VARCHAR(255)        NULL,
  ip_address    VARCHAR(45)         NULL,
  expires_at    TIMESTAMP       NOT NULL,
  revoked_at    TIMESTAMP           NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY idx_refresh_tokens_user (user_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Access-token denylist. Holds only the jti until natural expiry.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  jti_hash    VARCHAR(64)     NOT NULL,
  expires_at  TIMESTAMP       NOT NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_revoked_tokens_jti (jti_hash),
  KEY idx_revoked_tokens_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  VARCHAR(64)     NOT NULL,
  expires_at  TIMESTAMP       NOT NULL,            -- 15 minutes, not 30 days
  used_at     TIMESTAMP           NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_resets_hash (token_hash),
  KEY idx_password_resets_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Security infrastructure
-- ---------------------------------------------------------------------------

-- created_at is an epoch INT, not TIMESTAMP: this table is written on every single
-- request and integer comparison is materially cheaper than datetime arithmetic.
CREATE TABLE IF NOT EXISTS rate_limits (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip          VARCHAR(45)     NOT NULL,
  bucket      VARCHAR(40)     NOT NULL,
  created_at  INT UNSIGNED    NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rate_limits_lookup (ip, bucket, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED     NULL,
  action        VARCHAR(60)     NOT NULL,   -- create|update|delete|void|login|permission_denied|…
  entity_type   VARCHAR(60)         NULL,   -- table or logical entity name
  entity_id     BIGINT UNSIGNED     NULL,
  old_value     LONGTEXT            NULL,
  new_value     LONGTEXT            NULL,
  note          VARCHAR(255)        NULL,
  ip_address    VARCHAR(45)         NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_log_entity (entity_type, entity_id),
  KEY idx_audit_log_user (user_id, created_at),
  KEY idx_audit_log_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Cross-cutting infrastructure
-- ---------------------------------------------------------------------------

-- Operator-tunable configuration. Anything that might change without a deploy
-- lives here, not in code: company details, GST rate, doc prefixes, cancellation
-- slab defaults, markup defaults.
CREATE TABLE IF NOT EXISTS settings (
  setting_key    VARCHAR(80)  NOT NULL,
  setting_value  TEXT             NULL,
  value_type     ENUM('string','int','decimal','bool','json') NOT NULL DEFAULT 'string',
  description    VARCHAR(255)     NULL,
  is_public      TINYINT(1)   NOT NULL DEFAULT 0,   -- exposed to unauthenticated clients
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by     BIGINT UNSIGNED  NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Atomic document numbering. One row per (doc_type, period).
CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type    VARCHAR(20) NOT NULL,
  period      VARCHAR(10) NOT NULL,        -- '' | '2026' | '2026-07' | '2026-27'
  next_value  INT UNSIGNED NOT NULL DEFAULT 1,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (doc_type, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Polymorphic attachment store. Serves passports, visas, vouchers, supplier
-- invoices, hotel contracts, trip photos — every module, one table.
CREATE TABLE IF NOT EXISTS attachments (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type    VARCHAR(60)     NOT NULL,
  entity_id      BIGINT UNSIGNED NOT NULL,
  category       VARCHAR(40)     NOT NULL DEFAULT 'default',
  file_path      VARCHAR(255)    NOT NULL,   -- relative to uploads root
  original_name  VARCHAR(255)    NOT NULL,
  mime_type      VARCHAR(100)    NOT NULL,
  size_bytes     BIGINT UNSIGNED NOT NULL,
  metadata_json  TEXT                NULL,
  uploaded_by    BIGINT UNSIGNED     NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_attachments_entity (entity_type, entity_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Real notifications table. The reference system derived its feed on the fly from
-- pending rows; agent 3 flagged that as the one area to design properly instead.
CREATE TABLE IF NOT EXISTS notifications (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED     NULL,   -- NULL = broadcast to a role
  role_scope   VARCHAR(30)         NULL,
  kind         VARCHAR(40)     NOT NULL,   -- payment_due|departure_soon|doc_expiring|lead_idle|…
  title        VARCHAR(160)    NOT NULL,
  body         VARCHAR(500)        NULL,
  entity_type  VARCHAR(60)         NULL,
  entity_id    BIGINT UNSIGNED     NULL,
  severity     ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
  read_at      TIMESTAMP           NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_inbox (user_id, read_at, created_at),
  KEY idx_notifications_role (role_scope, read_at, created_at),
  KEY idx_notifications_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-row bulk import, so a single bad row never rejects the file.
CREATE TABLE IF NOT EXISTS import_jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  module        VARCHAR(40)     NOT NULL,
  file_path     VARCHAR(255)    NOT NULL,
  original_name VARCHAR(255)    NOT NULL,
  mapping_json  TEXT                NULL,
  status        ENUM('pending','validating','ready','importing','completed','failed') NOT NULL DEFAULT 'pending',
  total_rows    INT UNSIGNED    NOT NULL DEFAULT 0,
  valid_rows    INT UNSIGNED    NOT NULL DEFAULT 0,
  error_rows    INT UNSIGNED    NOT NULL DEFAULT 0,
  created_by    BIGINT UNSIGNED     NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_import_jobs_module (module, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_job_rows (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id      BIGINT UNSIGNED NOT NULL,
  row_number  INT UNSIGNED    NOT NULL,
  raw_json    TEXT            NOT NULL,
  status      ENUM('valid','error','imported','skipped') NOT NULL DEFAULT 'valid',
  error_text  VARCHAR(500)        NULL,
  entity_id   BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY idx_import_job_rows_job (job_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generic state-transition history, usable by any status-bearing entity.
CREATE TABLE IF NOT EXISTS workflow_history (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type  VARCHAR(60)     NOT NULL,
  entity_id    BIGINT UNSIGNED NOT NULL,
  from_status  VARCHAR(40)         NULL,
  to_status    VARCHAR(40)     NOT NULL,
  note         VARCHAR(255)        NULL,
  actor_id     BIGINT UNSIGNED     NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workflow_history_entity (entity_type, entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

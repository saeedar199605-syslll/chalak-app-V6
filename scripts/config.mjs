// Single source of truth for the V7 two-service topology. Every script and test imports this.
export const VERSION = '8.1.0';
export const BASE = { version: '7.0.0', gitCommit: '15bddd2', note: 'V7 as deployed to production (branch main of chalak-app-V6)' };
export const WRANGLER_VERSION = '4.131.2';
export const NODE_MAJOR = 24;
export const COMPATIBILITY_DATE = '2026-09-14';
export const KV_BINDING = 'CHALAK_DB';
export const KV_NAMESPACE_ID = '4f2179fbe74b4e379556b6fb53337f2e';
export const DO_BINDING = 'CHALAK_STATE';
export const DO_CLASS = 'ChalakState';
export const DO_OBJECT_NAME = 'chalak-authoritative-state-v1';
export const WORKER_NAME = 'chalak-state-authority';
export const PAGES_DEFAULT_NAME = 'chalak-performance';
export const MIGRATION_TAG = 'v6.2-sqlite-v1';
// Scheduled R2 backups are optional. Flip to true only after the bucket exists and the token may use R2.
export const R2_BACKUP_ENABLED = false;
export const R2_BINDING = 'CHALAK_BACKUPS';
export const R2_BUCKET = 'chalak-backups';
export const BACKUP_CRON = '0 0 * * *';
export const PAGES_SECRETS_REQUIRED = ['ADMIN_PASSWORD'];
export const PAGES_VARS_KNOWN = ['ADMIN_PASSWORD', 'GEMINI_API_KEY', 'EMAIL_INGEST_WEBHOOK_SECRET', 'EMAIL_INGEST_ALLOWED_SENDERS', 'STORAGE_MAINTENANCE_TOKEN'];
export const WORKER_SECRETS_KNOWN = ['STORAGE_MAINTENANCE_TOKEN'];
export const FREEZE_ENV = 'CHALAK_LEGACY_WRITES_FROZEN';
export const HASHED_FILES_ROOTS = ['pages', 'worker', 'scripts', 'tools/state-transfer.mjs'];

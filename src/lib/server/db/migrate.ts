import { getDatabase } from "./client";

const migrationSql = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  provider TEXT NOT NULL,
  default_model TEXT,
  default_font_size INTEGER NOT NULL DEFAULT 16,
  sync_status TEXT NOT NULL DEFAULT 'healthy',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_credential_metadata (
  provider TEXT PRIMARY KEY,
  key_alias TEXT NOT NULL,
  last_tested_at TEXT,
  last_test_status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  number INTEGER,
  title TEXT NOT NULL,
  current_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  latest_version_id TEXT,
  last_scanned_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chapter_versions (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'never-scanned',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_jobs (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  chapter_version_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT,
  completed_at TEXT,
  summary_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_result_artifacts (
  id TEXT PRIMARY KEY,
  scan_job_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  subtype TEXT,
  is_stub TEXT NOT NULL DEFAULT '1',
  descriptor TEXT,
  article_body TEXT NOT NULL,
  evidence_status TEXT NOT NULL DEFAULT 'mentioned-only',
  created_from_chapter_id TEXT,
  last_updated_from_chapter_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  source_chapter_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  source_chapter_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chronology_entries (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  body TEXT NOT NULL,
  relative_order TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source_chapter_ids TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  source_chapter_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generated_pages (
  id TEXT PRIMARY KEY,
  page_type TEXT NOT NULL,
  category TEXT,
  slug TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS derived_dependencies (
  id TEXT PRIMARY KEY,
  source_chapter_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS file_projections (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  evidence_json TEXT,
  created_at TEXT NOT NULL
);
`;

export function migrate() {
  const db = getDatabase();
  db.exec(migrationSql);

  const entityColumns = db
    .prepare("PRAGMA table_info(entities)")
    .all() as Array<Record<string, unknown>>;
  const entityColumnNames = new Set(
    entityColumns.map((column) => String(column.name)),
  );

  if (!entityColumnNames.has("parent_entity_id")) {
    db.exec("ALTER TABLE entities ADD COLUMN parent_entity_id TEXT");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
}

-- audit/schema.sql (D-14.1 hybrid: turn row + child tool row)
-- Open with bun:sqlite { strict: true, safeIntegers: true, create: true } (PITFALL #10)
-- After CREATE TABLE: db.run("PRAGMA journal_mode = WAL"); db.run("PRAGMA synchronous = NORMAL")
--
-- Hybrid 스키마 (D-14.1):
--   parent_id NULL → user turn row (prompt + 합계 cost)
--   parent_id NOT NULL → 단일 tool call row (parent turn 자식)
--
-- 컬럼 길이 제약 (≤2000 / ≤500)은 SQLite가 강제하지 않음 — application layer (audit/log.ts)에서 trim. (D-14.3)

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  -- Turn row (parent_id NULL) — D-14.3 minimum
  model TEXT,
  prompt TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  total_tool_calls INTEGER,
  duration_ms INTEGER,
  error_envelope TEXT,
  -- Tool row (parent_id NOT NULL) — D-14.3 minimum
  parent_id INTEGER REFERENCES events(id),
  tool_name TEXT,
  input TEXT,
  result_summary TEXT,
  ok INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_parent_id ON events(parent_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

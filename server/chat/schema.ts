/** Lakebase DDL for BricksBot. Schema owned by the App service principal. */
export const BRICKSBOT_SCHEMA = 'bricksbot';

export const CHAT_SCHEMA_STATEMENTS = [
  `CREATE SCHEMA IF NOT EXISTS bricksbot`,
  `CREATE TABLE IF NOT EXISTS bricksbot.spaces (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.space_members (
  space_id UUID NOT NULL REFERENCES bricksbot.spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'member', 'admin')),
  PRIMARY KEY (space_id, user_id)
)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.bots (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_label TEXT NOT NULL,
  presence TEXT NOT NULL CHECK (presence IN ('online', 'away', 'offline', 'thinking', 'working', 'waiting', 'blocked')),
  space_id UUID REFERENCES bricksbot.spaces(id) ON DELETE SET NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id TEXT NOT NULL DEFAULT 'workspace-user',
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.chats (
  id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bricksbot.bots(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_chats_bot_lookup
  ON bricksbot.chats(bot_id)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.messages (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES bricksbot.chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_call_id TEXT,
  tool_calls TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_messages_chat_created
  ON bricksbot.messages(chat_id, created_at)`,
  `ALTER TABLE bricksbot.messages ADD COLUMN IF NOT EXISTS tool_call_id TEXT`,
  `ALTER TABLE bricksbot.messages ADD COLUMN IF NOT EXISTS tool_calls TEXT`,
  `ALTER TABLE bricksbot.bots ADD COLUMN IF NOT EXISTS space_id UUID`,
  `ALTER TABLE bricksbot.bots ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE bricksbot.bots ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'workspace-user'`,
  `ALTER TABLE bricksbot.bots ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE bricksbot.bots ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `ALTER TABLE bricksbot.bots ADD COLUMN IF NOT EXISTS last_message_preview TEXT`,
  `ALTER TABLE bricksbot.bots ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE bricksbot.bots ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE bricksbot.bots ADD COLUMN IF NOT EXISTS source_bot_id UUID`,
  `ALTER TABLE bricksbot.chats ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'workspace-user'`,
  `UPDATE bricksbot.chats c SET user_id = b.owner_id FROM bricksbot.bots b WHERE c.bot_id = b.id AND c.user_id = 'workspace-user' AND b.owner_id <> 'workspace-user' AND NOT EXISTS (SELECT 1 FROM bricksbot.chats existing WHERE existing.bot_id = c.bot_id AND existing.user_id = b.owner_id)`,
  `ALTER TABLE bricksbot.chats ADD COLUMN IF NOT EXISTS last_message_preview TEXT`,
  `DROP INDEX IF EXISTS bricksbot.idx_bricksbot_chats_bot_id`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_bricksbot_chats_bot_user ON bricksbot.chats(bot_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_space_members_user
  ON bricksbot.space_members(user_id, space_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_bots_roster
  ON bricksbot.bots(owner_id, space_id, sort_order, created_at)`,
  `ALTER TABLE bricksbot.messages DROP CONSTRAINT IF EXISTS messages_role_check`,
  `ALTER TABLE bricksbot.messages ADD CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant', 'system', 'tool'))`,
  `ALTER TABLE bricksbot.bots DROP CONSTRAINT IF EXISTS bots_presence_check`,
  `ALTER TABLE bricksbot.bots ADD CONSTRAINT bots_presence_check CHECK (presence IN ('online', 'away', 'offline', 'thinking', 'working', 'waiting', 'blocked'))`,
  `CREATE TABLE IF NOT EXISTS bricksbot.routines (
  id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bricksbot.bots(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  webhook_key_hash TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_routines_owner
  ON bricksbot.routines(owner_id, created_at)`,
  // Existing routines become owner_approval too: data tools no longer run as the App SP.
  `ALTER TABLE bricksbot.routines ADD COLUMN IF NOT EXISTS run_as TEXT NOT NULL DEFAULT 'owner_approval'`,
  `ALTER TABLE bricksbot.routines DROP CONSTRAINT IF EXISTS routines_run_as_check`,
  `ALTER TABLE bricksbot.routines ADD CONSTRAINT routines_run_as_check CHECK (run_as IN ('owner_approval', 'app'))`,
  `CREATE TABLE IF NOT EXISTS bricksbot.bot_memories (
  id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bricksbot.bots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT 'workspace-user',
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bot_id, user_id, key)
)`,
  `ALTER TABLE bricksbot.bot_memories ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'workspace-user'`,
  `UPDATE bricksbot.bot_memories m SET user_id = b.owner_id FROM bricksbot.bots b WHERE m.bot_id = b.id AND m.user_id = 'workspace-user' AND b.owner_id <> 'workspace-user' AND NOT EXISTS (SELECT 1 FROM bricksbot.bot_memories existing WHERE existing.bot_id = m.bot_id AND existing.user_id = b.owner_id AND existing.key = m.key)`,
  `ALTER TABLE bricksbot.bot_memories DROP CONSTRAINT IF EXISTS bot_memories_bot_id_key_key`,
  `ALTER TABLE bricksbot.bot_memories DROP CONSTRAINT IF EXISTS bot_memories_bot_id_user_id_key_key`,
  `ALTER TABLE bricksbot.bot_memories ADD CONSTRAINT bot_memories_bot_id_user_id_key_key UNIQUE (bot_id, user_id, key)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.bot_skills (
  id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bricksbot.bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bot_id, name)
)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.compactions (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES bricksbot.chats(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  keep_from_message_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_compactions_chat
  ON bricksbot.compactions(chat_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.approvals (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES bricksbot.chats(id) ON DELETE CASCADE,
  tool_call TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  decision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_approvals_chat_pending
  ON bricksbot.approvals(chat_id, status)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.auto_approvals (
  chat_id UUID NOT NULL REFERENCES bricksbot.chats(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, tool_name)
)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.approval_events (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL,
  approval_id UUID,
  bot_id UUID,
  user_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('requested', 'decided')),
  tool_name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_approval_events_chat
  ON bricksbot.approval_events(chat_id, created_at DESC)`,
  // The trail outlives chat/bot deletes and never keeps raw tool args (now argsDigest + argKeys).
  `ALTER TABLE bricksbot.approval_events DROP CONSTRAINT IF EXISTS approval_events_chat_id_fkey`,
  `UPDATE bricksbot.approval_events SET payload = payload - 'arguments' WHERE payload->'arguments' IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS bricksbot.message_requests (
  request_id TEXT PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES bricksbot.chats(id) ON DELETE CASCADE,
  result_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.sandbox_sessions (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES bricksbot.chats(id) ON DELETE CASCADE,
  bot_id UUID NOT NULL REFERENCES bricksbot.bots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  backend TEXT NOT NULL CHECK (backend IN ('databricks', 'python_exec', 'e2b')),
  external_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'running', 'stopped', 'failed', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
)`,
  `ALTER TABLE bricksbot.sandbox_sessions DROP CONSTRAINT IF EXISTS sandbox_sessions_backend_check`,
  `ALTER TABLE bricksbot.sandbox_sessions ADD CONSTRAINT sandbox_sessions_backend_check CHECK (backend IN ('databricks', 'python_exec', 'e2b'))`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_sandbox_sessions_chat
  ON bricksbot.sandbox_sessions(chat_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_sandbox_sessions_user_status
  ON bricksbot.sandbox_sessions(user_id, status)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.sandbox_events (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES bricksbot.sandbox_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('create', 'command', 'upload', 'download', 'stop', 'delete', 'error')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_sandbox_events_session
  ON bricksbot.sandbox_events(session_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.volume_usage (
  user_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  bytes_used BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, bot_id)
)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.plugins (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('volume', 'npm', 'builtin')),
  source_path TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
  `CREATE INDEX IF NOT EXISTS idx_bricksbot_plugins_enabled
  ON bricksbot.plugins(enabled)`,
  `CREATE TABLE IF NOT EXISTS bricksbot.mcp_connectors (
  user_id TEXT NOT NULL,
  service TEXT NOT NULL,
  connected BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  name TEXT,
  description TEXT,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, service)
)`,
] as const;

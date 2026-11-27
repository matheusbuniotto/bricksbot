# Bot knowledge base (RAG on Vector Search)

Status: shipped behind config (off by default). Lands after the community launch.

## What it does

A bot owner adds files to the bot (bot details > Knowledge base). The bot gets an auto-run, read-only tool,
`search_knowledge`, that returns the most relevant excerpts with the file name, and the prompt tells it to search
before answering questions about internal docs and to cite the files. Nothing changes for installs that don't set
it up: no tool, no prompt text, no UI section.

Supported: `txt`, `md`, `csv`, `tsv`, `json` (decoded in the App, 10 MiB each) and `pdf`, `docx`, `pptx`
(parsed with `ai_parse_document` on the SQL warehouse, 25 MiB each). 50 files per bot.

## Data flow

1. **Upload** `POST /api/bots/:botId/knowledge?name=` (bot owner only). The App checks the extension and leading
   bytes, then writes the file with the owner's OBO token to `{root}/knowledge/bots/{bot}/`.
2. **Extract** text files in the App; documents with
   `ai_parse_document(content)` over `read_files(path, format => 'binaryFile')`, as the owner.
3. **Chunk** about 1,200 characters with 200 overlap, on paragraph, then sentence, then word boundaries.
4. **Insert** into the chunk table with parameter markers, as the owner (`DELETE` of the same `doc_id` first, so a
   retry never doubles rows).
5. **Sync** the TRIGGERED Delta Sync index: tried with the owner's token, then the App service principal. If both
   fail the file is still saved and shows "sync pending"; it becomes searchable on the next sync.
6. **Search** `search_knowledge` queries the index with the signed-in caller's OBO token, filtered to
   `bot_id = <active bot>`.

Steps 2 to 5 run in the background after the upload returns (still inside the request's auth context). The UI polls
while a file shows "indexing". A row still processing after 20 minutes (a restart cut it off) shows as failed.

Metadata lives in Lakebase `bricksbot.knowledge_docs` (memory store without Lakebase).

## Permissions

| Who | Needs |
|-----|-------|
| Bot owner (uploads) | WRITE VOLUME on the knowledge Volume; SELECT + MODIFY on the chunk table; CAN USE on the warehouse; ideally permission to sync the index |
| Anyone chatting with the bot | SELECT on the index (and USE CATALOG / USE SCHEMA) |
| App service principal (optional) | Permission to sync the index, as the fallback sync identity |

The App must request the `vector-search` user API scope (see `databricks.yml`).

**Limit:** Unity Catalog grants apply to the whole index, not to a bot's rows. The `bot_id` filter is applied by the
App, so anyone with SELECT on the index can query every bot's chunks directly. For a hard boundary between teams, run
one install (one table and index) per audience.

## Setup

```sql
CREATE VOLUME IF NOT EXISTS main.bricksbot.knowledge;
CREATE TABLE IF NOT EXISTS main.bricksbot.kb_chunks (
  chunk_id STRING NOT NULL,
  doc_id STRING NOT NULL,
  bot_id STRING NOT NULL,
  doc_name STRING,
  chunk_index INT,
  content STRING,
  created_at TIMESTAMP
) TBLPROPERTIES (delta.enableChangeDataFeed = true);
```

```bash
databricks vector-search-endpoints create-endpoint bricksbot-kb STANDARD
databricks vector-search-indexes create-index --json '{
  "name": "main.bricksbot.kb_chunks_index",
  "endpoint_name": "bricksbot-kb",
  "primary_key": "chunk_id",
  "index_type": "DELTA_SYNC",
  "delta_sync_index_spec": {
    "source_table": "main.bricksbot.kb_chunks",
    "pipeline_type": "TRIGGERED",
    "embedding_source_columns": [
      { "name": "content", "embedding_model_endpoint_name": "databricks-gte-large-en" }
    ]
  }
}'
```

Then set in `app.yaml`: `BRICKSBOT_KB_TABLE`, `BRICKSBOT_KB_INDEX`, and `BRICKSBOT_KB_VOLUME_ROOT` (or reuse
`BRICKSBOT_VOLUME_ROOT`), uncomment `vector-search` under `user_api_scopes`, grant as above, and redeploy.
`BRICKSBOT_KB_ENABLED=false` turns it off without removing the settings.

## Cost

A Vector Search endpoint is billed while it exists, even idle; the TRIGGERED pipeline and the embedding endpoint
are billed per sync and per token; `ai_parse_document` is billed per page. Text files skip the parse cost.

## Not in v1

Space-wide or per-user knowledge bases, re-sync status polling, hybrid search, reranking, and cleanup of chunk rows
when a bot is deleted (its Lakebase rows cascade; Delta rows stay until deleted by `doc_id`/`bot_id`).

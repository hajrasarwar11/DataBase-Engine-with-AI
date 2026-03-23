# UQL Studio

## Overview

A production-grade multi-model database engine IDE featuring a custom Unified Query Language (UQL). The app runs a real C++ database engine (TCP server on port 5544) with B+ Tree indexing, WAL-based persistence, ACID transactions, schema enforcement, and a query planner — all fronted by a VS Code-inspired React IDE.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/uql-studio)
- **API framework**: Express 5 (artifacts/api-server)
- **Database engine**: Custom C++ engine (artifacts/api-server/engine/) — binary built with `make`, runs on TCP port 5544, data stored in `.uql-data/`
- **API→Engine bridge**: TypeScript TCP client (`src/engine/client.ts`), UQL AST parser (`src/engine/parser.ts`), query executor (`src/engine/executor.ts`)
- **AI Copilot history**: `store.ts` (JSON file, only for conversation storage — not DB ops)
- **Validation**: Zod (`zod/v4`)
- **UI**: Tailwind CSS, shadcn/ui, Framer Motion
- **Query Editor**: react-simple-code-editor with UQL syntax highlighting

## C++ Engine Architecture

Located at `artifacts/api-server/engine/`:

- **`src/types.h`** — Page structs, WAL ops, record types, constants
- **`src/page_manager.h`** — 4KB slot-based binary page I/O
- **`src/wal.h`** — Binary Write-Ahead Log with txn filtering + replay
- **`src/btree.h`** — Generic B+ Tree (move-only, T=4 min degree)
- **`src/transaction.h`** — ACID undo log manager
- **`src/storage.h`** — Full multi-model storage engine (schema validation, B+ Tree index, WAL)
- **`src/main.cpp`** — TCP server on port 5544, newline-delimited JSON protocol
- **`engine/Makefile`** — `make` to build `build/uqlengine`
- **`include/json.hpp`** — nlohmann/json single-header

### Engine Commands (JSON protocol)
```
PING, CREATE_DB, DROP_DB, LIST_DBS
CREATE_COL, DROP_COL, LIST_COLS
INSERT, FIND, MODIFY, REMOVE, FIND_PATH
BEGIN, COMMIT, ROLLBACK
```

### Data Directory
`artifacts/api-server/.uql-data/db/<dbname>/`:
- `<col>.pages` — Slot-based binary page file
- `wal.log` — Binary WAL
- `meta.json` — Per-DB metadata (schema, next_id per collection)

Global: `.uql-data/meta.json`, `.uql-data/db-ids.json` (name↔numeric ID map for REST API)

## TypeScript API Layer

- **`src/index.ts`** — Builds C++ engine if missing, spawns subprocess, waits for port 5544, then starts Express
- **`src/engine/client.ts`** — Persistent TCP connection pool to port 5544
- **`src/engine/parser.ts`** — Full tokenizer + AST-based UQL parser
- **`src/engine/executor.ts`** — Executes AST → engine commands (query planner: B+ Tree for `id=`, full scan otherwise)
- **`src/engine/id-map.ts`** — Stable numeric ID ↔ DB name mapping
- **`src/routes/queries.ts`** — POST /api/query → parse + execute UQL
- **`src/routes/databases.ts`** — REST CRUD for databases/collections

## UQL Query Language

```uql
-- DDL
CREATE DB mydb
CREATE TABLE users IN mydb SCHEMA (name string required, age number)
CREATE GRAPH social IN mydb
CREATE DOCUMENT logs IN mydb
DROP TABLE users IN mydb
DROP DB mydb

-- DML
ADD users IN mydb VALUES {"name": "Alice", "age": 30}
FIND users IN mydb WHERE age > 25 LIMIT 50
FIND users IN mydb WHERE name = "Alice" AND age > 18
MODIFY users IN mydb SET age = 31 WHERE name = "Alice"
REMOVE users IN mydb WHERE name = "Bob"

-- Graph
FIND PATH FROM users(1) TO users(5) IN mydb

-- Transactions
BEGIN
ADD users IN mydb VALUES {"name": "Charlie"}
COMMIT

-- Comments
-- This is a comment
```

## Features

- **Multi-model storage**: TABLE (schema-enforced), GRAPH (BFS traversal), DOCUMENT (flexible JSON)
- **Query planner**: B+ Tree index lookup for `id=X` queries; full sequential scan otherwise
- **WAL persistence**: All writes logged to binary WAL; replayed on engine startup
- **ACID transactions**: BEGIN/COMMIT/ROLLBACK with undo log
- **Schema enforcement**: Required fields, type checking (string/number/boolean) for TABLE collections
- **Object Explorer**: Left sidebar tree with live DB/collection counts from engine
- **Results panel**: Grid view, Raw JSON, Execution info with query plan notes
- **Query history**: Bottom panel with past queries and timing
- **AI Copilot**: Claude/GitHub Models streaming assistant with schema-aware context
- **Light/dark theme**: Toggle via ☀️/🌙; semantic CSS variables throughout
- **Query editor toolbar**: Undo/Redo, Comment/Uncomment, Open/Save .uql, Copy, Format

## Key Notes

- The C++ engine binary is auto-built on first startup if missing
- Data persists across restarts (pages + WAL)
- The engine runs as a child process; if it exits, the API server exits too
- `store.ts` is kept ONLY for AI Copilot conversation history
- All database/collection/record operations go through the C++ engine

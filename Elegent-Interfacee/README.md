# UQL Studio

**A Final Year Project — VS Code-inspired multi-model database IDE built around a custom C++ storage engine and a unified query language (UQL) designed from scratch.**

> Pure monochromatic black/white/gray aesthetic. Runs entirely on your machine — no cloud database, no third-party storage.

---

## Table of Contents

1. [What Is This Project?](#1-what-is-this-project)
2. [How We Built It — Architecture](#2-how-we-built-it--architecture)
3. [Technology Stack](#3-technology-stack)
4. [Project Structure](#4-project-structure)
5. [Running on Windows](#5-running-on-windows)
6. [Full Installation Guide (Windows)](#6-full-installation-guide-windows)
7. [Starting the App](#7-starting-the-app)
8. [Every Button and Feature Explained](#8-every-button-and-feature-explained)
9. [UQL Language Reference](#9-uql-language-reference)
10. [AI Copilot Setup](#10-ai-copilot-setup-uql-copilot)
11. [Dependencies](#11-dependencies)
12. [Data Storage & Persistence](#12-data-storage--persistence)
13. [Known Limitations](#13-known-limitations)

---

## 1. What Is This Project?

**UQL Studio** is a browser-based database IDE — think of it as a personal DBeaver or DataGrip, but built entirely from scratch for a Final Year Project.

It implements:

- A **custom C++ storage engine** (our own database — not SQLite, not PostgreSQL)
- A **Unified Query Language (UQL)** — our own SQL-like language that works across three data models
- A **React + TypeScript IDE** — tabbed editor, syntax highlighting, results table, graph visualizer
- An **AI Copilot** — chat assistant that understands your schema and can write UQL queries for you

### Three Data Models in One IDE

| Model | Collection Type | What it stores |
|---|---|---|
| **TABLE** | Relational | Rows with typed columns, supports JOINs and aggregates |
| **DOCUMENT** | JSON/NoSQL | Flexible JSON-like records, any shape |
| **GRAPH** | Edge collection | Relationships between nodes; node data lives in a TABLE |

All three models share the same storage engine, the same query editor, and the same transaction system.

---

## 2. How We Built It — Architecture

The system has three layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend (Port 5000)                    │
│   Vite + React 18 + TanStack Query + Tailwind CSS + Framer     │
│   Query Editor | Schema Explorer | Results View | Graph View    │
│   AI Copilot | Reference Tab | Minimap | Multi-tab system       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP REST API
┌──────────────────────────▼──────────────────────────────────────┐
│                 Node.js API Server (Port 3000)                   │
│   Express.js + TypeScript                                        │
│   UQL Parser → Executor → Engine Client                         │
│   Auth (GitHub OAuth) | Anthropic/Ollama AI routes              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ TCP (JSON-over-socket, Port 5544)
┌──────────────────────────▼──────────────────────────────────────┐
│                  C++ Storage Engine (Port 5544)                  │
│   Custom B-Tree | Paged Storage (4KB pages) | WAL               │
│   ACID Transactions | Secondary Indexes | Graph BFS             │
│   Persists data to: artifacts/api-server/.uql-data/             │
└─────────────────────────────────────────────────────────────────┘
```

### The C++ Storage Engine (the heart of the project)

This is a real database engine we wrote in C++17 — not a wrapper around SQLite.

- **Paged Storage**: Data is stored in 4 KB pages on disk (like real databases). Each page has a magic number (`UQLF`), slot directory, and overflow chain for large records.
- **B-Tree Indexes**: Secondary indexes use a B-Tree for fast lookups on any field.
- **WAL (Write-Ahead Log)**: Before any write, the change is logged — if the process crashes, the engine replays the WAL on next startup (crash recovery).
- **ACID Transactions**: Full `BEGIN` / `COMMIT` / `ROLLBACK` support. Multiple operations can be grouped atomically.
- **Three Collection Types**: `TABLE` (typed rows), `DOCUMENT` (JSON blobs), `GRAPH` (edge list with `from`, `to`, `relation_type`).
- **Graph BFS**: `FIND PATH` triggers a Breadth-First Search across the edge collection.
- **TCP Interface**: The engine listens on port 5544. The API server speaks to it via JSON over raw TCP sockets.

### The UQL Parser (Node.js / TypeScript)

The API server contains a hand-written UQL parser that:
1. Strips comment lines
2. Splits multi-statement input by `;`
3. Parses each statement into an AST (Abstract Syntax Tree)
4. The executor walks the AST and sends JSON commands to the C++ engine
5. Results come back as JSON, then the API formats and returns them to the frontend

### The Frontend (React)

- **Multi-tab editor**: Each tab is an independent query session. The Reference tab is always first and is read-only.
- **Live syntax highlighting**: Custom tokenizer for UQL — keywords, strings, numbers, comments colored in real time.
- **TanStack Query**: All API calls are managed with `@tanstack/react-query` — automatic caching, background refresh, loading states.
- **Graph View**: When a `FIND PATH` query succeeds, the result automatically switches to a force-directed graph view using `@xyflow/react`.
- **AI Copilot**: Streams responses token by token using Server-Sent Events (SSE). Understands your live schema.

---

## 3. Technology Stack

### Frontend
| Library | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| Vite | 7 | Dev server and bundler |
| TypeScript | 5.9 | Type safety |
| Tailwind CSS | 4 | Utility-first styling |
| TanStack Query | latest | Server state management |
| Framer Motion | latest | Animations |
| @xyflow/react | 12 | Graph visualizer (force-directed) |
| Lucide React | latest | Icon set |
| Radix UI | latest | Accessible UI primitives |
| react-simple-code-editor | 0.14 | The query editor base |
| Wouter | 3 | Client-side routing |
| Recharts | 2 | Charts in results view |
| Zod | latest | Schema validation |
| IBM Plex Sans / IBM Plex Mono | Google Fonts | Typography |

### Backend (API Server)
| Library | Version | Purpose |
|---|---|---|
| Node.js | 18+ | Runtime |
| Express.js | 4 | HTTP server |
| TypeScript + tsx | latest | TS execution without build step |
| express-session | latest | Session management for auth |
| cookie-parser | latest | Cookie handling |
| cors | 2 | Cross-origin requests |
| openai SDK | 6 | Used for GitHub Models API |
| cross-env | 10 | Cross-platform env vars |

### Storage Engine
| Technology | Purpose |
|---|---|
| C++17 | Engine language |
| nlohmann/json (json.hpp) | JSON parsing inside the engine |
| POSIX sockets / Winsock2 | TCP communication |
| pthreads / std::thread | Concurrent client handling |
| Make + g++ | Build system |

### Monorepo
| Tool | Purpose |
|---|---|
| pnpm | Package manager with workspaces |
| pnpm workspaces | Shared packages between api-server and uql-studio |

---

## 4. Project Structure

```
Elegent-Interfacee/
├── start.mjs                    ← Main startup script (run this)
├── start.bat                    ← Windows double-click launcher
├── package.json                 ← Root workspace config
├── pnpm-workspace.yaml          ← Declares workspace packages
│
├── artifacts/
│   ├── api-server/              ← Node.js + Express API (Port 3000)
│   │   ├── src/
│   │   │   ├── index.ts         ← Server entry: starts engine + Express
│   │   │   ├── app.ts           ← Express app setup
│   │   │   ├── engine/
│   │   │   │   ├── client.ts    ← TCP client to talk to C++ engine
│   │   │   │   ├── parser.ts    ← UQL parser (tokenizer + AST)
│   │   │   │   ├── executor.ts  ← AST → engine commands
│   │   │   │   └── id-map.ts    ← DB name ↔ numeric ID mapping
│   │   │   └── routes/
│   │   │       ├── queries.ts   ← POST /api/queries/execute
│   │   │       ├── databases.ts ← CRUD for databases/collections
│   │   │       ├── auth.ts      ← GitHub OAuth + session
│   │   │       ├── anthropic/   ← Conversation + streaming AI
│   │   │       └── health.ts    ← GET /api/health
│   │   └── engine/              ← C++ storage engine source
│   │       ├── Makefile         ← Build script (auto-runs on first start)
│   │       ├── include/
│   │       │   └── json.hpp     ← nlohmann/json single header
│   │       └── src/
│   │           ├── main.cpp     ← TCP server + command dispatcher
│   │           ├── storage.h    ← StorageEngine class (all operations)
│   │           ├── btree.h      ← B-Tree index implementation
│   │           ├── wal.h        ← Write-ahead log
│   │           ├── page_manager.h ← 4KB page read/write
│   │           ├── transaction.h  ← BEGIN/COMMIT/ROLLBACK logic
│   │           └── types.h      ← PageHeader, SlotEntry, Record structs
│   │
│   └── uql-studio/              ← React frontend (Port 5000)
│       ├── src/
│       │   ├── pages/
│       │   │   └── studio.tsx   ← Main IDE layout (all panels wired)
│       │   ├── hooks/
│       │   │   └── use-ide-state.ts ← Tab state, execution state
│       │   ├── components/
│       │   │   └── panels/
│       │   │       ├── query-editor.tsx   ← Code editor + toolbar
│       │   │       ├── schema-explorer.tsx ← Left sidebar (databases)
│       │   │       ├── results-view.tsx   ← Table / JSON / chart output
│       │   │       ├── graph-view.tsx     ← Graph path visualizer
│       │   │       └── ai-assistant.tsx   ← UQL Copilot panel
│       │   └── index.css        ← Global styles + color variables
│       └── vite.config.ts       ← Vite configuration
│
└── lib/                         ← Shared TypeScript packages
    ├── api-zod/                 ← Zod schemas shared by API + client
    ├── api-client-react/        ← Auto-generated React Query hooks
    └── integrations-anthropic-ai/ ← Anthropic streaming wrapper
```

---

## 5. Running on Windows

**Yes — the project is fully Windows-compatible.** Every part has Windows support built in:

| Component | Windows Support |
|---|---|
| C++ engine | Uses Winsock2 (not POSIX sockets). Compiles with `g++` on Windows. |
| Makefile | Has `ifeq ($(OS),Windows_NT)` branch — makes `uqlengine.exe`, links `ws2_32.lib`. |
| start.mjs | Detects Windows, uses `shell: true` so all commands run through `cmd.exe`. |
| start.bat | Double-click shortcut — just runs `node start.mjs`. |
| Node.js / pnpm | Native Windows support. |

---

## 6. Full Installation Guide (Windows)

### Step 1 — Install Node.js

Download from: **https://nodejs.org** (choose LTS version, currently v22)

During installation, check the box that says **"Automatically install necessary tools"** — this also installs build tools.

Verify:
```cmd
node --version
npm --version
```

### Step 2 — Install pnpm

Open Command Prompt or PowerShell and run:
```cmd
npm install -g pnpm
```

Verify:
```cmd
pnpm --version
```

### Step 3 — Install g++ (C++ compiler)

The C++ engine needs to be compiled. You need **g++** on your PATH.

**Recommended — MSYS2 (easiest):**

1. Download from: **https://www.msys2.org**
2. Install it (default path: `C:\msys64`)
3. Open **MSYS2 UCRT64** terminal and run:
   ```bash
   pacman -S mingw-w64-ucrt-x86_64-gcc make
   ```
4. Add `C:\msys64\ucrt64\bin` to your Windows **PATH**:
   - Search "Environment Variables" in Start Menu
   - Edit `Path` under System variables
   - Add `C:\msys64\ucrt64\bin`

Verify (in regular Command Prompt):
```cmd
g++ --version
make --version
```

**Alternative — Git for Windows:**
If you have Git for Windows installed, you may already have `g++` available via Git Bash. Open Git Bash to check: `g++ --version`.

### Step 4 — Clone the Repository

```cmd
git clone https://github.com/hajrasarwar11/DataBase-Engine-with-AI.git
cd DataBase-Engine-with-AI\Elegent-Interfacee
```

### Step 5 — Install Node.js Dependencies

```cmd
pnpm install
```

This installs all packages for the monorepo (API server + frontend) in one command. Takes 1-3 minutes.

### Step 6 — Start the App

```cmd
node start.mjs
```

Or just double-click **`start.bat`**.

**What happens on first start:**

1. `start.mjs` checks if `engine/build/uqlengine.exe` exists
2. If not, it runs `make -C engine` which compiles the C++ engine using `g++`
3. The compiled engine binary is saved and reused on future starts
4. The API server starts on **port 3000**
5. The Vite dev server starts on **port 5000**
6. Open your browser at: **http://localhost:5000**

You will see in the terminal:
```
┌────────────────────────────────────────┐
│          UQL Studio — Dev Server       │
│                                        │
│  Frontend : http://localhost:5000      │
│  API      : http://localhost:3000      │
└────────────────────────────────────────┘
```

---

## 7. Starting the App

Every time you want to use UQL Studio:

```cmd
cd DataBase-Engine-with-AI\Elegent-Interfacee
node start.mjs
```

Or double-click `start.bat`.

To stop: press `Ctrl + C` in the terminal.

---

## 8. Every Button and Feature Explained

### Top Toolbar

| Button / Element | Keyboard Shortcut | What it does |
|---|---|---|
| **Execute** (white button) | `Ctrl + Enter` | Runs the query in the current tab. If you have text selected, only that selection is executed. Results appear in the Results panel below. |
| **+** (new tab) | | Opens a new empty query tab. Each tab has its own query history. |
| **Open file** (folder icon) | `Ctrl + O` | Opens a file picker. Choose any `.uql`, `.sql`, or `.txt` file — its contents are loaded into the current tab. |
| **Save** (floppy disk icon) | `Ctrl + S` | Opens the "Save Query File" dialog. Type a filename and click Save — the file downloads to your browser's download folder. |
| **Undo** | `Ctrl + Z` | Undoes the last edit in the editor. |
| **Redo** | `Ctrl + Y` or `Ctrl + Shift + Z` | Redoes the last undone edit. |
| **Comment/Uncomment** | `Ctrl + /` | Toggles `--` comment on the current line or selected lines. |
| **Format** | | Formats and re-indents your UQL query. |
| **Copy** | | Copies the entire current query to clipboard. |
| **Database selector** (dropdown) | | Shows all your databases. Select one to make it the active database — queries without `IN <db>` will use this one automatically. |
| **Minimap** (grid icon) | `Ctrl + Shift + M` | Toggles a minimap panel on the right side of the editor showing a zoomed-out view of your code. |
| **Shortcuts** (keyboard icon) | `Ctrl + K` | Opens the keyboard shortcuts reference overlay. |

### Left Panel — Object Explorer / Schema Explorer

This is the database browser on the left side.

| Element | What it does |
|---|---|
| **DATABASES** header | Shows the total count of databases. |
| **Refresh** (↺ icon) | Re-fetches the database list from the engine. |
| **+ (Create Database)** | Opens a dialog. Type a name and click Create. The engine creates a new database immediately. |
| **Database row** (▶ MyProject) | Click the arrow to expand and see collections inside. Right-click or use the `...` menu for options. |
| **Collection row** | Click to insert a `FIND FROM collectionName IN dbName` query into the editor. |
| **Collection type badge** | Shows `TABLE`, `DOC`, or `GRAPH` next to each collection name. |
| **+ inside a database** | Opens the Create Collection dialog. Choose the type (Table / Document / Graph) and name. |
| **Delete collection** | Drops the collection — all data is gone. |

### Editor Area

The main code editor in the center.

| Feature | What it does |
|---|---|
| **Syntax highlighting** | Keywords (`CREATE`, `INSERT`, `FIND`, `WHERE`, etc.) are highlighted. Strings in amber, numbers in blue, comments in dark gray. |
| **Line numbers** | Shown on the left gutter. Error lines turn red. |
| **Error line highlight** | If your query fails, the line where the error occurred is highlighted in the gutter. |
| **Error banner** | A red bar appears above the results when a query fails, showing the error message. |
| **Multi-statement** | You can write multiple queries separated by `;`. All are executed in sequence. |

### Tabs

| Feature | What it does |
|---|---|
| **Reference tab** | Always the first tab, always read-only. Contains the full UQL reference guide with examples for every command. Cannot be closed. Resets to the guide on every page reload. |
| **Query tabs** | All other tabs are editable. Each has its own query text and execution history. |
| **Tab close** (×) | Click to close a tab. The Reference tab cannot be closed. |
| **+ New tab** | Opens a fresh empty tab. |
| **Tab rename** | Double-click a tab title to rename it. |

### Results Panel (Bottom)

Appears after executing a query.

| Element | What it does |
|---|---|
| **Table view** | Default view. Shows results as a spreadsheet grid. Column headers match your field names. |
| **JSON view** | Switch to raw JSON — useful for DOCUMENT collections where records have varying shapes. |
| **Chart view** | If the result has numeric data, renders a bar chart automatically. |
| **Row count** | Shows how many rows were returned (e.g., "12 rows"). |
| **Execution time** | Shows how long the query took in milliseconds. |
| **Success / error indicator** | Green check for success, red X for failure. |
| **Resize handle** | Drag the horizontal divider between the editor and results to make either taller/shorter. |

### Graph View

Appears automatically when a `FIND PATH` query succeeds.

| Element | What it does |
|---|---|
| **Nodes** | Each node is a record from your TABLE collection (people, cities, etc.). |
| **Edges** | Lines connecting nodes — drawn from your GRAPH collection (`from`, `to`, `relation_type`). |
| **Labels** | The node label shows the record's `name` field (or its `id` if no name). Edge labels show `relation_type`. |
| **Drag** | Drag nodes to reposition them. |
| **Zoom / Pan** | Scroll to zoom. Click and drag the background to pan. |
| **Fit view** | Button in the corner resets the zoom to show all nodes. |

### Right Panel — UQL Copilot

The AI chat assistant.

| Element | What it does |
|---|---|
| **Chat input** | Type your question or request. Press Enter to send, Shift+Enter for a new line. |
| **Send button** | Sends the message. |
| **Mic button** | Voice input using your browser's speech recognition. Click to start, click again to stop. Says what you spoke into the text box. |
| **Attach file** (paperclip) | Attach images, PDFs, or text files to your message. The AI can read and understand them. Max 10 MB per file. |
| **New Chat** (+ button) | Starts a fresh conversation, clearing the current messages. |
| **Sessions** (list icon) | Opens a panel showing all your past conversations. Click one to reload it. |
| **Model selector** | If Ollama is running, shows a dropdown to pick which local model to use (e.g., phi3:mini, phi4). |
| **Insert query** (▶ button on AI response) | When the AI writes a UQL code block, this button copies that query into your editor. |
| **Run query** (execute button on AI response) | Runs the AI's suggested query directly against your active database. Shows the result under the message. |
| **Copy** button | Copies an AI message to clipboard. |
| **GitHub sign-in** | Logs in with GitHub to access free GitHub Models AI (Claude, Llama, etc.). |

### Resize Handles

| Divider | What it does |
|---|---|
| Left panel edge | Drag to make the Schema Explorer wider or narrower. |
| Right panel edge | Drag to make the Copilot panel wider or narrower. |
| Bottom panel edge | Drag to make the Results panel taller or shorter. |

---

## 9. UQL Language Reference

UQL (Unified Query Language) looks like SQL but works across all three data models.

### Databases

```sql
-- Create a database
CREATE DB university

-- Show all databases and their stats
SHOW STATS

-- Show stats for one database
SHOW STATS IN university

-- Delete a database (irreversible!)
DROP DB university
```

### Collections (Tables / Documents / Graphs)

```sql
-- Create a table (relational, typed columns)
CREATE TABLE students IN university
  SCHEMA (id NUMBER, name STRING, gpa NUMBER, major STRING)

-- Create a document collection (flexible JSON, no fixed schema)
CREATE DOCUMENT logs IN university

-- Create a graph collection (stores edges: from, to, relation_type)
CREATE GRAPH friendships IN university

-- Show all collections in a database
SHOW COLLECTIONS IN university

-- Drop a collection
DROP COLLECTION students IN university
```

### Inserting Records

```sql
-- Insert into a TABLE
INSERT INTO students IN university
  VALUES (id: 1, name: "Alice", gpa: 3.9, major: "CS")

-- Insert into a DOCUMENT
INSERT INTO logs IN university
  VALUES (event: "login", user: "alice", ip: "192.168.1.1", timestamp: "2025-01-15")

-- Insert an edge into a GRAPH (from and to reference record IDs)
INSERT INTO friendships IN university
  VALUES (from: 1, to: 2, relation_type: "friends_with")
```

### Querying (FIND)

```sql
-- Get all records
FIND FROM students IN university

-- With a WHERE condition
FIND FROM students IN university WHERE gpa > 3.5

-- Select specific fields
FIND FROM students IN university SELECT name, gpa

-- With limit
FIND FROM students IN university LIMIT 10

-- Order results
FIND FROM students IN university ORDER BY gpa DESC

-- Multiple conditions
FIND FROM students IN university
  WHERE major = "CS" AND gpa >= 3.0
```

### WHERE Operators

| Operator | Meaning | Example |
|---|---|---|
| `=` | Equals | `WHERE name = "Alice"` |
| `!=` | Not equals | `WHERE status != "inactive"` |
| `>` `<` | Greater / Less | `WHERE gpa > 3.5` |
| `>=` `<=` | Greater or equal / Less or equal | `WHERE age <= 25` |
| `AND` | Both conditions must be true | `WHERE a = 1 AND b = 2` |
| `OR` | Either condition is true | `WHERE city = "NY" OR city = "LA"` |
| `LIKE` | Pattern match (`%` = any chars) | `WHERE name LIKE "Al%"` |
| `IN (...)` | Value is in a list | `WHERE major IN ("CS", "Math")` |
| `IS NULL` | Field is missing | `WHERE email IS NULL` |
| `IS NOT NULL` | Field exists | `WHERE phone IS NOT NULL` |

### Aggregation & Grouping

```sql
-- Count all students
FIND FROM students IN university AGGREGATE COUNT(*)

-- Average GPA
FIND FROM students IN university AGGREGATE AVG(gpa)

-- Count students per major
FIND FROM students IN university GROUP BY major AGGREGATE COUNT(*)

-- Sum, Min, Max
FIND FROM students IN university GROUP BY major AGGREGATE SUM(gpa)
FIND FROM students IN university AGGREGATE MIN(gpa)
FIND FROM students IN university AGGREGATE MAX(gpa)
```

### Updating Records

```sql
-- Update by ID
UPDATE students IN university WHERE id = 1
  SET gpa = 4.0, major = "Mathematics"

-- Update multiple records
UPDATE students IN university WHERE major = "CS"
  SET department = "Computer Science"
```

### Deleting Records

```sql
-- Delete specific record
DELETE FROM students IN university WHERE id = 1

-- Delete multiple records
DELETE FROM students IN university WHERE gpa < 2.0
```

### JOINs (TABLE only)

```sql
-- Join two tables
JOIN students, enrollments IN university ON students.id = enrollments.student_id

-- Join with filter
JOIN students, courses IN university
  ON students.id = courses.student_id
  WHERE students.gpa > 3.0
```

### Indexes (for faster queries)

```sql
-- Create a secondary index on a field
CREATE INDEX ON students(gpa) IN university

-- List indexes on a collection
SHOW INDEXES ON students IN university

-- Drop an index
DROP INDEX ON students(gpa) IN university
```

### EXPLAIN (query plan)

```sql
-- See how the engine will execute a query
EXPLAIN FIND FROM students IN university WHERE gpa > 3.5
```

Shows whether the engine will use an index scan or a full table scan.

### Graph Queries

```sql
-- Find a path between two nodes (triggers Graph View)
-- Syntax: FIND PATH FROM nodeCollection(id) TO nodeCollection(id)
-- The GRAPH collection is specified in the active database
FIND PATH FROM students(1) TO students(4) IN university

-- This runs Breadth-First Search through the friendships edge collection
-- and visualizes all nodes and edges on the Graph View tab
```

### Transactions

```sql
-- Start a transaction
BEGIN

-- All operations here are grouped atomically
INSERT INTO accounts IN bank VALUES (id: 1, balance: 1000)
UPDATE accounts IN bank WHERE id = 1 SET balance = 900
INSERT INTO accounts IN bank VALUES (id: 2, balance: 100)

-- Commit: save all changes
COMMIT

-- Or rollback: undo all changes since BEGIN
ROLLBACK
```

---

## 10. AI Copilot Setup (UQL Copilot)

The Copilot panel is on the right side. Choose one of three options:

### Option A — Local Ollama (Free, Offline, Recommended)

Runs entirely on your machine. No internet needed once the model is downloaded.

1. Download Ollama from: **https://ollama.com/download** — choose Windows installer
2. Install it (adds `ollama` to your PATH)
3. Open Command Prompt and pull a model:
   ```cmd
   ollama pull phi3:mini
   ```
   (phi3:mini is ~2 GB — fast and smart enough for query writing)
   
   Or for a more powerful model (needs a better GPU/RAM):
   ```cmd
   ollama pull phi4
   ```
4. Restart UQL Studio (stop and run `node start.mjs` again)
5. The Copilot panel will show your model name and a green indicator

### Option B — GitHub Models (Free with GitHub account)

Works with GitHub Pro or GitHub Education accounts.

1. Click **"Continue with GitHub"** in the Copilot panel
2. Authorize the app
3. You can now chat — the AI runs on GitHub's servers using GitHub Models API

### Option C — Anthropic Claude (Paid)

1. Get an API key from: **https://console.anthropic.com**
2. Create a file: `artifacts/api-server/.env`
3. Add this line:
   ```
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```
4. Restart UQL Studio

### What the Copilot Knows

- Your active database name
- All your collection names, types, field schemas, and record counts
- Your last executed query and its result
- Full UQL syntax

Ask it things like:
- *"Write a query to find all students with GPA above 3.5"*
- *"How do I create a graph collection and insert edges?"*
- *"My query failed with an error — can you fix it?"*
- *"Explain what this query does"*

---

## 11. Dependencies

### What You Install Manually

| Tool | Where to Get | Required For |
|---|---|---|
| Node.js v18+ | https://nodejs.org | Running the API server and frontend |
| pnpm | `npm i -g pnpm` | Installing packages |
| g++ (C++ compiler) | MSYS2 → https://www.msys2.org | Compiling the C++ storage engine |
| make | MSYS2 (same install) | Running the Makefile to build engine |
| Ollama (optional) | https://ollama.com | Local AI in the Copilot |

### What pnpm Installs Automatically

Run `pnpm install` once and everything below is installed:

**Frontend (uql-studio):**
- react, react-dom — UI framework
- vite — dev server and bundler
- tailwindcss — styling
- @tanstack/react-query — data fetching
- framer-motion — animations
- @xyflow/react — graph visualizer
- lucide-react — icons
- @radix-ui/* — accessible UI components (dialogs, dropdowns, etc.)
- react-simple-code-editor — editor base
- recharts — charts
- zod — data validation
- wouter — routing
- class-variance-authority, clsx, tailwind-merge — utility styling helpers
- date-fns — date formatting

**Backend (api-server):**
- express — HTTP server
- express-session, cookie-parser — auth sessions
- cors — cross-origin requests
- openai — GitHub Models API
- tsx — run TypeScript without a build step
- cross-env — cross-platform environment variables

**C++ Engine (compiled, not an npm package):**
- nlohmann/json (json.hpp) — included in the repo, no download needed

---

## 12. Data Storage & Persistence

All your databases, collections, and records are stored on disk at:

```
artifacts/api-server/.uql-data/
├── store.json          ← Engine metadata (DB list, collection schemas)
└── data/
    ├── university/
    │   ├── students.uqlf      ← Binary page file for the students collection
    │   ├── students.wal       ← Write-Ahead Log for crash recovery
    │   └── friendships.uqlf
    └── ...
```

The `.uqlf` files are binary files using the engine's custom 4 KB page format — not readable as text. Data persists across restarts automatically. No `SAVE` command needed.

---

## 13. Known Limitations

| Limitation | Details |
|---|---|
| Single-user | The engine handles concurrent TCP connections but is designed for one user. No access control or multi-user isolation. |
| No browser save dialog | The "Save" button downloads the query file to your browser's default download folder. To choose a specific location every time, set your browser to "Ask where to save each file" in its settings. |
| Graph `FIND PATH` needs a GRAPH collection | The BFS path finder looks for an edge collection in the active database. At least one `CREATE GRAPH` collection with `from`, `to`, `relation_type` fields must exist. |
| Voice input | Requires Chrome or Edge. Firefox does not support the Web Speech API. |
| Attachment previews | Image previews work in the chat. PDF content is sent as text to the AI. |
| MSYS2 PATH | If `g++` is not on your PATH, the engine will not compile. Ensure `C:\msys64\\ucrt64\bin` is in your system PATH before running. |

---

## Built With

This project was built as a Final Year Project. Every layer — the storage engine, the query language, the parser, the IDE — was designed and implemented from scratch by the team, not assembled from existing database libraries.

GitHub Repository: **https://github.com/hajrasarwar11/DataBase-Engine-with-AI**

# UQL Studio

## Overview

A production-grade multi-model database engine IDE featuring a custom Unified Query Language (UQL). The app runs a real C++ database engine (TCP server on port 5544) with B+ Tree indexing, WAL-based persistence, ACID transactions, schema enforcement, and a query planner — all fronted by a VS Code-inspired React IDE.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 20 (Replit environment)
- **Package manager**: pnpm 10
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/uql-studio) — port 5000
- **API framework**: Express 5 (artifacts/api-server) — port 3000
- **Database engine**: Custom C++ engine (artifacts/api-server/engine/) — binary at `build/uqlengine`, runs on TCP port 5544, data stored in `.uql-data/`

## Project Layout

```
Elegent-Interfacee/
├── artifacts/
│   ├── api-server/         # Express API + C++ engine
│   │   ├── engine/         # C++ source + Makefile → build/uqlengine
│   │   └── src/            # TypeScript API layer (index.ts, app.ts, routes/)
│   ├── uql-studio/         # React + Vite frontend
│   └── mockup-sandbox/     # UI sandbox
├── lib/                    # Shared libraries (api-zod, db, integrations, etc.)
├── start.mjs               # Cross-platform startup script (spawns api + web)
├── package.json            # Root workspace config
└── pnpm-workspace.yaml     # pnpm workspace + catalog
```

## Running the App

The single workflow `Start application` runs:
```
cd Elegent-Interfacee && node start.mjs
```

This spawns both:
- API server on port 3000 (`pnpm --filter @workspace/api-server run dev`)
- Frontend Vite dev server on port 5000 (`pnpm --filter @workspace/uql-studio run dev`)

The API server auto-builds the C++ engine if the binary is missing, then spawns it on port 5544.

## First-Time Setup Notes

- The C++ engine was built with `make` in `artifacts/api-server/engine/`
- pnpm dependencies installed with `pnpm install` in `Elegent-Interfacee/`
- esbuild was rebuilt (`pnpm rebuild esbuild`) to fix execute permissions on Linux

## Vite Configuration

- Host: `0.0.0.0`, port: `5000`
- `allowedHosts: true` (proxy-safe for Replit iframe)
- Proxies `/api` requests to `http://localhost:3000`

## UI Design System

Monochromatic "QueryForge" theme — black/white/gray only, VS Code-inspired:
- **Fonts**: IBM Plex Sans (UI) + IBM Plex Mono (code, labels, badges)
- **Palette**: background `#030303`, panels `#0a0a0a`, editor `#050505`, borders `#1e1e1e/#2a2a2a`, text `#888`/`#c8c8c8`
- **Rules**: `borderRadius: 3`, no gradients, no colored shadows, no `text-cyan-*`/`text-purple-*`/`text-emerald-*` classes
- **Execute button**: `background: #f0f0f0`, `color: #0a0a0a` (white on dark)
- **Active tab**: `border-t-2 border-t-white`, `bg-[#060606]`
- **Inline styles** used throughout for precise control (not Tailwind color classes)
- Files: `index.css`, `studio.tsx`, `query-editor.tsx`, `results-view.tsx`, `schema-explorer.tsx`, `ai-assistant.tsx`, `query-history.tsx`

## AI Copilot

Configured for three-tier AI: local Ollama/Phi (offline, no login) → GitHub Models (free via Education) → Anthropic (paid).
- Model selector in AI panel for Ollama (phi4, phi3:mini, llama3.2, etc.)
- Phi download guide with Win/Mac/Linux tabs shown when Ollama offline
- Query result awareness: last result rows injected into AI context
- Rich schema context: all databases/tables/graphs/documents sent to AI
- API route: `artifacts/api-server/src/routes/anthropic/index.ts`

## Deployment

Configured as a **VM** deployment (required for the C++ subprocess and persistent local file storage).
Run command: `bash -c "cd Elegent-Interfacee && node start.mjs"`

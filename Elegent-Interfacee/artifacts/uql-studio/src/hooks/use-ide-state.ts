import { useState, useEffect, useCallback, useRef } from 'react';
import type { Theme } from '@/lib/utils';

// ── Tab types ─────────────────────────────────────────────────────────────────
export type ResultsTab = 'results' | 'json' | 'info' | 'graph';

export interface EditorTab {
  id: string;
  title: string;
  query: string;
  result: any | null;
  activeResultTab: ResultsTab;
}

// ── Timing entry for sparkline ─────────────────────────────────────────────────
export interface TimingEntry {
  ms: number;
  success: boolean;
  ts: number;
}

// ── Saved snippet ──────────────────────────────────────────────────────────────
export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  createdAt: string;
}

// ── Default reference query ────────────────────────────────────────────────────
const DEFAULT_QUERY = `-- ═══════════════════════════════════════════════════════════════════
--   UQL STUDIO  ─  Complete Reference  (read-only, refreshes on reload)
-- ═══════════════════════════════════════════════════════════════════
--   HOW TO RUN: open a new query tab (+), paste or type a command,
--   then press  Ctrl+Enter  (or click Execute).
--   Tip: select IN <db> or pick a database from the toolbar to skip it.
-- ───────────────────────────────────────────────────────────────────




-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  SECTION 1 — DATABASE                                            ║
-- ╚═══════════════════════════════════════════════════════════════════╝

CREATE DB MyProject          -- create a database (no IN needed)
SHOW STATS                   -- see all databases + collection types + record counts
SHOW STATS IN MyProject      -- filtered to one database




-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  SECTION 2 — TABLE  (relational rows, like SQL)                  ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
--  A TABLE stores structured rows with any fields you choose.
--  Run SHOW STATS to confirm collection type = "table".
-- ───────────────────────────────────────────────────────────────────

-- ── 2a. Create ───────────────────────────────────────────────────────
CREATE TABLE users    IN MyProject
CREATE TABLE orders   IN MyProject
CREATE TABLE products IN MyProject

-- ── 2b. Insert rows ──────────────────────────────────────────────────
ADD users VALUES { name: "Alice",   age: 28, role: "admin",  city: "London"  }   IN MyProject
ADD users VALUES { name: "Bob",     age: 22, role: "user",   city: "Paris"   }   IN MyProject
ADD users VALUES { name: "Charlie", age: 35, role: "user",   city: "Berlin"  }   IN MyProject
ADD users VALUES { name: "Diana",   age: 29, role: "admin",  city: "London"  }   IN MyProject

ADD products VALUES { name: "Laptop",  price: 999,  category: "electronics" }    IN MyProject
ADD products VALUES { name: "Phone",   price: 599,  category: "electronics" }    IN MyProject
ADD products VALUES { name: "Desk",    price: 249,  category: "furniture"   }    IN MyProject

ADD orders VALUES { user_id: 1, product_id: 1, qty: 2, status: "shipped",   amount: 1998 } IN MyProject
ADD orders VALUES { user_id: 2, product_id: 2, qty: 1, status: "pending",   amount: 599  } IN MyProject
ADD orders VALUES { user_id: 1, product_id: 3, qty: 1, status: "delivered", amount: 249  } IN MyProject

-- ── 2c. Query ─────────────────────────────────────────────────────────
FIND users IN MyProject                                     -- all rows
FIND users WHERE role = "admin"             IN MyProject    -- filter
FIND users WHERE age >= 25 AND city = "London" IN MyProject -- multiple filters
FIND users WHERE age > 20 LIMIT 5          IN MyProject    -- with limit
FIND users ORDER BY age ASC                IN MyProject    -- sort ascending
FIND users ORDER BY age DESC LIMIT 3       IN MyProject    -- sort + limit
FIND users WHERE id = 1                    IN MyProject    -- primary key lookup (fastest)

-- ── 2d. JOIN two tables ───────────────────────────────────────────────
FIND users JOIN orders ON id = orders.user_id              IN MyProject

-- ── 2e. Aggregates ────────────────────────────────────────────────────
FIND users AGGREGATE COUNT(*)              IN MyProject
FIND users AGGREGATE AVG(age)             IN MyProject
FIND orders AGGREGATE SUM(amount)         IN MyProject
FIND users  GROUP BY role   AGGREGATE COUNT(*)    IN MyProject
FIND orders GROUP BY status AGGREGATE SUM(amount) IN MyProject

-- ── 2f. Update rows ───────────────────────────────────────────────────
MODIFY users SET role = "owner"           WHERE name = "Alice"   IN MyProject
MODIFY users SET city = "Madrid", age = 30 WHERE name = "Bob"   IN MyProject

-- ── 2g. Delete rows ───────────────────────────────────────────────────
REMOVE users WHERE role = "guest"         IN MyProject
REMOVE orders WHERE status = "cancelled"  IN MyProject

-- ── 2h. Indexes (B+ Tree) ─────────────────────────────────────────────
CREATE INDEX ON users(role)               IN MyProject   -- speeds up WHERE role = ...
CREATE INDEX ON users(age)                IN MyProject   -- speeds up ORDER BY / range
SHOW INDEXES FOR users                    IN MyProject
DROP INDEX ON users(age)                  IN MyProject

-- ── 2i. Execution plan ────────────────────────────────────────────────
EXPLAIN FIND users WHERE role = "admin"   IN MyProject
EXPLAIN FIND users ORDER BY age ASC       IN MyProject

-- ── 2j. Drop ──────────────────────────────────────────────────────────
DROP TABLE users    IN MyProject
DROP TABLE orders   IN MyProject
DROP TABLE products IN MyProject




-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  SECTION 3 — GRAPH  (nodes + edges, BFS path finding)           ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
--  HOW GRAPHS WORK IN UQL:
--    • Node collections  →  regular TABLE collections holding node data
--    • Edge collection   →  a GRAPH collection holding connections
--
--  Each EDGE record must contain:
--      from          : ID of the source node
--      to            : ID of the destination node
--      relation_type : label for the relationship (e.g. "FRIEND")
--      (+ any extra metadata fields you want)
--
--  After adding edges, run:
--      FIND PATH FROM <nodeCol>(<id>) TO <nodeCol>(<id>)
--  The Graph View tab will open automatically with a visual diagram.
--
--  Run SHOW STATS to confirm collection type = "graph" for edge tables.
-- ───────────────────────────────────────────────────────────────────

-- ── 3a. Create: node tables + edge (graph) collection ────────────────
CREATE TABLE  people   IN MyProject    -- node collection
CREATE TABLE  pages    IN MyProject    -- another node collection
CREATE GRAPH  follows  IN MyProject    -- edge collection (type = "graph")

-- ── 3b. Add nodes (to TABLE collections) ─────────────────────────────
ADD people VALUES { name: "Alice",   job: "engineer" }     IN MyProject   -- id=1
ADD people VALUES { name: "Bob",     job: "designer" }     IN MyProject   -- id=2
ADD people VALUES { name: "Charlie", job: "manager"  }     IN MyProject   -- id=3
ADD people VALUES { name: "Diana",   job: "engineer" }     IN MyProject   -- id=4
ADD people VALUES { name: "Eve",     job: "analyst"  }     IN MyProject   -- id=5

ADD pages VALUES { title: "Home",    url: "/home"    }     IN MyProject   -- id=1
ADD pages VALUES { title: "About",   url: "/about"   }     IN MyProject   -- id=2
ADD pages VALUES { title: "Contact", url: "/contact" }     IN MyProject   -- id=3

-- ── 3c. Add edges (to GRAPH collection) ──────────────────────────────
--  from  = source node id   (from the people table above)
--  to    = target node id
--  relation_type = edge label shown in the visual graph
ADD follows VALUES { from: 1, to: 2, relation_type: "FOLLOWS",  since: "2023-01" }  IN MyProject
ADD follows VALUES { from: 1, to: 3, relation_type: "FOLLOWS",  since: "2023-03" }  IN MyProject
ADD follows VALUES { from: 2, to: 3, relation_type: "FOLLOWS",  since: "2023-06" }  IN MyProject
ADD follows VALUES { from: 3, to: 4, relation_type: "MENTORS",  since: "2022-11" }  IN MyProject
ADD follows VALUES { from: 4, to: 5, relation_type: "WORKS_WITH", team: "data"  }   IN MyProject
ADD follows VALUES { from: 5, to: 1, relation_type: "FOLLOWS",  since: "2024-01" }  IN MyProject

-- ── 3d. See all edges (plain table view) ─────────────────────────────
FIND follows IN MyProject                                -- shows all edges
FIND follows WHERE relation_type = "FOLLOWS" IN MyProject  -- filter by type
FIND follows WHERE from = 1 IN MyProject               -- all edges from node 1

-- ── 3e. Confirm it is a graph collection ─────────────────────────────
SHOW STATS IN MyProject            -- look at 'type' column for 'follows' → "graph"

-- ── 3f. Find shortest path (BFS) — opens Graph View tab ──────────────
FIND PATH FROM follows(1) TO follows(4)  IN MyProject  -- Alice → Diana
FIND PATH FROM follows(1) TO follows(5)  IN MyProject  -- Alice → Eve
FIND PATH FROM follows(2) TO follows(5)  IN MyProject  -- Bob   → Eve

-- ── 3g. Update / remove edges ────────────────────────────────────────
MODIFY follows SET relation_type = "FRIENDS" WHERE from = 1 AND to = 2  IN MyProject
REMOVE follows WHERE relation_type = "WORKS_WITH"                        IN MyProject

-- ── 3h. Drop ──────────────────────────────────────────────────────────
DROP GRAPH  follows IN MyProject
DROP TABLE  people  IN MyProject
DROP TABLE  pages   IN MyProject




-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  SECTION 4 — DOCUMENT  (flexible JSON-like records)              ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
--  A DOCUMENT collection stores schema-free records — each record
--  can have different fields and nested objects/arrays.
--  Great for logs, events, configurations, and variable-shape data.
--  Run SHOW STATS to confirm collection type = "document".
-- ───────────────────────────────────────────────────────────────────

-- ── 4a. Create ───────────────────────────────────────────────────────
CREATE DOCUMENT logs     IN MyProject
CREATE DOCUMENT profiles IN MyProject
CREATE DOCUMENT events   IN MyProject

-- ── 4b. Insert flexible records (fields can differ per record) ────────
ADD logs VALUES { level: "INFO",  msg: "Server started",       service: "api",   ts: "2024-01-10T08:00:00" } IN MyProject
ADD logs VALUES { level: "WARN",  msg: "High memory usage",    service: "worker",ts: "2024-01-10T09:15:00", mem_mb: 890 } IN MyProject
ADD logs VALUES { level: "ERROR", msg: "DB connection failed", service: "api",   ts: "2024-01-10T09:30:00", retries: 3   } IN MyProject
ADD logs VALUES { level: "INFO",  msg: "Request processed",    service: "api",   ts: "2024-01-10T10:00:00", latency_ms: 42 } IN MyProject

ADD profiles VALUES { username: "alice",   bio: "engineer",  verified: true,  tags: "go,rust,uql"  } IN MyProject
ADD profiles VALUES { username: "bob",     bio: "designer",  verified: false, portfolio: "bob.io"  } IN MyProject
ADD profiles VALUES { username: "charlie", bio: "manager",   verified: true,  reports: 5           } IN MyProject

ADD events VALUES { type: "click",  user_id: 1, element: "btn-signup",  page: "/home"           } IN MyProject
ADD events VALUES { type: "view",   user_id: 2, page: "/pricing",       duration_s: 45          } IN MyProject
ADD events VALUES { type: "submit", user_id: 1, form: "contact",        success: true           } IN MyProject
ADD events VALUES { type: "error",  user_id: 3, code: 404, path: "/old-page"                    } IN MyProject

-- ── 4c. Query ─────────────────────────────────────────────────────────
FIND logs IN MyProject                                   -- all records
FIND logs WHERE level = "ERROR"        IN MyProject     -- filter
FIND logs WHERE service = "api"        IN MyProject     -- only api service
FIND events WHERE type = "click"       IN MyProject     -- click events
FIND profiles WHERE verified = true    IN MyProject     -- verified users
FIND logs WHERE level != "INFO"        IN MyProject     -- not info logs
FIND events WHERE user_id = 1          IN MyProject     -- primary key lookup

-- ── 4d. Confirm it is a document collection ───────────────────────────
SHOW STATS IN MyProject      -- 'type' column for 'logs', 'profiles', 'events' → "document"

-- ── 4e. Update ────────────────────────────────────────────────────────
MODIFY profiles SET verified = true    WHERE username = "bob"     IN MyProject
MODIFY logs     SET level = "RESOLVED" WHERE level = "ERROR"      IN MyProject

-- ── 4f. Delete ────────────────────────────────────────────────────────
REMOVE logs WHERE level = "INFO"       IN MyProject
REMOVE events WHERE type = "error"     IN MyProject

-- ── 4g. Drop ──────────────────────────────────────────────────────────
DROP DOCUMENT logs     IN MyProject
DROP DOCUMENT profiles IN MyProject
DROP DOCUMENT events   IN MyProject




-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  SECTION 5 — TRANSACTIONS (ACID)                                 ║
-- ╚═══════════════════════════════════════════════════════════════════╝

BEGIN
ADD users VALUES { name: "Frank", age: 40, role: "user" } IN MyProject
ADD orders VALUES { user_id: 6, amount: 150, status: "new" }   IN MyProject
COMMIT

-- To undo instead:
-- BEGIN
-- ADD users VALUES { name: "Ghost", age: 0 } IN MyProject
-- ROLLBACK




-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  SECTION 6 — WHERE OPERATORS QUICK REFERENCE                    ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
--   =    equal to            WHERE role = "admin"
--   !=   not equal           WHERE role != "guest"
--   >    greater than        WHERE age > 18
--   >=   greater or equal    WHERE age >= 18
--   <    less than           WHERE price < 500
--   <=   less or equal       WHERE price <= 999
--   AND  combine conditions  WHERE age > 20 AND role = "admin"
`;


// ── Reference tab (fixed, always reopenable) ──────────────────────────────────
export const REFERENCE_TAB_ID = 'tab-reference-fixed';

// ── Tab counter for SQL-style naming ──────────────────────────────────────────
let _tabSeq = 0;
function nextTabTitle(): string {
  _tabSeq++;
  return `UQLQuery${_tabSeq}.uql`;
}

// ── LocalStorage helpers ───────────────────────────────────────────────────────
function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function makeTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: 'UQLQuery1.uql',
    query: '',
    result: null,
    activeResultTab: 'results',
    ...overrides,
  };
}

// ── Reference tab definition ───────────────────────────────────────────────────
function makeReferenceTab(): EditorTab {
  return {
    id: REFERENCE_TAB_ID,
    title: 'Reference',
    query: DEFAULT_QUERY,
    result: null,
    activeResultTab: 'results',
  };
}

// ── Compute initial tab state once ─────────────────────────────────────────────
// Reference tab is ALWAYS present on load/refresh.
function initTabState(): { tabs: EditorTab[]; activeTabId: string } {
  const saved = lsGet<EditorTab[]>('uql-tabs', []);
  const refTab = makeReferenceTab();

  if (saved.length > 0) {
    // Strip any old reference tabs (could have wrong ID from old version), then re-add
    const queryTabs = saved.filter(t => t.id !== REFERENCE_TAB_ID).map(t => ({ ...t, result: null }));
    const tabs = [refTab, ...queryTabs];
    const savedId = lsGet<string>('uql-active-tab', '');
    const activeTabId = tabs.some(t => t.id === savedId) ? savedId : queryTabs[0]?.id ?? refTab.id;
    return { tabs, activeTabId };
  }
  // No saved tabs — start with just the Reference tab
  return { tabs: [refTab], activeTabId: refTab.id };
}

// ── Hook ───────────────────────────────────────────────────────────────────────
export function useIdeState() {
  // ── Tabs ───────────────────────────────────────────────────────────────────
  const _init = useRef<{ tabs: EditorTab[]; activeTabId: string }>();
  if (!_init.current) _init.current = initTabState();

  const [tabs, setTabs] = useState<EditorTab[]>(_init.current.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(_init.current.activeTabId);

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  // Persist tabs on change (omit result to keep storage lean)
  useEffect(() => {
    lsSet('uql-tabs', tabs.map(t => ({ ...t, result: null })));
    lsSet('uql-active-tab', activeTabId);
  }, [tabs, activeTabId]);

  const addTab = useCallback((query = '', title?: string) => {
    const t = makeTab({ query, title: title ?? nextTabTitle() });
    setTabs(prev => [...prev, t]);
    setActiveTabId(t.id);
    return t.id;
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        // All tabs closed — restore Reference tab automatically
        const refTab = makeReferenceTab();
        setActiveTabId(refTab.id);
        return [refTab];
      }
      setActiveTabId(curr => {
        if (curr !== id) return curr;
        return next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? '';
      });
      return next;
    });
  }, []);

  const openReferenceTab = useCallback(() => {
    setTabs(prev => {
      const existing = prev.find(t => t.id === REFERENCE_TAB_ID);
      if (existing) {
        setActiveTabId(REFERENCE_TAB_ID);
        return prev;
      }
      const refTab = makeReferenceTab();
      setActiveTabId(REFERENCE_TAB_ID);
      return [refTab, ...prev];
    });
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<EditorTab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const setActiveTabQuery = useCallback((query: string) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, query } : t));
  }, [activeTabId]);

  const setActiveTabResult = useCallback((result: any) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, result } : t));
  }, [activeTabId]);

  const setTabResultTab = useCallback((tab: ResultsTab) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, activeResultTab: tab } : t));
  }, [activeTabId]);

  // ── Panel state ────────────────────────────────────────────────────────────
  const [activeDatabaseId, setActiveDatabaseId] = useState<number | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [savedQueriesOpen, setSavedQueriesOpen] = useState(false);

  // ── Theme (persisted) ──────────────────────────────────────────────────────
  const [theme, setTheme] = useState<Theme>(() => lsGet<Theme>('uql-theme', 'dark'));
  const toggleTheme = useCallback(() => {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      lsSet('uql-theme', next);
      return next;
    });
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── Transaction state ──────────────────────────────────────────────────────
  const [isInTransaction, setIsInTransaction] = useState(false);

  // ── Timing history (sparkline) ─────────────────────────────────────────────
  const [timingHistory, setTimingHistory] = useState<TimingEntry[]>([]);
  const recordTiming = useCallback((ms: number, success: boolean) => {
    setTimingHistory(prev => [...prev.slice(-29), { ms, success, ts: Date.now() }]);
  }, []);

  // ── Saved queries ──────────────────────────────────────────────────────────
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() =>
    lsGet<SavedQuery[]>('uql-saved-queries', [])
  );

  const saveQuery = useCallback((name: string, query: string) => {
    const sq: SavedQuery = {
      id: `sq-${Date.now()}`,
      name,
      query,
      createdAt: new Date().toISOString(),
    };
    setSavedQueries(prev => {
      const next = [sq, ...prev];
      lsSet('uql-saved-queries', next);
      return next;
    });
  }, []);

  const deleteSavedQuery = useCallback((id: string) => {
    setSavedQueries(prev => {
      const next = prev.filter(q => q.id !== id);
      lsSet('uql-saved-queries', next);
      return next;
    });
  }, []);

  // ── Shortcuts overlay ──────────────────────────────────────────────────────
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // ── Minimap ────────────────────────────────────────────────────────────────
  const [minimapOpen, setMinimapOpen] = useState(() => lsGet<boolean>('uql-minimap', false));
  const toggleMinimap = useCallback(() => {
    setMinimapOpen(v => { lsSet('uql-minimap', !v); return !v; });
  }, []);

  return {
    // Tabs
    tabs,
    activeTabId,
    activeEditorTab: activeTab,
    setActiveTabId,
    addTab,
    closeTab,
    openReferenceTab,
    updateTab,

    // Per-active-tab conveniences (shims for legacy prop names)
    queryText: activeTab?.query ?? '',
    setQueryText: setActiveTabQuery,
    setActiveTabResult,
    activeResultTab: activeTab?.activeResultTab ?? ('results' as ResultsTab),
    setActiveTab: setTabResultTab,

    // Panel state
    activeDatabaseId,
    setActiveDatabaseId,
    leftPanelOpen,
    setLeftPanelOpen,
    rightPanelOpen,
    setRightPanelOpen,
    bottomPanelOpen,
    setBottomPanelOpen,
    savedQueriesOpen,
    setSavedQueriesOpen,

    // Theme
    theme,
    toggleTheme,

    // Transaction
    isInTransaction,
    setIsInTransaction,

    // Timing
    timingHistory,
    recordTiming,

    // Saved queries
    savedQueries,
    saveQuery,
    deleteSavedQuery,

    // Shortcuts overlay
    shortcutsOpen,
    setShortcutsOpen,

    // Minimap
    minimapOpen,
    toggleMinimap,
  };
}

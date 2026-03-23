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
const DEFAULT_QUERY = `-- ═══════════════════════════════════════════════════════
--   UQL STUDIO  —  Complete Query Reference
-- ═══════════════════════════════════════════════════════
--   Run any line: delete the "--" and press Ctrl+Enter
--   Or: select a database in the toolbar to skip IN <db>
-- ───────────────────────────────────────────────────────


-- ┌─────────────────────────────────────────────────────┐
-- │  1. DATABASE                                        │
-- └─────────────────────────────────────────────────────┘

-- Create a database (always works, no selection needed)
CREATE DB MyProject

-- ┌─────────────────────────────────────────────────────┐
-- │  2. CREATE COLLECTIONS                              │
-- └─────────────────────────────────────────────────────┘

CREATE TABLE   users    IN MyProject
CREATE GRAPH   social   IN MyProject
CREATE DOCUMENT logs    IN MyProject

-- ┌─────────────────────────────────────────────────────┐
-- │  3. ADD RECORDS                                     │
-- └─────────────────────────────────────────────────────┘

ADD users VALUES { name: "Alice", age: 28, role: "admin" }
ADD users VALUES { name: "Bob", age: 22, role: "user" }   IN MyProject


-- ┌─────────────────────────────────────────────────────┐
-- │  4. FIND (QUERY) RECORDS                            │
-- └─────────────────────────────────────────────────────┘

-- All records:
FIND users
FIND users IN MyProject

-- With WHERE filter:
FIND users WHERE age >= 18
FIND users WHERE role = "admin"
FIND users WHERE age >= 18 AND role = "admin"

-- With LIMIT:
FIND users LIMIT 10
FIND users WHERE age > 20 LIMIT 5

-- ORDER BY (requires secondary index or uses full scan):
FIND users ORDER BY age ASC
FIND users ORDER BY age DESC LIMIT 5
FIND users WHERE role = "admin" ORDER BY age ASC

-- JOIN two collections (nested-loop join):
FIND users JOIN orders ON users.id = orders.user_id

-- Aggregates over a whole collection:
FIND users AGGREGATE COUNT(*)
FIND users AGGREGATE SUM(age)
FIND users AGGREGATE AVG(age)
FIND users AGGREGATE MIN(age)
FIND users AGGREGATE MAX(age)

-- GROUP BY + aggregate:
FIND users GROUP BY role AGGREGATE COUNT(*)
FIND orders GROUP BY status AGGREGATE SUM(amount)

-- ┌─────────────────────────────────────────────────────┐
-- │  5. SECONDARY INDEXES (B+ Tree)                     │
-- └─────────────────────────────────────────────────────┘

-- Create a secondary index on a field:
CREATE INDEX ON users(age)    IN MyProject
CREATE INDEX ON users(role)   IN MyProject

-- List indexes for a collection:
SHOW INDEXES FOR users IN MyProject

-- Drop an index:
DROP INDEX ON users(age)      IN MyProject

-- ┌─────────────────────────────────────────────────────┐
-- │  6. EXPLAIN (Query Execution Plan)                  │
-- └─────────────────────────────────────────────────────┘

EXPLAIN FIND users WHERE age >= 18
EXPLAIN FIND users ORDER BY age ASC
EXPLAIN FIND users WHERE role = "admin" LIMIT 5

-- ┌─────────────────────────────────────────────────────┐
-- │  7. SHOW STATS (Engine Statistics)                  │
-- └─────────────────────────────────────────────────────┘

SHOW STATS
SHOW STATS IN MyProject

-- ┌─────────────────────────────────────────────────────┐
-- │  8. MODIFY (UPDATE) RECORDS                        │
-- └─────────────────────────────────────────────────────┘

MODIFY users SET role = "owner"    WHERE name = "Alice"
MODIFY users SET age = 30          WHERE name = "Alice"
MODIFY users SET role = "guest", age = 25  WHERE name = "Bob"

-- ┌─────────────────────────────────────────────────────┐
-- │  9. REMOVE (DELETE) RECORDS                        │
-- └─────────────────────────────────────────────────────┘

REMOVE users WHERE role = "guest"
REMOVE users WHERE name = "Alice"

-- ┌─────────────────────────────────────────────────────┐
-- │  10. DROP (DELETE AN ENTIRE COLLECTION)             │
-- └─────────────────────────────────────────────────────┘

DROP TABLE   users   IN MyProject
DROP GRAPH   social  IN MyProject
DROP DOCUMENT logs   IN MyProject

-- ┌─────────────────────────────────────────────────────┐
-- │  11. GRAPH TRAVERSAL + VISUALIZATION                │
-- └─────────────────────────────────────────────────────┘

-- BFS shortest path — auto-shows Graph View tab:
FIND PATH FROM user(1) TO product(42)
FIND PATH FROM customer(5) TO order(100)

-- ┌─────────────────────────────────────────────────────┐
-- │  12. TRANSACTIONS (ACID)                            │
-- └─────────────────────────────────────────────────────┘

BEGIN
ADD users VALUES { name: "Charlie", age: 35 }
COMMIT

-- ┌─────────────────────────────────────────────────────┐
-- │  OPERATORS SUPPORTED IN WHERE                       │
-- └─────────────────────────────────────────────────────┘
--   =    equal           age = 25
--   !=   not equal       role != "guest"
--   >    greater than    age > 18
--   >=   greater/equal   age >= 18
--   <    less than       age < 65
--   <=   less/equal      age <= 65
--   AND  combine filters age > 18 AND role = "admin"
`;

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
    title: 'Query',
    query: '',
    result: null,
    activeResultTab: 'results',
    ...overrides,
  };
}

// ── Compute initial tab state once ─────────────────────────────────────────────
function initTabState(): { tabs: EditorTab[]; activeTabId: string } {
  const saved = lsGet<EditorTab[]>('uql-tabs', []);
  if (saved.length > 0) {
    const tabs = saved.map(t => ({ ...t, result: null }));
    const savedId = lsGet<string>('uql-active-tab', '');
    const activeTabId = tabs.some(t => t.id === savedId) ? savedId : tabs[0].id;
    return { tabs, activeTabId };
  }
  const defaultTab = makeTab({ title: 'Reference', query: DEFAULT_QUERY });
  return { tabs: [defaultTab], activeTabId: defaultTab.id };
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

  const addTab = useCallback((query = '', title = 'Query') => {
    const t = makeTab({ query, title });
    setTabs(prev => [...prev, t]);
    setActiveTabId(t.id);
    return t.id;
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      setActiveTabId(curr => {
        if (curr !== id) return curr;
        return next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? '';
      });
      return next;
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

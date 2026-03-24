import { createContext, useContext, useEffect, useState } from "react";

interface ThemeCtx {
  isDark: boolean;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ isDark: true, toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem("uql-theme") !== "light"; } catch { return true; }
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.remove("uql-light");
    } else {
      document.documentElement.classList.add("uql-light");
    }
    try { localStorage.setItem("uql-theme", isDark ? "dark" : "light"); } catch {}
  }, [isDark]);

  return (
    <Ctx.Provider value={{ isDark, toggle: () => setIsDark(d => !d) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);

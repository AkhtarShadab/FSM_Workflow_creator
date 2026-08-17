"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: ResolvedTheme | undefined;
  systemTheme: ResolvedTheme | undefined;
};

const STORAGE_KEY = "theme";
const DEFAULT_THEME: Theme = "dark";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* ignore quota / private mode */
  }
  return DEFAULT_THEME;
}

function applyResolvedClass(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

function resolveTheme(
  theme: Theme,
  systemTheme: ResolvedTheme
): ResolvedTheme {
  return theme === "system" ? systemTheme : theme;
}

const themeListeners = new Set<() => void>();

function subscribeStoredTheme(onStoreChange: () => void) {
  themeListeners.add(onStoreChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    themeListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeSystemTheme(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

const subscribeNever = () => () => {};
const getClientTrue = () => true;
const getServerFalse = () => false;

/** True after hydration; false during SSR — no cascading setState. */
export function useClientMounted() {
  return useSyncExternalStore(subscribeNever, getClientTrue, getServerFalse);
}

/**
 * Blocking snippet for `<head>` — applies the stored/system theme before paint
 * so SSR + hydration do not flash the wrong colors.
 */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(STORAGE_KEY)};var d=${JSON.stringify(DEFAULT_THEME)};var t=localStorage.getItem(k)||d;var r=t==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;if(r==="dark")document.documentElement.classList.add("dark");else document.documentElement.classList.remove("dark");}catch(e){document.documentElement.classList.add("dark");}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(
    subscribeStoredTheme,
    readStoredTheme,
    () => DEFAULT_THEME
  );
  const systemTheme = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemTheme,
    (): ResolvedTheme | undefined => undefined
  );

  useEffect(() => {
    if (!systemTheme) return;
    applyResolvedClass(resolveTheme(theme, systemTheme));
  }, [theme, systemTheme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    themeListeners.forEach((listener) => listener());
    const system = typeof window !== "undefined" ? getSystemTheme() : "dark";
    applyResolvedClass(resolveTheme(next, system));
  }, []);

  const resolvedTheme = useMemo(() => {
    if (!systemTheme) return undefined;
    return resolveTheme(theme, systemTheme);
  }, [theme, systemTheme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
      systemTheme,
    }),
    [theme, setTheme, resolvedTheme, systemTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
type ThemeSnapshot = `${Theme}:${ResolvedTheme}`;

type ThemeProviderValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  systemTheme: ResolvedTheme;
  themes: Theme[];
  setTheme: (theme: Theme) => void;
};

const STORAGE_KEY = "theme";
const SYSTEM_QUERY = "(prefers-color-scheme: dark)";
const THEMES: Theme[] = ["light", "dark", "system"];
const subscribers = new Set<() => void>();

const ThemeContext = createContext<ThemeProviderValue>({
  theme: "system",
  resolvedTheme: "light",
  systemTheme: "light",
  themes: THEMES,
  setTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeToThemeStore,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const { theme, resolvedTheme, systemTheme } = parseThemeSnapshot(snapshot);

  const setTheme = useCallback((nextTheme: Theme) => {
    saveTheme(nextTheme);
    applyTheme(resolveTheme(nextTheme), true);
    notifySubscribers();
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      systemTheme,
      themes: THEMES,
      setTheme,
    }),
    [resolvedTheme, setTheme, systemTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY);

    return isTheme(storedTheme) ? storedTheme : null;
  } catch {
    return null;
  }
}

function saveTheme(theme: Theme) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore private browsing and storage access failures.
  }
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia(SYSTEM_QUERY).matches ? "dark" : "light";
}

function applyTheme(theme: ResolvedTheme, disableTransitions = false) {
  if (typeof document === "undefined") {
    return;
  }

  const restoreTransitions = disableTransitions ? disableCssTransitions() : null;
  const root = document.documentElement;

  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  restoreTransitions?.();
}

function disableCssTransitions() {
  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{transition:none!important;animation:none!important}",
    ),
  );
  document.head.appendChild(style);
  window.getComputedStyle(document.body);

  return () => {
    window.setTimeout(() => {
      style.remove();
    }, 1);
  };
}

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function getThemeSnapshot(): ThemeSnapshot {
  return `${getStoredTheme() ?? "system"}:${getSystemTheme()}`;
}

function getServerThemeSnapshot(): ThemeSnapshot {
  return "system:light";
}

function parseThemeSnapshot(snapshot: ThemeSnapshot) {
  const [theme, systemTheme] = snapshot.split(":") as [Theme, ResolvedTheme];

  return {
    theme,
    systemTheme,
    resolvedTheme: theme === "system" ? systemTheme : theme,
  };
}

function subscribeToThemeStore(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  subscribers.add(onStoreChange);

  const mediaQuery = window.matchMedia(SYSTEM_QUERY);
  const handleMediaChange = () => {
    applyTheme(resolveTheme(getStoredTheme() ?? "system"));
    onStoreChange();
  };
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      applyTheme(resolveTheme(getStoredTheme() ?? "system"));
      onStoreChange();
    }
  };

  mediaQuery.addEventListener("change", handleMediaChange);
  window.addEventListener("storage", handleStorageChange);

  return () => {
    subscribers.delete(onStoreChange);
    mediaQuery.removeEventListener("change", handleMediaChange);
    window.removeEventListener("storage", handleStorageChange);
  };
}

function notifySubscribers() {
  subscribers.forEach((subscriber) => subscriber());
}

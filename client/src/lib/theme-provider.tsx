import { useState, useEffect, createContext, useContext, useCallback } from "react";

type Theme = "light" | "dark";
type ThemeMode = "light" | "dark" | "system";

function getSystemTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function resolveTheme(mode: ThemeMode): Theme {
  if (mode === "system") return getSystemTheme();
  return mode;
}

const ThemeContext = createContext<{
  theme: Theme;
  themeMode: ThemeMode;
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}>({ theme: "light", themeMode: "light", toggleTheme: () => {}, setThemeMode: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("themeMode") as ThemeMode;
      if (stored) return stored;
      const legacy = localStorage.getItem("theme") as Theme;
      if (legacy) {
        localStorage.setItem("themeMode", legacy);
        return legacy;
      }
      return "light";
    }
    return "light";
  });

  const [theme, setTheme] = useState<Theme>(() => resolveTheme(themeMode));

  useEffect(() => {
    setTheme(resolveTheme(themeMode));
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setTheme(getSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    localStorage.setItem("themeMode", mode);
  }, []);

  const toggleTheme = useCallback(() => {
    if (themeMode === "system") {
      setThemeMode(theme === "light" ? "dark" : "light");
    } else {
      setThemeMode(themeMode === "light" ? "dark" : "light");
    }
  }, [themeMode, theme, setThemeMode]);

  return (
    <ThemeContext.Provider value={{ theme, themeMode, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

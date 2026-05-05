import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { PlatformId, PlatformMeta } from "./platform-meta";
import { PLATFORMS, themeToCssVars } from "./platform-meta";

const STORAGE_KEY = "lulian:active-platform";

type PlatformContextValue = {
  activePlatform: PlatformId;
  setActivePlatform: (p: PlatformId) => void;
  isActiveEnabled: boolean;
  meta: PlatformMeta;
};

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [activePlatform, setActivePlatformState] = useState<PlatformId>(() => {
    if (typeof window === "undefined") return "xhs";
    const saved = window.localStorage.getItem(STORAGE_KEY) as PlatformId | null;
    return saved && saved in PLATFORMS ? saved : "xhs";
  });

  // 持久化
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, activePlatform);
    } catch {
      /* ignore */
    }
  }, [activePlatform]);

  // 把当前平台主题色注入到 <html>，全站组件都能用 hsl(var(--platform-*)) 引用
  useEffect(() => {
    if (typeof document === "undefined") return;
    const meta = PLATFORMS[activePlatform];
    if (!meta) return;
    const vars = themeToCssVars(meta.theme);
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.platform = activePlatform;
  }, [activePlatform]);

  const value: PlatformContextValue = {
    activePlatform,
    setActivePlatform: (p) => setActivePlatformState(p),
    isActiveEnabled: PLATFORMS[activePlatform]?.enabled ?? false,
    meta: PLATFORMS[activePlatform],
  };

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformContextValue {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within PlatformProvider");
  return ctx;
}

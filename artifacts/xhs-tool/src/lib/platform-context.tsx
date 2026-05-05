import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { PlatformId } from "./platform-meta";
import { PLATFORMS } from "./platform-meta";

const STORAGE_KEY = "lulian:active-platform";

type PlatformContextValue = {
  activePlatform: PlatformId;
  setActivePlatform: (p: PlatformId) => void;
  isActiveEnabled: boolean;
};

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [activePlatform, setActivePlatformState] = useState<PlatformId>(() => {
    if (typeof window === "undefined") return "xhs";
    const saved = window.localStorage.getItem(STORAGE_KEY) as PlatformId | null;
    return saved && saved in PLATFORMS ? saved : "xhs";
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, activePlatform);
    } catch {
      /* ignore */
    }
  }, [activePlatform]);

  const value: PlatformContextValue = {
    activePlatform,
    setActivePlatform: (p) => setActivePlatformState(p),
    isActiveEnabled: PLATFORMS[activePlatform]?.enabled ?? false,
  };

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformContextValue {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within PlatformProvider");
  return ctx;
}

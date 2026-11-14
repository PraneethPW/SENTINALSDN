import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { MotionConfig, useReducedMotion } from "framer-motion";

const preferenceKey = "sentinel.motion-off";
const MotionPreference = createContext({ paused: false, reduced: false, toggle: () => {} });

export function MotionProvider({ children }: { children: ReactNode }) {
  const systemReduced = useReducedMotion();
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) === "true";
    } catch {
      return false;
    }
  });
  const reduced = !!systemReduced || paused;

  function toggle() {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem(preferenceKey, String(next));
    } catch {
      // Keep the preference for the current page when storage is unavailable.
    }
  }

  return (
    <MotionPreference.Provider value={{ paused, reduced, toggle }}>
      <MotionConfig reducedMotion={reduced ? "always" : "never"}>
        {children}
      </MotionConfig>
    </MotionPreference.Provider>
  );
}

export function useMotionPreference() {
  return useContext(MotionPreference);
}

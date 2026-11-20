import type { FitViewOptions } from "@xyflow/react";

/**
 * Keep fitted boards clear of the floating chrome: the state palette on the
 * left (desktop) or bottom (phones), and the signal toolbar on top.
 */
export function canvasFitOptions(duration?: number): FitViewOptions {
  const desktop = typeof window !== "undefined" && window.innerWidth >= 768;
  return {
    padding: desktop
      ? { top: "96px", left: "236px", right: "32px", bottom: "64px" }
      : { top: "120px", left: "16px", right: "16px", bottom: "200px" },
    ...(duration ? { duration } : {}),
  };
}

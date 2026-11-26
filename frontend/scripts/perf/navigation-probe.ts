import type { Page } from "@playwright/test";
import { join } from "node:path";
export const OUT_DIR = join(process.cwd(), "perf-results", "navigation");
export const REPEATS = 3;
export const CPU_THROTTLE = 4;
/** Schul-WLAN gegen einen entfernten Server: 150 ms RTT, 3 Mbit/s. */
export const NETWORK = {
  latency: 150,
  downloadThroughput: (3 * 1024 * 1024) / 8,
  uploadThroughput: (1 * 1024 * 1024) / 8,
} as const;
export const QUIET = { quietMs: 1500, capMs: 25_000 } as const;

interface NavProbeWindow {
  __navProbe?: {
    fallbacks: string[];
    mountedLoading: boolean;
    stop: () => void;
  };
}

/**
 * Markiert die Hülle und beobachtet, welche Ladehüllen auftauchen. Beides
 * direkt vor dem Klick; die Marke ist ein Attribut auf einem DOM-Knoten, den
 * React nur bei einem Neuaufbau ersetzt.
 */
export async function armProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probeWindow = window as NavProbeWindow;
    probeWindow.__navProbe?.stop();
    const state = {
      fallbacks: [] as string[],
      mountedLoading: false,
      stop: () => {},
    };
    probeWindow.__navProbe = state;

    document
      .querySelector("[data-portal-background]")
      ?.setAttribute("data-nav-probe", "armed");

    const selector =
      'output[aria-busy="true"], .animate-pulse.bg-gray-200, .moto-nav-progress';
    const note = (element: Element) => {
      if (
        !element.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        }) ||
        !element.getClientRects().length
      )
        return false;
      const label = element.matches("output")
        ? "loading:" + (element.getAttribute("aria-label") ?? "")
        : element.matches(".animate-pulse")
          ? "skeleton"
          : "progress-bar";
      if (!state.fallbacks.includes(label)) state.fallbacks.push(label);
      return true;
    };
    const candidates = new Set<Element>();
    let frame = 0;
    const checkFrame = () => {
      frame = 0;
      for (const candidate of candidates) {
        if (
          !candidate.isConnected ||
          !candidate.matches(selector) ||
          !candidate.getClientRects().length ||
          note(candidate)
        )
          candidates.delete(candidate);
      }
      // CSS-only opacity delays don't cause DOM mutations.
      if (candidates.size) frame = requestAnimationFrame(checkFrame);
    };
    const add = (node: Element) => {
      if (node.matches('output[aria-busy="true"]')) state.mountedLoading = true;
      candidates.add(node);
    };
    const inspect = (element: Element) => {
      if (element.matches(selector)) add(element);
      for (const child of element.querySelectorAll(selector)) add(child);
      if (candidates.size && !frame) frame = requestAnimationFrame(checkFrame);
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.target instanceof Element
        )
          inspect(mutation.target);
        for (const node of mutation.addedNodes)
          if (node instanceof Element) inspect(node);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-busy", "style"],
    });
    state.stop = () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      candidates.clear();
    };
  });
}

export async function readProbe(page: Page): Promise<{
  shellSurvived: boolean;
  fallbacks: string[];
  mountedLoading: boolean;
}> {
  return page.evaluate(() => {
    const probeWindow = window as NavProbeWindow;
    const state = probeWindow.__navProbe;
    state?.stop();
    const shellSurvived =
      document
        .querySelector("[data-portal-background]")
        ?.getAttribute("data-nav-probe") === "armed";
    // Mehrfach dasselbe Skelett zählt einmal; interessant ist, WAS zu sehen war.
    const fallbacks = [...new Set(state?.fallbacks ?? [])];
    return {
      shellSurvived,
      fallbacks,
      mountedLoading: state?.mountedLoading ?? false,
    };
  });
}

export interface RequestCost {
  requests: number;
  rsc: number;
  scripts: number;
  api: number;
  kB: number;
}

export function requestCost(
  records: readonly {
    path: string;
    resourceType: string;
    bytes: number | null;
  }[],
): RequestCost {
  return {
    requests: records.length,
    rsc: records.filter(
      (record) =>
        record.path.includes("_rsc=") ||
        record.path.split("?", 1)[0]?.endsWith(".rsc"),
    ).length,
    scripts: records.filter((record) => record.resourceType === "script")
      .length,
    api: records.filter((record) => record.path.startsWith("/api/")).length,
    kB:
      Math.round(
        records.reduce((sum, record) => sum + (record.bytes ?? 0), 0) / 102.4,
      ) / 10,
  };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

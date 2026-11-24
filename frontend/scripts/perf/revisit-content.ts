import type { Page } from "@playwright/test";

/** AND across markers, OR within a selector. Match only rendered, enabled content. */
export interface Marker {
  css: string;
  text?: string;
  exact?: string;
}
export interface Content {
  path: string;
  numericDetail?: boolean;
  query?: Record<string, string>;
  markers: Marker[];
  criterion: string;
}
type Probe = {
  matches: (content: Content) => boolean;
  elapsed: number | null;
  start: (event?: Event) => void;
};
declare global {
  interface Window {
    __revisit: Probe;
  }
}

export async function installContentProbe(page: Page) {
  await page.addInitScript(() => {
    const visible = (node: Element) =>
      !node.closest('[inert], [aria-hidden="true"], [aria-busy="true"]') &&
      !node.matches(":disabled") &&
      node.getClientRects().length > 0 &&
      node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    window.__revisit = {
      elapsed: null,
      start: () => {},
      matches({ path, numericDetail, query, markers }) {
        if (
          numericDetail
            ? !location.pathname.startsWith(path + "/") ||
              !/^\d+$/.test(location.pathname.slice(path.length + 1))
            : location.pathname !== path
        )
          return false;
        const params = new URLSearchParams(location.search);
        if (!Object.entries(query ?? {}).every(([k, v]) => params.get(k) === v))
          return false;
        return markers.every(({ css, text, exact }) => {
          const regex = text ? new RegExp(text, "i") : null;
          return Array.from(document.querySelectorAll<HTMLElement>(css)).some(
            (node) => {
              if (!visible(node)) return false;
              if (!regex && exact === undefined) return true;
              const label = (
                node.innerText ||
                node.getAttribute("aria-label") ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim();
              return (
                (exact === undefined || label === exact) &&
                (!regex || regex.test(label))
              );
            },
          );
        });
      },
    };
  });
}

/** Frame clock in the renderer: no Playwright actionability wait or assertion polling in the sample. */
export async function armContentClock(
  page: Page,
  content: Content,
  trigger: "pointerdown" | "keydown" | "touchstart" | "history",
) {
  await page.evaluate(
    ({ content, trigger }) => {
      const probe = window.__revisit;
      if (probe.matches(content))
        throw new Error("Zielinhalt steht bereits vor der Aktion.");
      probe.elapsed = null;
      probe.start = (event) => {
        if (event && !event.isTrusted) return;
        const start = event?.timeStamp ?? performance.now();
        let matchedLastFrame = false;
        const frame = () => {
          const matched = probe.matches(content);
          // The next frame follows a paint opportunity for the first matching
          // frame; a transient or unmounted target cannot finish the clock.
          if (matched && matchedLastFrame) {
            probe.elapsed = performance.now() - start;
            return;
          }
          matchedLastFrame = matched;
          if (performance.now() - start < 30000) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      };
      if (trigger !== "history")
        document.addEventListener(trigger, probe.start, {
          capture: true,
          once: true,
        });
    },
    { content, trigger },
  );
}

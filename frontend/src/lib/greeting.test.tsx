import { act, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setTestClock } from "~/test/clock";
import { getTimeBasedGreeting, useTimeBasedGreeting } from "./greeting";

// Wie die Überschrift von TenantPage.
function Title() {
  return (
    <h1 suppressHydrationWarning>{`${useTimeBasedGreeting()}, Katrin`}</h1>
  );
}

describe("getTimeBasedGreeting", () => {
  it.each([
    ["2026-10-02T10:15:00+02:00", "Guten Morgen"],
    ["2026-10-02T14:00:00+02:00", "Guten Tag"],
    ["2026-10-02T21:30:00+02:00", "Guten Abend"],
    // Schulzeit, nicht die Zone des Geräts: 09:30 UTC ist 11:30 in Berlin.
    ["2026-10-02T09:30:00Z", "Guten Morgen"],
    ["2026-10-02T10:30:00Z", "Guten Tag"],
  ])("grüßt um %s mit %s", (instant, greeting) => {
    expect(getTimeBasedGreeting(new Date(instant))).toBe(greeting);
  });
});

describe("useTimeBasedGreeting", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  // Server und Browser rechnen den Gruß in Schulzeit (#6471). Früher rendert
  // der Server "Hallo" und der Browser tauschte es nach der Hydration aus;
  // beim Neuladen sprang der Titel sichtbar um.
  it("rendert auf dem Server schon den Tageszeit-Gruß der Schule", () => {
    setTestClock("2026-10-02T21:30:00+02:00");

    expect(renderToString(<Title />)).toContain("Guten Abend, Katrin");
  });

  it("behält den Gruß des Servers bei der Hydration, ohne Hydration-Fehler", async () => {
    setTestClock("2026-10-02T21:30:00+02:00");
    container = document.createElement("div");
    container.innerHTML = renderToString(<Title />);
    document.body.append(container);
    const onRecoverableError = vi.fn();

    await act(async () => {
      hydrateRoot(container!, <Title />, { onRecoverableError });
    });

    expect(screen.getByRole("heading")).toHaveTextContent(
      "Guten Abend, Katrin",
    );
    expect(onRecoverableError).not.toHaveBeenCalled();
  });

  // Fallen Server-Render und Hydration genau über eine Stundengrenze, hält
  // die Überschrift den Servertext aus (suppressHydrationWarning), statt die
  // Seite zu verwerfen.
  it("verwirft die Seite nicht, wenn die Hydration über 12 Uhr fällt", async () => {
    setTestClock("2026-10-02T11:59:59+02:00");
    container = document.createElement("div");
    container.innerHTML = renderToString(<Title />);
    document.body.append(container);
    setTestClock("2026-10-02T12:00:01+02:00");
    const onRecoverableError = vi.fn();

    await act(async () => {
      hydrateRoot(container!, <Title />, { onRecoverableError });
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
  });
});

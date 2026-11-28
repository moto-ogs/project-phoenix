import { act, render, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  SheetSessionProvider,
  resetSheetSessionsForTest,
  useSheetCovered,
  useSheetSession,
} from "./sheet-session";

let setters: Record<string, (open: boolean) => void> = {};

function Sheet({ name, children }: { name: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  setters[name] = setOpen;
  const id = useSheetSession(open, () => setOpen(false), true);
  const covered = useSheetCovered(open ? id : null);
  return (
    <SheetSessionProvider value={id}>
      <span data-testid={name}>
        {open ? (covered ? "covered" : "open") : "closed"}
      </span>
      {children}
    </SheetSessionProvider>
  );
}

function back() {
  return new Promise<void>((resolve) => {
    window.addEventListener("popstate", () => resolve(), { once: true });
    window.history.back();
  });
}

afterEach(() => {
  resetSheetSessionsForTest();
  setters = {};
});

describe("useSheetSession", () => {
  it("keeps one sheet open and lets Back close it", async () => {
    const start = window.history.length;
    const { getByTestId } = render(
      <>
        <Sheet name="a" />
        <Sheet name="b" />
      </>,
    );
    act(() => setters.a?.(true));
    expect(getByTestId("a").textContent).toBe("open");
    expect(window.history.length).toBe(start + 1);

    act(() => setters.b?.(true));
    // The second sheet replaces the first and takes over its entry.
    expect(getByTestId("a").textContent).toBe("closed");
    expect(getByTestId("b").textContent).toBe("open");
    expect(window.history.length).toBe(start + 1);

    await act(back);
    expect(getByTestId("b").textContent).toBe("closed");
  });

  it("covers the parent sheet while a child sheet is open", async () => {
    const { getByTestId } = render(
      <Sheet name="parent">
        <Sheet name="child" />
      </Sheet>,
    );
    act(() => setters.parent?.(true));
    act(() => setters.child?.(true));
    expect(getByTestId("parent").textContent).toBe("covered");
    expect(getByTestId("child").textContent).toBe("open");

    await act(back);
    expect(getByTestId("child").textContent).toBe("closed");
    expect(getByTestId("parent").textContent).toBe("open");
  });

  it("removes its own entry when closed through the interface", async () => {
    const { getByTestId } = render(<Sheet name="a" />);
    act(() => setters.a?.(true));
    expect(
      typeof (window.history.state as { motoSheet?: string }).motoSheet,
    ).toBe("string");
    act(() => setters.a?.(false));
    await waitFor(() =>
      expect(
        (window.history.state as { motoSheet?: string } | null)?.motoSheet,
      ).toBeUndefined(),
    );
    expect(getByTestId("a").textContent).toBe("closed");
  });

  it("keeps an address the page changed while the sheet was open", async () => {
    // Ein Filter im Blatt schreibt die Adresse um (`replaceState`). Schließt
    // das Blatt, darf der Verlauf nicht auf die alte Adresse zurückfallen.
    window.history.replaceState(null, "", "/kinder");
    const { getByTestId } = render(<Sheet name="a" />);
    act(() => setters.a?.(true));
    window.history.replaceState(window.history.state, "", "/kinder?gruppe=1");
    act(() => setters.a?.(false));
    await waitFor(() =>
      expect(
        (window.history.state as { motoSheet?: string } | null)?.motoSheet,
      ).toBeUndefined(),
    );
    expect(window.location.pathname + window.location.search).toBe(
      "/kinder?gruppe=1",
    );
    expect(getByTestId("a").textContent).toBe("closed");
  });
});

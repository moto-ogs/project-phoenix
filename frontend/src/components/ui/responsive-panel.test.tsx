import { useRef, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { releaseFakeTimers } from "~/test/clock";
import {
  DESKTOP_WIDTH,
  PHONE_WIDTH,
  setViewportWidth,
  usePhoneViewport,
} from "~/test/helpers/viewport";
import { Modal } from "./modal";
import { MODAL_CLOSE_DELAY_MS } from "./motion";
import { ResponsivePanel } from "./responsive-panel";
import {
  SlideOver,
  SlideOverBody,
  SlideOverContent,
  SlideOverHeader,
  SlideOverTitle,
} from "./slide-over";

// Real Vaul and Radix: the sheet's focus, Escape and outside press live in
// Vaul's Radix dialog.

function Panel({
  onOpenChange,
  initialFocusLabel,
}: {
  readonly onOpenChange?: (open: boolean) => void;
  readonly initialFocusLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const change = (next: boolean) => {
    onOpenChange?.(next);
    setOpen(next);
  };
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={change}
      label="Weitere Aktionen"
      returnFocusRef={triggerRef}
      initialFocus={
        initialFocusLabel
          ? (sheet) =>
              sheet.querySelector<HTMLElement>(
                `[aria-label="${initialFocusLabel}"]`,
              )
          : undefined
      }
      trigger={
        <button ref={triggerRef} type="button" onClick={() => change(!open)}>
          Menü
        </button>
      }
    >
      {(asSheet) => (
        <div role="menu" aria-label="Aktionen" data-as-sheet={String(asSheet)}>
          <button type="button" role="menuitem">
            Bearbeiten
          </button>
          <button type="button" role="menuitem" aria-label="Löschen">
            Löschen
          </button>
        </div>
      )}
    </ResponsivePanel>
  );
}

function InModal({
  children,
  onClose,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return (
    <Modal isOpen={open} onClose={close} title="Kind bearbeiten">
      {children}
    </Modal>
  );
}

function InSlideOver({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <SlideOver open={open} onOpenChange={setOpen}>
      <SlideOverContent aria-describedby={undefined}>
        <SlideOverHeader>
          <SlideOverTitle>Vertretung</SlideOverTitle>
        </SlideOverHeader>
        <SlideOverBody>{children}</SlideOverBody>
      </SlideOverContent>
    </SlideOver>
  );
}

function sheetDialog(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Weitere Aktionen" });
}

/** Vaul hält das Blatt bis zum Ende seiner Animation; happy-dom spielt keine. */
async function finishClosing() {
  const sheet = sheetDialog();
  if (sheet !== null) {
    await waitFor(() => expect(sheet).toHaveAttribute("data-state", "closed"));
    const end = new Event("animationend");
    Object.assign(end, {
      animationName: getComputedStyle(sheet).animationName,
    });
    act(() => {
      sheet.dispatchEvent(end);
    });
  }
  await waitFor(() => expect(sheetDialog()).toBeNull());
}

/** Tippen auf die Abdunklung; Radix hängt seinen Listener erst nach dem Öffnen an. */
async function tapBackdrop(onOpenChange: ReturnType<typeof vi.fn>) {
  const overlay = document.querySelector("[data-vaul-overlay]");
  expect(overlay).not.toBeNull();
  await waitFor(() => {
    // Radix schließt erst mit dem Klick nach dem Druck außen.
    fireEvent.pointerDown(overlay!, { pointerType: "mouse" });
    fireEvent.click(overlay!);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
}

describe("ResponsivePanel ab sm", () => {
  it("rendert den Inhalt als Popover ohne Dialog", () => {
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Menü" }));

    expect(screen.getByRole("menu", { name: "Aktionen" })).toHaveAttribute(
      "data-as-sheet",
      "false",
    );
    expect(
      screen.queryByRole("dialog", { name: "Weitere Aktionen" }),
    ).not.toBeInTheDocument();
  });
});

describe("ResponsivePanel unter sm", () => {
  usePhoneViewport();

  it("öffnet als Dialog mit Fokus auf dem ersten Eintrag; Escape schließt und gibt den Fokus zurück", async () => {
    const onOpenChange = vi.fn();
    render(<Panel onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "Menü" });
    fireEvent.click(trigger);

    const sheet = await screen.findByRole("dialog", {
      name: "Weitere Aktionen",
    });
    expect(screen.getByRole("menu", { name: "Aktionen" })).toHaveAttribute(
      "data-as-sheet",
      "true",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "Bearbeiten" }),
      ).toHaveFocus(),
    );

    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await finishClosing();
    expect(trigger).toHaveFocus();
  });

  it("fokussiert beim Öffnen den gewählten Eintrag", async () => {
    render(<Panel initialFocusLabel="Löschen" />);
    fireEvent.click(screen.getByRole("button", { name: "Menü" }));

    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Löschen" })).toHaveFocus(),
    );
  });

  it("schließt beim Tippen auf die Abdunklung", async () => {
    const onOpenChange = vi.fn();
    render(<Panel onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Menü" }));
    await screen.findByRole("dialog", { name: "Weitere Aktionen" });

    await tapBackdrop(onOpenChange);
    await finishClosing();
  });

  it("schließt in einem Modal mit Escape nur das Blatt", async () => {
    const onModalClose = vi.fn();
    render(
      <InModal onClose={onModalClose}>
        <Panel />
      </InModal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menü" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Weitere Aktionen",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "Bearbeiten" }),
      ).toHaveFocus(),
    );

    // Das Modal schlösse erst nach seiner Ausblendung; die Zeit läuft vor.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.keyDown(sheet, { key: "Escape" });
    act(() => {
      vi.advanceTimersByTime(MODAL_CLOSE_DELAY_MS);
    });
    expect(onModalClose).not.toHaveBeenCalled();
    releaseFakeTimers();

    await finishClosing();
    expect(
      screen.getByRole("dialog", { name: "Kind bearbeiten" }),
    ).toBeInTheDocument();
    // Die Fokusfalle des Modals hält den Auslöser wieder.
    expect(screen.getByRole("button", { name: "Menü" })).toHaveFocus();
  });

  it("schließt in einem Slide-over mit Escape und Außentippen nur das Blatt", async () => {
    const onOpenChange = vi.fn();
    render(
      <InSlideOver>
        <Panel onOpenChange={onOpenChange} />
      </InSlideOver>,
    );
    const trigger = await screen.findByRole("button", { name: "Menü" });
    fireEvent.click(trigger);
    const sheet = await screen.findByRole("dialog", {
      name: "Weitere Aktionen",
    });

    fireEvent.keyDown(sheet, { key: "Escape" });
    await finishClosing();
    expect(
      screen.getByRole("dialog", { name: "Vertretung" }),
    ).toBeInTheDocument();

    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Weitere Aktionen" });
    await tapBackdrop(onOpenChange);
    await finishClosing();
    expect(
      screen.getByRole("dialog", { name: "Vertretung" }),
    ).toBeInTheDocument();
  });

  it("öffnet in einem offenen Blatt gestapelt; das untere rückt nach hinten und bleibt offen", async () => {
    render(<Outer />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const outer = await screen.findByRole("dialog", { name: "Filter" });

    const trigger = screen.getByRole("button", { name: "Menü" });
    fireEvent.click(trigger);
    const inner = await screen.findByRole("dialog", {
      name: "Weitere Aktionen",
    });
    expect(outer).not.toContainElement(inner);
    await waitFor(() => expect(outer.style.transform).toContain("scale("));

    fireEvent.keyDown(inner, { key: "Escape" });
    await finishClosing();
    expect(screen.getByRole("dialog", { name: "Filter" })).toBe(outer);
    expect(outer.style.transform).toBe("");
    expect(trigger).toHaveFocus();
  });
});

/** Ein Panel, das schon offen eingehängt wird, wie ein Menü in einer Zeile, die erst der Tipp einhängt. */
function OpenPanel({
  onOpenChange,
}: {
  readonly onOpenChange: (open: boolean) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <ResponsivePanel
      open
      onOpenChange={onOpenChange}
      label="Weitere Aktionen"
      returnFocusRef={triggerRef}
      trigger={
        <button ref={triggerRef} type="button">
          Menü
        </button>
      }
    >
      {(asSheet) => (
        <div role="menu" aria-label="Aktionen" data-as-sheet={String(asSheet)}>
          <button type="button" role="menuitem">
            Bearbeiten
          </button>
        </div>
      )}
    </ResponsivePanel>
  );
}

describe("ResponsivePanel: erste Darstellung und Wechsel über sm (#8013)", () => {
  afterEach(() => setViewportWidth(DESKTOP_WIDTH));

  it("bleibt offen, wenn es am Telefon schon offen eingehängt wird", async () => {
    setViewportWidth(PHONE_WIDTH);
    const onOpenChange = vi.fn();
    render(<OpenPanel onOpenChange={onOpenChange} />);

    // Anker: das Blatt steht offen da.
    await screen.findByRole("dialog", { name: "Weitere Aktionen" });
    expect(screen.getByRole("menu", { name: "Aktionen" })).toHaveAttribute(
      "data-as-sheet",
      "true",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("bleibt offen, wenn die Seite am Telefon mit offenem Panel hydriert", async () => {
    setViewportWidth(PHONE_WIDTH);
    const onOpenChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    // Der Server kennt die Breite nicht und rendert das Popover.
    container.innerHTML = renderToString(
      <OpenPanel onOpenChange={onOpenChange} />,
    );
    expect(container.innerHTML).toContain('data-as-sheet="false"');

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <OpenPanel onOpenChange={onOpenChange} />);
    });
    try {
      // Anker: nach der Hydration steht das Blatt offen da.
      await screen.findByRole("dialog", { name: "Weitere Aktionen" });
      expect(onOpenChange).not.toHaveBeenCalled();
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });

  it("schließt, wenn die Breite nach dem Einhängen unter sm fällt", () => {
    const onOpenChange = vi.fn();
    render(<OpenPanel onOpenChange={onOpenChange} />);
    // Anker: ab sm steht das Popover offen da.
    expect(screen.getByRole("menu", { name: "Aktionen" })).toHaveAttribute(
      "data-as-sheet",
      "false",
    );
    expect(onOpenChange).not.toHaveBeenCalled();

    setViewportWidth(PHONE_WIDTH);

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
});

/** Ein Blatt, in dem ein zweites `ResponsivePanel` steht. */
function Outer() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      label="Filter"
      returnFocusRef={triggerRef}
      trigger={
        <button ref={triggerRef} type="button" onClick={() => setOpen(!open)}>
          Filter
        </button>
      }
    >
      {() => <Panel />}
    </ResponsivePanel>
  );
}

import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Drawer as DrawerPrimitive } from "vaul";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  SlideOver,
  SlideOverBody,
  SlideOverContent,
  SlideOverHeader,
  SlideOverTitle,
} from "./slide-over";

// Real Vaul and Radix focus scope (#7502): `slide-over.test.tsx` mocks Vaul,
// and focus on open and close lives inside Vaul's Radix dialog.

function Harness({
  children,
  collapsedAfterSave = false,
  goneAfterSave = false,
}: {
  readonly children?: ReactNode;
  /** The saved row lands in a collapsed group: only its name is rendered. */
  readonly collapsedAfterSave?: boolean;
  /** The saved row leaves the list: nothing carries its key any more. */
  readonly goneAfterSave?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // A save moves the row to another group: React builds a new trigger.
  const [saved, setSaved] = useState(false);
  const trigger = (
    <button
      type="button"
      data-focus-return="row-1"
      onClick={() => setOpen(true)}
    >
      Öffnen
    </button>
  );
  return (
    <>
      <section data-focus-return-scope="">
        <button type="button" tabIndex={-1}>
          Nur per Skript
        </button>
        <button type="button">Erste Zeile</button>
        {saved ? null : trigger}
      </section>
      <section>
        {saved && collapsedAfterSave ? (
          <button type="button" data-focus-return="row-0 row-1">
            Schon geregelt
          </button>
        ) : null}
        {saved && !collapsedAfterSave && !goneAfterSave ? trigger : null}
      </section>
      <button type="button">Weiter auf der Seite</button>
      <SlideOver open={open} onOpenChange={setOpen}>
        <SlideOverContent aria-describedby={undefined}>
          <SlideOverHeader>
            <SlideOverTitle>Vertretung</SlideOverTitle>
          </SlideOverHeader>
          <SlideOverBody>
            {children ?? <input aria-label="Notiz" />}
            <button type="button" onClick={() => setSaved(true)}>
              Speichern
            </button>
            {/* Focusable by script only: no stop for Tab or Shift+Tab. */}
            <button type="button" tabIndex={-1}>
              Nur per Skript
            </button>
          </SlideOverBody>
        </SlideOverContent>
      </SlideOver>
    </>
  );
}

// The pattern of many callers: the panel exists only while it is open, and
// closing unmounts it at once (no slide-out, no closed state).
function MountedWhileOpen() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Öffnen
      </button>
      {open ? (
        <SlideOver open onOpenChange={setOpen}>
          <SlideOverContent aria-describedby={undefined}>
            <SlideOverHeader>
              <SlideOverTitle>Vertretung</SlideOverTitle>
            </SlideOverHeader>
            <SlideOverBody>
              <input aria-label="Notiz" />
            </SlideOverBody>
          </SlideOverContent>
        </SlideOver>
      ) : null}
    </>
  );
}

// A panel that opens a second one and steps aside for it, as „Neues Kind“
// does for „Neu anlegen“: closing the second resumes the first.
function Suspending() {
  const [step, setStep] = useState<"closed" | "parent" | "child">("closed");
  return (
    <>
      <button type="button" onClick={() => setStep("parent")}>
        Öffnen
      </button>
      <SlideOver
        open={step === "parent"}
        onOpenChange={(next) => setStep(next ? "parent" : "closed")}
      >
        <SlideOverContent aria-describedby={undefined}>
          <SlideOverHeader>
            <SlideOverTitle>Neues Kind</SlideOverTitle>
          </SlideOverHeader>
          <SlideOverBody>
            <button type="button" onClick={() => setStep("child")}>
              Neu anlegen
            </button>
          </SlideOverBody>
        </SlideOverContent>
      </SlideOver>
      <SlideOver
        open={step === "child"}
        onOpenChange={(next) => setStep(next ? "child" : "parent")}
      >
        <SlideOverContent aria-describedby={undefined}>
          <SlideOverHeader>
            <SlideOverTitle>Neue Person</SlideOverTitle>
          </SlideOverHeader>
          <SlideOverBody>
            <button type="button" onClick={() => setStep("parent")}>
              Abbrechen
            </button>
          </SlideOverBody>
        </SlideOverContent>
      </SlideOver>
    </>
  );
}

// One panel for every row, as the editor of the Vertretungsplan.
function Reused() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Zeile A
      </button>
      {saved ? null : (
        <button type="button" onClick={() => setOpen(true)}>
          Zeile B
        </button>
      )}
      <button type="button">Weiter auf der Seite</button>
      <SlideOver open={open} onOpenChange={setOpen}>
        <SlideOverContent aria-describedby={undefined}>
          <SlideOverHeader>
            <SlideOverTitle>Vertretung</SlideOverTitle>
          </SlideOverHeader>
          <SlideOverBody>
            <button type="button" onClick={() => setSaved(true)}>
              Speichern
            </button>
          </SlideOverBody>
        </SlideOverContent>
      </SlideOver>
    </>
  );
}

function WithRadixTrigger() {
  return (
    <SlideOver>
      <DrawerPrimitive.Trigger>Öffnen</DrawerPrimitive.Trigger>
      <SlideOverContent aria-describedby={undefined}>
        <SlideOverHeader>
          <SlideOverTitle>Vertretung</SlideOverTitle>
        </SlideOverHeader>
        <SlideOverBody>
          <input aria-label="Notiz" />
        </SlideOverBody>
      </SlideOverContent>
    </SlideOver>
  );
}

function clickFocused(name: string) {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
  return button;
}

function openFromTrigger() {
  const trigger = screen.getByRole("button", { name: "Öffnen" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

// With Vaul's slide-out animation in the document, Radix keeps the closed
// panel mounted until it ends; jsdom runs no animation, so the test ends it.
// Without that style (another test file reset the head) it unmounts at once.
// A panel under another one is hidden from the accessibility tree, so the
// role query cannot name it.
function findDialog(name?: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"]'),
  ).find((dialog) => name === undefined || dialog.textContent.includes(name));
}

async function finishClosing(name?: string) {
  const dialog = findDialog(name);
  if (dialog?.isConnected) {
    await waitFor(() => expect(dialog).toHaveAttribute("data-state", "closed"));
    const end = new Event("animationend");
    Object.assign(end, {
      animationName: getComputedStyle(dialog).animationName,
    });
    act(() => {
      dialog.dispatchEvent(end);
    });
  }
  await waitFor(() => expect(findDialog(name)).toBeUndefined());
}

describe("SlideOver focus (#7502)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("moves focus onto the panel itself, the named dialog, on open", async () => {
    render(<Harness />);
    openFromTrigger();

    const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    // Not a field: a phone shows no on-screen keyboard, and the panel draws
    // no focus ring of its own.
    expect(screen.getByRole("textbox", { name: "Notiz" })).not.toHaveFocus();
    expect(dialog).toHaveClass("outline-none");
  });

  it("keeps the field a caller focuses on open", async () => {
    render(
      <Harness>
        {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- the caller's own start focus is the case under test */}
        <input aria-label="Suche" autoFocus />
      </Harness>,
    );
    openFromTrigger();

    const search = await screen.findByRole("textbox", { name: "Suche" });
    await waitFor(() => expect(search).toHaveFocus());
  });

  it("returns focus to the trigger on close", async () => {
    render(<Harness />);
    const trigger = openFromTrigger();
    const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(dialog, { key: "Escape" });
    await finishClosing();

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("returns focus to the trigger after a caller's start focus too", async () => {
    render(
      <Harness>
        {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- the caller's own start focus is the case under test */}
        <input aria-label="Suche" autoFocus />
      </Harness>,
    );
    const trigger = openFromTrigger();
    const search = await screen.findByRole("textbox", { name: "Suche" });
    await waitFor(() => expect(search).toHaveFocus());

    fireEvent.keyDown(search, { key: "Escape" });
    await finishClosing();

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("finds a trigger that a save rendered anew by its focus-return key", async () => {
    render(<Harness />);
    const trigger = openFromTrigger();
    const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(trigger).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await finishClosing();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Öffnen" })).toHaveFocus(),
    );
  });

  it("moves Shift+Tab from the panel to its last control", async () => {
    render(<Harness />);
    openFromTrigger();
    const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(dialog).toHaveFocus());

    const save = screen.getByRole("button", { name: "Speichern" });
    const focus = vi.spyOn(save, "focus");

    // The panel is no tab stop: without help the focus trap pulls a reverse
    // Tab straight back onto it.
    const notPrevented = fireEvent.keyDown(dialog, {
      key: "Tab",
      shiftKey: true,
    });

    expect(notPrevented).toBe(false);
    expect(save).toHaveFocus();
    // In a long panel the last control is below the fold: the key press
    // scrolls it into view, or Space would act on a control nobody sees.
    expect(focus.mock.calls.at(-1)?.[0]?.preventScroll ?? false).toBe(false);
  });

  it("leaves Shift+Tab from a control inside to the focus loop", async () => {
    render(<Harness />);
    openFromTrigger();
    const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(dialog).toHaveFocus());
    const note = screen.getByRole("textbox", { name: "Notiz" });
    note.focus();

    fireEvent.keyDown(note, { key: "Tab", shiftKey: true });

    expect(note).toHaveFocus();
  });

  it("hands focus to the control that hides the re-rendered trigger", async () => {
    render(<Harness collapsedAfterSave />);
    openFromTrigger();
    const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await finishClosing();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Schon geregelt" }),
      ).toHaveFocus(),
    );
  });

  it("keeps the focus in the trigger's scope when the row left the list", async () => {
    render(<Harness goneAfterSave />);
    openFromTrigger();
    const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await finishClosing();

    // The first tab stop of the scope, not the button only a script focuses.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Erste Zeile" })).toHaveFocus(),
    );
  });

  it("forgets an opener once the page moved the focus on", async () => {
    render(<Reused />);
    const rowA = clickFocused("Zeile A");
    const first = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(first, { key: "Escape" });
    screen.getByText("Weiter auf der Seite").focus();
    await finishClosing();
    await new Promise((resolve) => setTimeout(resolve, 0));

    clickFocused("Zeile B");
    const second = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(second).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    fireEvent.keyDown(second, { key: "Escape" });
    await finishClosing();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Row B is gone; row A opened an earlier, finished visit.
    expect(rowA).not.toHaveFocus();
  });

  it.each([
    ["with the keyboard, into view", true, 1],
    ["with a pointer, without moving the page", false, 0],
  ])(
    "returns focus to a moved trigger %s",
    async (_case, focusVisible, scrolls) => {
      const matches = HTMLElement.prototype.matches;
      vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (
        this: HTMLElement,
        selector: string,
      ) {
        return selector === ":focus-visible"
          ? focusVisible
          : matches.call(this, selector);
      });
      const scrollIntoView = vi.fn();
      HTMLElement.prototype.scrollIntoView = scrollIntoView;
      render(<Harness />);
      openFromTrigger();
      const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
      await waitFor(() => expect(dialog).toHaveFocus());

      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      fireEvent.keyDown(dialog, { key: "Escape" });
      await finishClosing();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Öffnen" })).toHaveFocus(),
      );
      expect(scrollIntoView).toHaveBeenCalledTimes(scrolls);
    },
  );

  it.each([
    // The first panel is gone when the second closes: resuming mounts it
    // anew and reads the focus inside the second panel, not the opener.
    ["after it slid out", true],
    // Still sliding out: it resumes in place.
    ["while it slides out", false],
  ])(
    "keeps the page opener of a panel that a second one suspended, resumed %s",
    async (_case, slidOut) => {
      render(<Suspending />);
      const opener = clickFocused("Öffnen");
      const parent = await screen.findByRole("dialog", { name: "Neues Kind" });
      await waitFor(() => expect(parent).toHaveFocus());

      clickFocused("Neu anlegen");
      const child = await screen.findByRole("dialog", { name: "Neue Person" });
      await waitFor(() => expect(child).toHaveFocus());
      if (slidOut) await finishClosing("Neues Kind");

      clickFocused("Abbrechen");
      await finishClosing("Neue Person");
      const resumed = await screen.findByRole("dialog", { name: "Neues Kind" });
      // Mounted anew, the panel itself takes the focus. Still mounted, the
      // second panel returns it to its own opener inside. Which of the two
      // happens without `slidOut` depends on Vaul's slide-out style being
      // in the document, so only the panel is asserted there.
      await waitFor(() =>
        expect(resumed.contains(document.activeElement)).toBe(true),
      );
      if (slidOut) expect(resumed).toHaveFocus();

      fireEvent.keyDown(resumed, { key: "Escape" });
      await finishClosing("Neues Kind");

      await waitFor(() => expect(opener).toHaveFocus());
    },
  );

  it("leaves the return to a Radix trigger that opened without focus", async () => {
    render(<WithRadixTrigger />);
    // A pointer click that gives the button no focus (Safari, Firefox on
    // macOS): the kit has no opener to return to, Radix knows its trigger.
    const trigger = screen.getByRole("button", { name: "Öffnen" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(dialog, { key: "Escape" });
    await finishClosing();

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("leaves focus where it went after close instead of pulling it back", async () => {
    render(<Harness />);
    openFromTrigger();
    const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
    await waitFor(() => expect(dialog).toHaveFocus());

    // The caller moves the focus on while the panel slides out.
    const elsewhere = screen.getByText("Weiter auf der Seite");
    fireEvent.keyDown(dialog, { key: "Escape" });
    elsewhere.focus();
    await finishClosing();
    // Radix hands the focus back one task after the panel unmounts.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(elsewhere).toHaveFocus();
  });

  it.each([
    ["desktop", false],
    // On a phone the first breakpoint read rebuilds Vaul's instance while
    // the panel is already open.
    ["phone", true],
  ])(
    "returns focus to the trigger when the caller unmounts the panel (%s)",
    async (_width, phone) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({
          matches: phone,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
      render(<MountedWhileOpen />);
      const trigger = openFromTrigger();

      const dialog = await screen.findByRole("dialog", { name: "Vertretung" });
      await waitFor(() =>
        expect(dialog).toHaveAttribute(
          "data-vaul-drawer-direction",
          phone ? "bottom" : "right",
        ),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("dialog", { name: "Vertretung" }),
        ).toHaveFocus(),
      );

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );

      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );
});

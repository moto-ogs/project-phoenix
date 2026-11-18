import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function Harness({ children }: { readonly children?: ReactNode }) {
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
      <section>{saved ? null : trigger}</section>
      <section>{saved ? trigger : null}</section>
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

function openFromTrigger() {
  const trigger = screen.getByRole("button", { name: "Öffnen" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

// With Vaul's slide-out animation in the document, Radix keeps the closed
// panel mounted until it ends; jsdom runs no animation, so the test ends it.
// Without that style (another test file reset the head) it unmounts at once.
async function finishClosing() {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
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
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
}

describe("SlideOver focus (#7502)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

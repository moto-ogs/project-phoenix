import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageComposer } from "./message-composer";

function ParentComposer({ onSend }: Readonly<{ onSend: () => void }>) {
  const [value, setValue] = useState("");
  return (
    <MessageComposer
      value={value}
      onChange={setValue}
      onSend={onSend}
      sending={false}
      tone="parent"
      sendLabel="Senden"
      fieldLabel="Nachricht"
    />
  );
}

describe("MessageComposer in der Eltern-App", () => {
  it("behält für den Icon-Button den zugänglichen Namen und sendet", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ParentComposer onSend={onSend} />);

    const send = screen.getByRole("button", { name: "Senden" });
    expect(send).toBeDisabled();

    await user.type(
      screen.getByRole("textbox", { name: "Nachricht" }),
      "Hallo",
    );
    expect(send).toBeEnabled();

    await user.click(send);
    expect(onSend).toHaveBeenCalledOnce();
  });
});

describe("MessageComposer bei offener Handy-Tastatur (#3664)", () => {
  const originalViewport = window.visualViewport;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "visualViewport", {
      value: originalViewport,
      configurable: true,
    });
  });

  it("wächst höchstens auf ein Drittel des sichtbaren Bereichs", () => {
    let visibleHeight = 280;
    const viewport = new EventTarget();
    Object.defineProperty(viewport, "height", { get: () => visibleHeight });
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
    // A long draft: its content is taller than any cap.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(236);

    render(<ParentComposer onSend={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Nachricht" });

    // 280px visible with the keyboard open: the field stops at 93px and
    // scrolls inside, so the line being typed stays in the chat.
    expect(field.style.height).toBe("93px");
    expect(field.style.overflowY).toBe("auto");

    // Keyboard closes: the field may grow back to its 160px maximum.
    visibleHeight = 640;
    act(() => {
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(field.style.height).toBe("160px");
  });
});

describe("MessageComposer nach dem Senden (#7113, WCAG 2.4.3)", () => {
  // Wie die Chats: das Feld ist gesperrt, solange die Nachricht unterwegs ist.
  function SendingComposer({
    onSend,
  }: Readonly<{ onSend: () => Promise<boolean> }>) {
    const [value, setValue] = useState("");
    const [sending, setSending] = useState(false);
    return (
      <MessageComposer
        value={value}
        onChange={setValue}
        sending={sending}
        fieldLabel="Nachricht"
        onSend={async () => {
          setSending(true);
          setValue("");
          try {
            return await onSend();
          } finally {
            setSending(false);
          }
        }}
      />
    );
  }

  it("lässt den Fokus nach einem Klick auf Senden im Feld", async () => {
    const user = userEvent.setup();
    let arrive: (value: boolean) => void = () => {};
    render(
      <SendingComposer
        onSend={() =>
          new Promise<boolean>((resolve) => {
            arrive = resolve;
          })
        }
      />,
    );
    const field = screen.getByRole("textbox", { name: "Nachricht" });
    await user.type(field, "Hallo");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await act(async () => arrive(true));

    expect(field).toHaveFocus();
  });

  it("lässt den Fokus nach Enter im Feld", async () => {
    const user = userEvent.setup();
    render(<SendingComposer onSend={() => Promise.resolve(true)} />);
    const field = screen.getByRole("textbox", { name: "Nachricht" });
    await user.type(field, "Hallo{Enter}");

    expect(field).toHaveFocus();
    expect(field).toHaveValue("");
  });
});

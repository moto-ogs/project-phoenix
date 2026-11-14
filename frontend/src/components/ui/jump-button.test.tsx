import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JumpButton, jumpTo } from "./jump-button";

function page(target: React.ReactNode) {
  return render(
    <>
      <JumpButton
        targetId="parents"
        tooltip="Springt zu Telefon und E-Mail-Adresse der Eltern."
      >
        Zu den Eltern
      </JumpButton>
      {target}
    </>,
  );
}

describe("JumpButton", () => {
  it("brings the card into view and moves the focus to its heading", () => {
    page(
      <section id="parents">
        <h2>Eltern</h2>
        <button type="button">Ändern</button>
      </section>,
    );
    const card = document.getElementById("parents")!;
    const scroll = vi.fn();
    card.scrollIntoView = scroll;

    fireEvent.click(screen.getByRole("button", { name: "Zu den Eltern" }));

    expect(scroll).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    );
    expect(screen.getByRole("heading", { name: "Eltern" })).toHaveFocus();
  });

  it("focuses a field that is itself the target", () => {
    page(<input id="parents" aria-label="E-Mail der Eltern" />);

    fireEvent.click(screen.getByRole("button", { name: "Zu den Eltern" }));

    expect(
      screen.getByRole("textbox", { name: "E-Mail der Eltern" }),
    ).toHaveFocus();
  });

  it("focuses the target itself when it has no heading", () => {
    page(<div id="parents">Telefon 0123</div>);

    fireEvent.click(screen.getByRole("button", { name: "Zu den Eltern" }));

    expect(screen.getByText("Telefon 0123")).toHaveFocus();
  });

  it("reports a target that is not on the page and keeps the focus", () => {
    page(<p>Eltern werden gerade bearbeitet</p>);
    const button = screen.getByRole("button", { name: "Zu den Eltern" });
    button.focus();

    expect(jumpTo("parents")).toBe(false);
    expect(button).toHaveFocus();
  });
});

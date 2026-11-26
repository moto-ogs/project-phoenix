import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { releaseFakeTimers } from "~/test/clock";
import { HomeCardLink } from "../home/home-card-rows";
import { ButtonLink } from "./button";

vi.mock("next/link", () => ({
  default: ({
    prefetch,
    children,
    onNavigate: _onNavigate,
    ...props
  }: ComponentProps<"a"> & {
    prefetch?: "auto" | false;
    onNavigate?: unknown;
  }) => (
    <a {...props} data-prefetch={String(prefetch)}>
      {children}
    </a>
  ),
}));

describe("ButtonLink and HomeCardLink prefetch", () => {
  it("forwards the anchor ref and preserves the caller's prefetch opt-out", () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <ButtonLink href="/ogs-groups" ref={ref} prefetch={false}>
        Zur Gruppe
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Zur Gruppe" });
    expect(ref.current).toBe(link);
    fireEvent.focus(link);
    fireEvent.pointerEnter(link, { pointerType: "pen" });
    expect(link).toHaveAttribute("data-prefetch", "false");
  });

  it("prefetches the HomeCardLink shell without changing its accessible name", async () => {
    releaseFakeTimers();
    const user = userEvent.setup();
    render(
      <HomeCardLink
        href="/ogs-groups"
        label="Meine Gruppe öffnen"
        tooltip="Öffnet die Seite Ihrer Gruppe."
      >
        Zur Gruppe
      </HomeCardLink>,
    );
    const link = screen.getByRole("link", { name: "Meine Gruppe öffnen" });
    expect(link).toHaveAttribute("href", "/ogs-groups");
    expect(link).toHaveTextContent("Zur Gruppe");
    expect(link).toHaveAttribute("data-prefetch", "auto");
    await user.tab();
    expect(link).toHaveFocus();
  });
});

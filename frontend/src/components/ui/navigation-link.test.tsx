import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { ButtonLink } from "./button";
import NavigationLink from "./navigation-link";

const linkProps = vi.fn();

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    prefetch,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: "auto" | false }) => {
    linkProps({ href, prefetch });
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

describe.each([
  { name: "NavigationLink", Link: NavigationLink },
  { name: "ButtonLink", Link: ButtonLink },
])("$name", ({ Link }) => {
  beforeEach(() => {
    linkProps.mockClear();
  });

  it("prefetches a reusable shell without waiting for intent", () => {
    render(<Link href="/rooms">Räume</Link>);

    const link = screen.getByRole("link", { name: "Räume" });
    expect(link).toHaveAttribute("href", "/rooms");
    fireEvent.focus(link);
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    expect(linkProps.mock.calls).toEqual([
      [{ href: "/rooms", prefetch: "auto" }],
    ]);
  });

  it("disables shell prefetch when reused for an explicit opt-out", () => {
    const { rerender } = render(<Link href="/rooms">Ziel</Link>);
    rerender(
      <Link href="/confirm" prefetch={false}>
        Ziel
      </Link>,
    );

    const link = screen.getByRole("link", { name: "Ziel" });
    expect(link).toHaveAttribute("href", "/confirm");
    fireEvent.focus(link);
    expect(linkProps).toHaveBeenLastCalledWith({
      href: "/confirm",
      prefetch: false,
    });
  });

  it("keeps the caller's pointer and focus handlers", () => {
    const onPointerEnter = vi.fn();
    const onPointerLeave = vi.fn();
    const onFocus = vi.fn();
    render(
      <Link
        href="/rooms"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
      >
        Räume
      </Link>,
    );

    const link = screen.getByRole("link", { name: "Räume" });
    fireEvent.pointerEnter(link, { pointerType: "touch" });
    fireEvent.pointerLeave(link, { pointerType: "touch" });
    fireEvent.focus(link);

    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onPointerLeave).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/help", "_blank"],
    ["/help", "other-window"],
    ["https://example.org/extern", undefined],
    ["//example.org/extern", undefined],
    ["mailto:info@example.org", undefined],
  ])("does not prefetch %s with target %s", (href, target) => {
    render(
      <Link href={href} target={target}>
        Ziel
      </Link>,
    );
    fireEvent.focus(screen.getByRole("link", { name: "Ziel" }));
    expect(linkProps).toHaveBeenLastCalledWith({ href, prefetch: false });
  });

  it("passes className, aria and click handlers through to the anchor", () => {
    const onClick = vi.fn();
    render(
      <Link
        href="/rooms"
        className="nav-item"
        aria-label="Räume öffnen"
        onClick={onClick}
      >
        Räume
      </Link>,
    );

    const link = screen.getByRole("link", { name: "Räume öffnen" });
    expect(link).toHaveClass("nav-item");
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Collection, CollectionGroup, CollectionRow } from "./collection";

describe("Collection", () => {
  it("renders grouped rows; the row target and its one action stay separate", () => {
    const open = vi.fn();
    const act = vi.fn();
    render(
      <Collection label="Kinder">
        <CollectionGroup title="Fehlt noch" count={1}>
          <CollectionRow
            title="Mia Kaya"
            subtitle="Klasse 2a"
            meta="14:00"
            onClick={open}
            action={
              <button type="button" onClick={act}>
                Da
              </button>
            }
          />
        </CollectionGroup>
        <CollectionGroup title="Da" count={1}>
          <CollectionRow title="Ben Hartmann" href="/students/2" />
        </CollectionGroup>
      </Collection>,
    );
    expect(screen.getByRole("region", { name: "Kinder" })).toBeInTheDocument();
    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(document.querySelectorAll("[data-collection-row]")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Da" }));
    expect(act).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mia Kaya" }));
    expect(open).toHaveBeenCalledOnce();

    expect(screen.getByRole("link", { name: "Ben Hartmann" })).toHaveAttribute(
      "href",
      "/students/2",
    );
  });

  it("a collapsible group's head toggles its rows; without the prop the head stays plain text", () => {
    const toggle = vi.fn();
    const { rerender } = render(
      <Collection label="Mehr">
        <CollectionGroup
          title="Eltern"
          collapsible={{ expanded: true, onToggle: toggle }}
        >
          <CollectionRow title="Nachrichten" href="/messages" />
        </CollectionGroup>
        <CollectionGroup title="Konto">
          <CollectionRow title="Profil" href="/profile" />
        </CollectionGroup>
      </Collection>,
    );
    const head = screen.getByRole("button", { name: "Eltern" });
    expect(head).toHaveAttribute("aria-expanded", "true");
    const rows = document.getElementById(
      head.getAttribute("aria-controls") ?? "",
    );
    expect(rows).toContainElement(
      screen.getByRole("link", { name: "Nachrichten" }),
    );
    expect(screen.queryByRole("button", { name: "Konto" })).toBeNull();
    expect(
      screen.getByRole("heading", { level: 3, name: "Konto" }),
    ).toBeInTheDocument();

    fireEvent.click(head);
    expect(toggle).toHaveBeenCalledOnce();

    rerender(
      <Collection label="Mehr">
        <CollectionGroup
          title="Eltern"
          collapsible={{
            expanded: false,
            onToggle: toggle,
            collapsedBadge: <span>2 ungelesen</span>,
          }}
        >
          <CollectionRow title="Nachrichten" href="/messages" />
        </CollectionGroup>
      </Collection>,
    );
    expect(
      screen.getByRole("button", { name: "Eltern 2 ungelesen" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Nachrichten" })).toBeNull();
  });
});

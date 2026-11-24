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
});

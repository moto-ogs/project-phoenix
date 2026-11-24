import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SplitView } from "./split-view";

describe("SplitView", () => {
  it("shows only the list outside the split layout (phone, iPad portrait, desktop)", () => {
    render(
      <SplitView
        list={<p>Liste</p>}
        detail={<p>Detail</p>}
        empty="Wähle links ein Kind."
      />,
    );
    expect(screen.getByText("Liste")).toBeInTheDocument();
    expect(screen.queryByText("Detail")).not.toBeInTheDocument();
  });
});

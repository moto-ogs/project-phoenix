import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupervisionsOverview } from "./supervisions-overview";

const session = vi.hoisted(() => ({
  user: { name: "", email: "", firstName: "" } as Record<string, string>,
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: session.user, expires: "2099-01-01" },
    status: "authenticated",
  }),
}));

// Die Aufsichten grüßen mit dem Vornamen, nie mit einer Adresse (#7305).
describe("SupervisionsOverview greeting", () => {
  beforeEach(() => {
    session.user = { name: "", email: "", firstName: "" };
  });

  function renderOverview() {
    render(
      <SupervisionsOverview
        instances={[]}
        today="2026-09-09"
        onOpen={vi.fn()}
      />,
    );
  }

  it("greets with the first name", () => {
    session.user = {
      name: "Anna Lena Müller",
      email: "anna@schule.de",
      firstName: "Anna Lena",
    };
    renderOverview();

    expect(
      screen.getByText(/^Guten (Morgen|Tag|Abend), Anna Lena$/),
    ).toBeVisible();
  });

  it("greets without a name instead of the sign-in address", () => {
    session.user = { name: "eva@schule.de", email: "eva@schule.de" };
    renderOverview();

    expect(screen.getByText(/^Guten (Morgen|Tag|Abend)$/)).toBeVisible();
    expect(screen.queryByText(/eva@schule\.de/)).not.toBeInTheDocument();
  });
});

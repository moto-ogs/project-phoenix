import { IsolatedSWRCache, useInvalidateMatching } from "~/lib/swr";
vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: {
      user: { id: "parent-test", scope: "parent" },
      expires: "2099-01-01",
    },
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => null,
  useTenantSafe: () => null,
}));
import { Activity, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParentShell } from "./parent-shell";

vi.mock("~/components/dashboard/header", () => ({
  Header: () => <header />,
}));
vi.mock("./parent-sidebar", () => ({ ParentSidebar: () => <nav /> }));
vi.mock("./parent-bottom-nav", () => ({ ParentBottomNav: () => <nav /> }));
vi.mock("~/lib/shell-auth-context", () => ({
  useShellAuth: () => ({ status: "authenticated" }),
}));
vi.mock("~/lib/hooks/use-parent-messages-unread", () => ({
  useParentMessagesUnread: () => ({ unreadCount: 0 }),
}));
vi.mock("~/lib/hooks/use-parent-news-unread", () => ({
  useParentNewsUnread: () => ({ unreadCount: 0 }),
}));
vi.mock("~/lib/hooks/use-parent-news-enabled", () => ({
  useParentNewsEnabled: () => false,
}));
vi.mock("~/lib/hooks/use-parent-meal-plan-enabled", () => ({
  useParentMealPlanEnabled: () => false,
}));
vi.mock("~/components/parent/onboarding/parent-first-steps", () => ({
  ParentFirstSteps: () => null,
}));
vi.mock("~/components/parent/notifications/parent-notifications-bell", () => ({
  ParentNotificationsBell: () => null,
  useParentNotificationsUnread: () => ({ unreadCount: 0 }),
}));
vi.mock("~/components/parent/notifications/parent-notifications-sheet", () => ({
  ParentNotificationsSheet: () => null,
}));

const { linked } = vi.hoisted(() => ({
  linked: {
    ids: ["11", "12"] as string[],
    access: {} as Record<string, string>,
  },
}));
// The shell's roster: the family read of the start page (#8106).
vi.mock("~/lib/parent-api", async () => {
  const { berlinTodayISO } = await import("~/lib/date-helpers");
  return {
    getFamilyStart: async () => ({
      day: berlinTodayISO(),
      day_remaining_seconds: 86400,
      cards: linked.ids.map((id) => ({
        access_version: linked.access[id] ?? "v1",
        child: {
          student_id: id,
          tenant_id: "1",
          first_name: id === "11" ? "Mira" : "Ben",
          last_name: "Synthetisch",
          status: "active",
          school_name: "Schule",
          school_slug: "schule",
          care_ended: false,
        },
        features: null,
        today: null,
      })),
    }),
  };
});

/** One child's detail page with a draft, as a route keeps it. */
function ChildDetail({ name }: { name: string }) {
  const [draft, setDraft] = useState("");
  return (
    <label>
      Krankmeldung für {name}
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </label>
  );
}

function Routes({ route }: { route: "11" | "12" }) {
  const invalidate = useInvalidateMatching();
  return (
    <>
      <Activity mode={route === "11" ? "visible" : "hidden"}>
        <ChildDetail name="Mira" />
      </Activity>
      <Activity mode={route === "12" ? "visible" : "hidden"}>
        <ChildDetail name="Ben" />
      </Activity>
      <button
        type="button"
        onClick={() =>
          void invalidate((key) => key.startsWith("parent-family-start-"))
        }
      >
        Liste neu laden
      </button>
    </>
  );
}

function Portal({ route }: { route: "11" | "12" }) {
  return (
    <IsolatedSWRCache>
      <ParentShell>
        <Routes route={route} />
      </ParentShell>
    </IsolatedSWRCache>
  );
}

describe("ParentShell relationships (#8082)", () => {
  beforeEach(() => {
    linked.ids = ["11", "12"];
    linked.access = {};
  });

  it("drops a revoked child's hidden detail state and keeps the other child", async () => {
    const view = render(<Portal route="11" />);
    const mira = await screen.findByRole("textbox", {
      name: "Krankmeldung für Mira",
    });
    fireEvent.change(mira, { target: { value: "Mira hat Fieber" } });
    // The route of Mira is hidden, its draft stays in the DOM.
    view.rerender(<Portal route="12" />);
    expect(
      screen.getByRole("textbox", { name: "Krankmeldung für Ben" }),
    ).toBeVisible();
    expect(
      Array.from(document.querySelectorAll("textarea"), (area) => area.value),
    ).toContain("Mira hat Fieber");

    // The school ends the relationship to Mira; the list shows it.
    linked.ids = ["12"];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Liste neu laden" }));
    });

    // Gone also from the hidden route: no field keeps the draft.
    expect(
      Array.from(document.querySelectorAll("textarea"), (area) => area.value),
    ).not.toContain("Mira hat Fieber");
    // Ben stays reachable, nothing blocks him.
    expect(
      screen.getByRole("textbox", { name: "Krankmeldung für Ben" }),
    ).toBeVisible();
  });

  it("drops hidden detail state when a linked child's access changes", async () => {
    const view = render(<Portal route="11" />);
    const mira = await screen.findByRole("textbox", {
      name: "Krankmeldung für Mira",
    });
    fireEvent.change(mira, { target: { value: "Mira hat Fieber" } });
    view.rerender(<Portal route="12" />);
    expect(
      Array.from(document.querySelectorAll("textarea"), (area) => area.value),
    ).toContain("Mira hat Fieber");

    // The school withdraws a permission; Mira stays linked.
    linked.access = { "11": "v2" };
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Liste neu laden" }));
    });

    expect(
      Array.from(document.querySelectorAll("textarea"), (area) => area.value),
    ).not.toContain("Mira hat Fieber");
    // Control: both children stay reachable.
    expect(
      screen.getByRole("textbox", { name: "Krankmeldung für Ben" }),
    ).toBeVisible();
  });

  it("keeps the drafts when only the roster's order changes", async () => {
    render(<Portal route="11" />);
    const mira = await screen.findByRole("textbox", {
      name: "Krankmeldung für Mira",
    });
    fireEvent.change(mira, { target: { value: "Mira hat Fieber" } });

    // A corrected name sorts Ben first: the same children, the same access.
    linked.ids = ["12", "11"];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Liste neu laden" }));
    });

    expect(
      screen.getByRole("textbox", { name: "Krankmeldung für Mira" }),
    ).toHaveValue("Mira hat Fieber");
  });
});

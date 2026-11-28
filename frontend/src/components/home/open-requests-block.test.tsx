import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import type { UseUnreadCountResult } from "~/lib/hooks/use-unread-count";
import { catalogText } from "~/test/error-catalog-text";

type Source =
  | "changeRequests"
  | "enrollment"
  | "withdrawals"
  | "staffAbsences"
  | "unreadEnrollments";

const readers = vi.hoisted(
  () => ({}) as Record<string, ReturnType<typeof known>>,
);

/** Ein bestätigter Zähler, wie ihn der Hook nach einer Antwort liefert. */
function known(count: number) {
  return {
    unreadCount: count,
    isLoading: false,
    state: "known",
    error: undefined as unknown,
    refresh: vi.fn().mockResolvedValue(undefined),
  } satisfies UseUnreadCountResult;
}

function set(source: Source, reader: Partial<UseUnreadCountResult>) {
  readers[source] = { ...known(0), ...reader } as ReturnType<typeof known>;
}

function fail(source: Source) {
  const error = new ApiError("down", 503, { code: "general.unavailable" });
  set(source, { state: "failed", error });
}

vi.mock("~/lib/hooks/use-change-requests-pending", () => ({
  useChangeRequestsPending: () => readers.changeRequests,
}));
vi.mock("~/lib/hooks/use-enrollment-requests-pending", () => ({
  useEnrollmentRequestsPending: () => readers.enrollment,
}));
vi.mock("~/lib/hooks/use-care-withdrawals-pending", () => ({
  useCareWithdrawalsPending: () => readers.withdrawals,
}));
vi.mock("~/lib/hooks/use-staff-absences-pending", () => ({
  useStaffAbsencesPending: () => readers.staffAbsences,
}));
vi.mock("~/lib/hooks/use-enrollments-unread", () => ({
  useEnrollmentsUnread: () => readers.unreadEnrollments,
}));
vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => `/test-tenant${path}`,
}));

import { OpenRequestsBlock } from "./open-requests-block";

const ALL_CLEAR = "Nichts wartet auf eine Entscheidung";

describe("OpenRequestsBlock (#2180)", () => {
  beforeEach(() => {
    for (const source of [
      "changeRequests",
      "enrollment",
      "withdrawals",
      "staffAbsences",
      "unreadEnrollments",
    ] as const) {
      set(source, {});
    }
  });

  it("sagt es, wenn nichts auf eine Entscheidung wartet", () => {
    render(<OpenRequestsBlock />);

    expect(screen.getByText(ALL_CLEAR)).toBeInTheDocument();
  });

  // Eine Warteschlange ohne offene Anfrage ist keine Zeile: die Startseite
  // zeigt, was zu tun ist, nicht die Liste aller möglichen Arten.
  it("zeigt nur Arten mit offenen Anfragen", () => {
    set("changeRequests", { unreadCount: 3 });
    set("staffAbsences", { unreadCount: 1 });

    render(<OpenRequestsBlock />);

    expect(screen.getByText("Wünsche von Eltern")).toBeInTheDocument();
    expect(screen.getByText("3 offen")).toBeInTheDocument();
    expect(screen.getByText("Anträge des Teams")).toBeInTheDocument();
    expect(
      screen.queryByText("Änderungen an Anmeldungen"),
    ).not.toBeInTheDocument();
  });

  it("führt jede Zeile in die Anfragen-Liste der Einrichtung", () => {
    set("withdrawals", { unreadCount: 2 });

    render(<OpenRequestsBlock />);

    expect(
      screen.getByRole("link", { name: /Abmeldungen aus der Betreuung/ }),
    ).toHaveAttribute("href", "/test-tenant/anfragen");
  });

  // In der festen Zellenhöhe stand die vierte Art nur halb da: die Karte
  // wächst mit ihren höchstens fünf Zeilen (#8268).
  it("lässt die Karte mit allen offenen Arten wachsen", () => {
    set("changeRequests", { unreadCount: 1 });
    set("enrollment", { unreadCount: 1 });
    set("withdrawals", { unreadCount: 1 });
    set("staffAbsences", { unreadCount: 1 });
    set("unreadEnrollments", { unreadCount: 1 });

    render(<OpenRequestsBlock />);

    const list = screen.getAllByRole("listitem");
    expect(list).toHaveLength(5);
    expect(list[0]!.closest("[data-home-card-fit]")).not.toBeNull();
  });

  it("führt die Anträge des Teams direkt in ihren Reiter", () => {
    set("staffAbsences", { unreadCount: 1 });

    render(<OpenRequestsBlock />);

    expect(
      screen.getByRole("link", { name: /Anträge des Teams/ }),
    ).toHaveAttribute("href", "/test-tenant/anfragen?reiter=mitarbeitende");
  });

  // Ungelesene Anmeldungen (#3778): eigene Zeile, führt zu den Anmeldungen.
  it("zeigt ungelesene Anmeldungen als eigene Zeile", () => {
    set("unreadEnrollments", { unreadCount: 2 });

    render(<OpenRequestsBlock />);

    expect(screen.getByText("2 ungelesen")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Neue Anmeldungen/ }),
    ).toHaveAttribute("href", "/test-tenant/admin/enrollments");
  });
});

// Ein Abruffehler ist keine 0 (#8268): „nicht anwendbar“, „lädt oder
// fehlgeschlagen“ und „bestätigt leer“ sind drei Zustände.
describe("OpenRequestsBlock: Quellen ohne bestätigte Zahl (#8268)", () => {
  beforeEach(() => {
    for (const source of [
      "changeRequests",
      "enrollment",
      "withdrawals",
      "staffAbsences",
      "unreadEnrollments",
    ] as const) {
      set(source, {});
    }
  });

  it("gibt keine Entwarnung, solange eine Quelle noch lädt", () => {
    set("enrollment", { state: "loading", isLoading: true });

    render(<OpenRequestsBlock />);

    expect(
      screen.getByRole("status", { name: "Offene Anfragen werden geladen" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(ALL_CLEAR)).not.toBeInTheDocument();
  });

  it("meldet den Ausfall statt einer Entwarnung und lädt neu", async () => {
    fail("enrollment");

    render(<OpenRequestsBlock />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der offenen Anfragen"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(ALL_CLEAR)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(readers.enrollment!.refresh).toHaveBeenCalled());
    // Nur die ausgefallene Quelle lädt neu; die bestätigten bleiben.
    expect(readers.staffAbsences!.refresh).not.toHaveBeenCalled();
  });

  it("zeigt bekannte Aufgaben samt Link und den Teilausfall", async () => {
    set("changeRequests", { unreadCount: 2 });
    fail("staffAbsences");

    render(<OpenRequestsBlock />);

    expect(
      screen.getByRole("link", { name: /Wünsche von Eltern/ }),
    ).toHaveAttribute("href", "/test-tenant/anfragen");
    expect(screen.getByText("2 offen")).toBeInTheDocument();
    expect(
      await screen.findByText(
        catalogText("general.unavailable", "ein Teil der offenen Anfragen"),
      ),
    ).toBeInTheDocument();
    // Der Ausfall nennt keine Quelle.
    expect(screen.queryByText("Anträge des Teams")).not.toBeInTheDocument();
  });

  // Eine gesperrte oder nicht gebuchte Quelle zählt nicht mit und wird
  // nie als Fehler sichtbar.
  it("gibt Entwarnung, wenn die übrigen Quellen nicht gelten", () => {
    set("changeRequests", { state: "inactive" });
    set("enrollment", { state: "inactive" });
    set("unreadEnrollments", { state: "inactive" });

    render(<OpenRequestsBlock />);

    expect(screen.getByText(ALL_CLEAR)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("zeigt einen bestätigten Zähler trotz späterem Fehler weiter", () => {
    // `known` mit Fehler: die letzte Aktualisierung scheiterte, die Zahl
    // davor bleibt bestätigt.
    set("withdrawals", {
      unreadCount: 4,
      error: new ApiError("down", 503, { code: "general.unavailable" }),
    });

    render(<OpenRequestsBlock />);

    expect(screen.getByText("4 offen")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import deMessages from "~/i18n/messages/de.generated";
import { NOTIFICATION_FEED_REFRESH_EVENT } from "~/lib/notification-events";
import { getChildDayChanges } from "~/lib/parent-api";
import { formatDate } from "~/lib/date-helpers";
import { testClockDay } from "~/test/clock-instant";
import { ParentResourceTestProvider } from "~/test/parent-resource-provider";
import { ChildDayCard } from "./child-day-card";
import { ChildDayChanges, ChildDayChangesList } from "./child-day-changes";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

vi.unmock("swr");

vi.mock("~/lib/parent-api", () => ({ getChildDayChanges: vi.fn() }));
vi.mock("~/lib/parent-url", () => ({ parentPath: (path: string) => path }));

const mockedRead = vi.mocked(getChildDayChanges);

const loaded: parentMeContract.ChildDaySourceStatus[] = [
  { source: "children", status: "loaded" },
  { source: "closing_days", status: "loaded" },
  { source: "activities", status: "loaded" },
  { source: "classes", status: "loaded" },
];

function entry(
  overrides: Partial<parentMeContract.ChildDayChangeEntry>,
): parentMeContract.ChildDayChangeEntry {
  return {
    kind: "child_goes_alone",
    all_day: true,
    since: null,
    until: null,
    starts_at: null,
    ends_at: null,
    entered_by_you: false,
    child_status: null,
    pickup_time: null,
    pickup_person_name: null,
    pickup_person_one_time: false,
    activity_title: null,
    room_name: null,
    previous_room_name: null,
    closing_name: null,
    closing_traeger: false,
    class_name: null,
    class_time: null,
    ...overrides,
  };
}

function day(
  entries: parentMeContract.ChildDayChangeEntry[],
  sources = loaded,
): parentMeContract.ChildDayChangesResponse {
  return { date: testClockDay(), sources, entries };
}

function renderCard(changes: parentMeContract.ChildDayChangesResponse) {
  return render(
    <NextIntlClientProvider locale="de" messages={deMessages}>
      <ChildDayCard
        child={{ studentId: "42", firstName: "Felix", lastName: "Schneider" }}
        today={{ at_ogs: true, state: "present", since: "12:38" }}
        dayChanges={<ChildDayChangesList changes={changes} firstName="Felix" />}
      />
    </NextIntlClientProvider>,
  );
}

describe("ChildDayChangesList in der Tageskarte", () => {
  it("nennt jede Änderung in einfacher Sprache und markiert die eigenen", () => {
    const until = testClockDay(2);
    renderCard(
      day([
        entry({
          kind: "closing_day",
          closing_name: "Pädagogischer Tag",
          until,
        }),
        entry({
          kind: "child_absent",
          child_status: "sick",
          entered_by_you: true,
        }),
        entry({ kind: "child_pickup_changed", pickup_time: "14:00" }),
        entry({ kind: "child_goes_alone" }),
        entry({
          kind: "class_trip",
          class_name: "Klasse 2b",
          class_time: "13:30",
        }),
        entry({
          kind: "class_dismissal_changed",
          class_name: "2b",
          class_time: "11:30",
        }),
        entry({
          kind: "activity_cancelled",
          all_day: false,
          activity_title: "Basteln",
          starts_at: "2026-09-09T13:00:00Z",
        }),
        entry({
          kind: "activity_room_changed",
          all_day: false,
          activity_title: "Fußball",
          room_name: "Turnhalle",
          starts_at: "2026-09-09T12:00:00Z",
        }),
        entry({
          kind: "activity_lead_changed",
          all_day: false,
          activity_title: "Chor",
          starts_at: "2026-09-09T11:00:00Z",
        }),
      ]),
    );
    const section = screen.getByTestId("child-day-changes");
    expect(
      within(section).getByRole("heading", { name: "Heute anders" }),
    ).toBeInTheDocument();
    const items = within(section)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      `Die OGS ist bis ${formatDate(until)} geschlossen: Pädagogischer Tag.`,
      "Felix ist heute krank gemeldet.Von dir eingetragen",
      "Felix wird heute um 14:00 Uhr abgeholt.",
      "Felix geht heute allein nach Hause.",
      "Die Klasse 2b ist heute auf Ausflug. Zurück um 13:30 Uhr.",
      "Der Unterricht der Klasse 2b endet heute um 11:30 Uhr.",
      "Basteln um 15:00 Uhr fällt heute aus.",
      "Fußball um 14:00 Uhr findet heute in Turnhalle statt.",
      "Chor um 13:00 Uhr hat heute eine Vertretung.",
    ]);
    expect(screen.getAllByText("Von dir eingetragen")).toHaveLength(1);
    expect(
      screen.queryByText("Heute läuft alles wie geplant."),
    ).not.toBeInTheDocument();
  });

  // #8162: wer das Kind heute abholt, eine andere Person mit Ausweis.
  it("nennt die Abholperson des Tages", () => {
    renderCard(
      day([
        entry({
          kind: "child_pickup_person",
          pickup_person_name: "Tante Frieda",
          pickup_person_one_time: true,
          entered_by_you: true,
        }),
        entry({ kind: "child_pickup_person", pickup_person_name: "Oma Berta" }),
        entry({ kind: "child_pickup_person", pickup_person_name: null }),
      ]),
    );
    const items = within(screen.getByTestId("child-day-changes"))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "Tante Frieda holt Felix heute ab und zeigt dabei den Ausweis.Von dir eingetragen",
      "Oma Berta holt Felix heute ab.",
    ]);
  });

  it("sagt ohne Änderungen, dass alles wie geplant läuft", () => {
    renderCard(day([]));
    const section = screen.getByTestId("child-day-changes");
    expect(
      within(section).getByText("Heute läuft alles wie geplant."),
    ).toBeInTheDocument();
    expect(within(section).queryByRole("list")).not.toBeInTheDocument();
  });

  it("gibt bei einer fehlenden Quelle nie Entwarnung", () => {
    renderCard(
      day(
        [],
        [
          { source: "children", status: "loaded" },
          { source: "activities", status: "failed" },
        ],
      ),
    );
    const section = screen.getByTestId("child-day-changes");
    expect(
      within(section).getByText(/Nicht alle Änderungen konnten geladen werden/),
    ).toBeInTheDocument();
    expect(
      within(section).queryByText("Heute läuft alles wie geplant."),
    ).not.toBeInTheDocument();
  });
});

describe("ChildDayChanges", () => {
  beforeEach(() => {
    mockedRead.mockReset();
  });

  it("lädt die Änderungen des Kindes und lädt bei einem neuen Hinweis neu", async () => {
    mockedRead.mockResolvedValueOnce(day([]));
    mockedRead.mockResolvedValueOnce(
      day([entry({ kind: "child_goes_alone" })]),
    );
    render(
      <NextIntlClientProvider locale="de" messages={deMessages}>
        <ParentResourceTestProvider>
          <ChildDayChanges studentId="42" firstName="Felix" />
        </ParentResourceTestProvider>
      </NextIntlClientProvider>,
    );
    expect(
      await screen.findByText("Heute läuft alles wie geplant."),
    ).toBeInTheDocument();
    expect(mockedRead).toHaveBeenCalledWith("42");

    act(() => {
      window.dispatchEvent(new CustomEvent(NOTIFICATION_FEED_REFRESH_EVENT));
    });
    expect(
      await screen.findByText("Felix geht heute allein nach Hause."),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockedRead).toHaveBeenCalledTimes(2));
  });
});

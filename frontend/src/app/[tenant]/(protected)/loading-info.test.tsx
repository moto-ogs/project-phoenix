import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivitiesLoading from "./activities/loading";
import TransitLoading from "./rooms/unterwegs/loading";
import { ChangeHistorySkeleton } from "./students/[id]/change-history/page-skeleton";
import { FeedbackHistorySkeleton } from "./students/[id]/feedback-history/page-skeleton";
import { RoomHistorySkeleton } from "./students/[id]/room-history/page-skeleton";
import AccidentReportLoading from "./students/[id]/unfallanzeigen/[reportId]/loading";

const { nfcBookedState, presenceModeState, tenantState } = vi.hoisted(() => ({
  nfcBookedState: { value: true },
  presenceModeState: { value: "detailed" },
  tenantState: { value: { tenant: {} } },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "7" }),
}));

vi.mock("~/lib/tenant-context", () => ({
  useModuleBooked: () => nfcBookedState.value,
  usePresenceMode: () => presenceModeState.value,
  useTenantSafe: () => tenantState.value,
}));

vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({ info }: { info?: ReactNode }) => (
    <div data-testid="tenant-page" data-info={info} />
  ),
}));

vi.mock("~/components/ui/page-skeletons", () => ({
  ListSkeleton: () => null,
  SkeletonRegion: ({ children }: { children: ReactNode }) => <>{children}</>,
  TenantPageHeaderSkeleton: ({ info }: { info?: boolean }) => (
    <div data-testid="header-skeleton" data-info={info} />
  ),
}));

vi.mock("~/components/ui/data-table", () => ({
  DataTableSkeleton: () => null,
}));

vi.mock("~/components/ui/section-card", () => ({
  SectionCard: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/ui/skeleton", () => ({
  Skeleton: () => null,
}));

vi.mock("./students/[id]/student-history-loading-back", () => ({
  StudentHistoryLoadingBack: () => null,
}));

describe("Info-Knopf in Ladeansichten", () => {
  beforeEach(() => {
    nfcBookedState.value = true;
    presenceModeState.value = "detailed";
    tenantState.value = { tenant: {} };
  });

  it("zeigt für Aktivitäten den regulären Text", () => {
    render(<ActivitiesLoading />);

    expect(screen.getByTestId("tenant-page")).toHaveAttribute(
      "data-info",
      "Hier stehen die Aktivitäten, die am Tablet zur Wahl stehen. Eine neue erstellst du mit „Aktivität erstellen“, am Handy mit dem Plus. Eine eigene Aktivität öffnest du, um sie zu ändern.",
    );
  });

  it.each([
    ["das Modul fehlt", "detailed", false],
    ["einfache Anwesenheit", "binary", true],
  ])("zeigt für Aktivitäten den Abschalttext, wenn %s", (_, mode, booked) => {
    presenceModeState.value = mode;
    nfcBookedState.value = booked;
    render(<ActivitiesLoading />);

    expect(screen.getByTestId("tenant-page")).toHaveAttribute(
      "data-info",
      "Hier wären die Aktivitäten für das Tablet. Deine Schule nutzt sie zurzeit nicht.",
    );
  });

  it.each([
    [
      "detaillierte Anwesenheit",
      "detailed",
      "Hier stehen Kinder, die da sind, aber in keinem Raum. Darfst du sie zuweisen, wählst du sie aus und setzt sie in einen Raum.",
    ],
    [
      "einfache Anwesenheit",
      "binary",
      "Hier wären Kinder, die da sind, aber in keinem Raum. Deine Schule nutzt das zurzeit nicht.",
    ],
  ])("zeigt für Unterwegs den passenden Text bei %s", (_, mode, info) => {
    presenceModeState.value = mode;
    render(<TransitLoading />);

    expect(screen.getByTestId("tenant-page")).toHaveAttribute(
      "data-info",
      info,
    );
  });

  it("zeigt für Unfallanzeigen den Erklärungstext", () => {
    render(<AccidentReportLoading />);

    expect(screen.getByTestId("tenant-page")).toHaveAttribute(
      "data-info",
      "Hier steht die Unfallanzeige zu einem Unfall dieses Kindes. Unterschrieben wird sie unter „Unterschrift der Leitung“. Danach gibst du das PDF selbst an die Unfallkasse weiter.",
    );
  });

  it.each([
    ["Änderungsverlauf", ChangeHistorySkeleton],
    ["Feedbackhistorie", FeedbackHistorySkeleton],
    ["Anwesenheitsprotokoll", RoomHistorySkeleton],
  ])("reserviert im Skelett von %s den Info-Knopf", (_, Page) => {
    render(<Page />);

    expect(screen.getByTestId("header-skeleton")).toHaveAttribute(
      "data-info",
      "true",
    );
  });
});

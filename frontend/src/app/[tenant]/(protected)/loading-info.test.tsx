import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivitiesLoading from "./activities/loading";
import MessagesLoading from "./messages/loading";
import GroupMessagesLoading from "./messages/groups/loading";
import GroupMessageLoading from "./messages/groups/[groupThreadId]/loading";
import MessageThreadLoading from "./messages/[threadId]/loading";
import AnnouncementDetailLoading from "./parent-announcements/[id]/loading";
import { AnnouncementDetailLoadingPage } from "./parent-announcements/[id]/page-skeleton";
import TransitLoading from "./rooms/unterwegs/loading";
import { ChangeHistorySkeleton } from "./students/[id]/change-history/page-skeleton";
import { FeedbackHistorySkeleton } from "./students/[id]/feedback-history/page-skeleton";
import { RoomHistorySkeleton } from "./students/[id]/room-history/page-skeleton";
import AccidentReportLoading from "./students/[id]/unfallanzeigen/[reportId]/loading";
import WeekProtocolLoading from "./wochenprotokolle/[protocolId]/loading";

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

vi.mock("~/components/announcements/announcement-detail", () => ({
  AnnouncementDetailSkeleton: () => null,
}));

vi.mock("./messages/page-skeleton", () => ({
  MessagesSkeleton: () => null,
  ThreadSkeleton: () => null,
  ThreadComposerSkeleton: () => null,
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
    [
      "Nachrichten",
      MessagesLoading,
      "Hier schreibst du mit den Eltern der Kinder. Jede Unterhaltung gehört zu einer Person und ihrem Kind. Tippe auf eine Unterhaltung, um sie zu öffnen.",
    ],
    [
      "Unterhaltung",
      MessageThreadLoading,
      "Hier liest du die Unterhaltung mit den Eltern eines Kindes. Die neueste Nachricht steht unten. Wenn Eltern-Nachrichten eingeschaltet sind, kannst du darunter antworten.",
    ],
    [
      "Gruppennachrichten",
      GroupMessagesLoading,
      "Hier schreibst du allen Eltern einer Gruppe, Klasse oder AG auf einmal. Die Eltern antworten nur der OGS, nicht den anderen Familien. Ihre Antworten findest du unter „Unterhaltungen“.",
    ],
    [
      "Gruppennachricht",
      GroupMessageLoading,
      "Hier liest du die Nachricht an alle Eltern dieser Gruppe. Solange sie offen ist und Eltern-Nachrichten eingeschaltet sind, kannst du etwas dazuschreiben. Unter „Gelesen“ siehst du je Kind, ob ein Elternteil die neueste Nachricht gelesen hat.",
    ],
    [
      "Wochenprotokoll",
      WeekProtocolLoading,
      "Hier siehst du, was moto in dieser Woche festgehalten hat. Bei einem Entwurf kannst du mit „Ergänzen“ etwas dazuschreiben und es abschließen. Ein abgeschlossenes Protokoll lädst du als PDF herunter.",
    ],
  ] as ReadonlyArray<readonly [string, ComponentType, string]>)(
    "zeigt für %s denselben Erklärungstext während die Route lädt",
    (_, Page, info) => {
      render(<Page />);

      expect(screen.getByTestId("tenant-page")).toHaveAttribute(
        "data-info",
        info,
      );
    },
  );

  it("zeigt den Erklärungstext der Mitteilung im Routen- und SWR-Skelett", () => {
    const info =
      "Hier siehst du, was die Eltern bekommen. Unter dem Titel steht, ob es schon veröffentlicht ist. Unter „Zielgruppen und Zustellung“ steht, an wen es geht.";
    const { rerender } = render(<AnnouncementDetailLoading />);

    expect(screen.getByTestId("tenant-page")).toHaveAttribute(
      "data-info",
      info,
    );

    rerender(<AnnouncementDetailLoadingPage info={info} />);

    expect(screen.getByTestId("tenant-page")).toHaveAttribute(
      "data-info",
      info,
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

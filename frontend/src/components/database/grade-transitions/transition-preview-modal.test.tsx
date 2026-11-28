// #8214: Die Vorschau nennt die Klassen-Nachrichten an Eltern und die
// Entwürfe von Mitteilungen, die der Schuljahreswechsel mitnimmt oder
// schließt.
import { render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SWRConfig } from "~/lib/swr/testing";
import type {
  GradeTransition,
  TransitionPreview,
} from "~/lib/grade-transition-api";

vi.mock("vaul", () => import("~/test/mocks/vaul"));
vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "1", tenantId: "1", scope: "tenant" } },
    status: "authenticated",
  }),
}));

const { api } = vi.hoisted(() => ({
  api: { previewGradeTransition: vi.fn(), applyGradeTransition: vi.fn() },
}));
vi.mock("~/lib/grade-transition-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/grade-transition-api")>()),
  ...api,
}));

import { TransitionPreviewModal } from "./transition-preview-modal";

function render(ui: ReactElement) {
  return rtlRender(ui, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    ),
  });
}

const transition: GradeTransition = {
  id: "8",
  academicYear: "2026-2027",
  status: "draft",
  appliedAt: null,
  revertedAt: null,
  createdAt: "2026-07-24T09:00:00Z",
  notes: null,
  mappings: [
    { id: "1", fromClass: "3a", toClass: "4a", action: "promote" },
    { id: "2", fromClass: "4a", toClass: null, action: "graduate" },
  ],
  canModify: true,
  canApply: true,
  canRevert: false,
  version: "v1",
};

const preview = (
  parentTargets: TransitionPreview["parentTargets"],
): TransitionPreview => ({
  transitionId: "8",
  academicYear: "2026-2027",
  totalStudents: 2,
  toPromote: 1,
  toGraduate: 1,
  byMapping: [
    { fromClass: "3a", toClass: "4a", studentCount: 1, action: "promote" },
    { fromClass: "4a", toClass: null, studentCount: 1, action: "graduate" },
  ],
  unmappedClasses: [],
  warnings: [],
  fingerprint: "abc",
  parentTargets,
});

function renderPreview() {
  render(
    <TransitionPreviewModal
      transition={transition}
      canApply
      canEdit
      onClose={vi.fn()}
      onBackToEditor={vi.fn()}
      onApplied={vi.fn()}
    />,
  );
}

describe("TransitionPreviewModal: Nachrichten an Eltern (#8214)", () => {
  it("names every class message with its new class or that it closes", async () => {
    api.previewGradeTransition.mockResolvedValue(
      preview([
        {
          kind: "group_thread",
          id: "9",
          title: "Elternabend",
          fromClass: "3a",
          toClass: "4a",
        },
        {
          kind: "group_thread",
          id: "10",
          title: "Abschlussfest",
          fromClass: "4a",
          toClass: null,
        },
        {
          kind: "announcement_draft",
          id: "4",
          title: "Ausflug",
          fromClass: "4a",
          toClass: null,
        },
      ]),
    );
    renderPreview();

    const section = (
      await screen.findByRole("heading", { name: "Nachrichten an Eltern" })
    ).closest("section");
    expect(section).not.toBeNull();
    const rows = within(section as HTMLElement).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "ElternabendGruppennachricht3a -> 4a",
      "AbschlussfestGruppennachricht4a: wird geschlossen",
      "AusflugEntwurf einer Mitteilung4a: Klasse wird entfernt",
    ]);
    expect(
      within(section as HTMLElement).getByText(
        /Schon gesendete Nachrichten behalten ihre Empfänger/,
      ),
    ).toBeInTheDocument();
  });

  it("shows no section when no class message is affected", async () => {
    api.previewGradeTransition.mockResolvedValue(preview([]));
    renderPreview();

    expect(await screen.findByText("3a -> 4a")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Nachrichten an Eltern" }),
    ).not.toBeInTheDocument();
  });
});

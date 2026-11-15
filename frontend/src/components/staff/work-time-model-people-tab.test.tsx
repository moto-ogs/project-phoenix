import "@testing-library/jest-dom/vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkTimeModel } from "~/lib/staff-api";

import { WorkTimeModelPeopleTab } from "./work-time-model-people-tab";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => toast,
}));
vi.mock("~/components/ui/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

const workTimeModelService = vi.hoisted(() => ({
  assign: vi.fn(),
  staffFacts: vi.fn(),
  listWithUsage: vi.fn(),
}));
vi.mock("~/lib/staff-api", () => ({ workTimeModelService }));

const swr = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  mutate: vi.fn(() => Promise.resolve()),
  tenantMutate: vi.fn(() => Promise.resolve()),
  invalidate: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/swr", () => ({
  useSWRAuth: (key: string) => {
    const entry = Object.entries(swr.data).find(([prefix]) =>
      key.startsWith(prefix),
    );
    return {
      data: entry?.[1],
      error: undefined,
      isLoading: false,
      mutate: swr.mutate,
    };
  },
  useTenantMutate: () => swr.tenantMutate,
  useInvalidateMatching: () => swr.invalidate,
}));

function model(extra: Partial<WorkTimeModel> = {}): WorkTimeModel {
  return {
    id: "7",
    name: "Vollzeit 40 Stunden",
    rotationLength: 1,
    rotationAnchorDate: "2026-09-07",
    entries: [],
    weeklyTotals: [2400],
    archivedAt: null,
    assignedStaffCount: 1,
    ...extra,
  };
}

function person(id: string, name: string, extra: object = {}) {
  const [firstName, lastName] = name.split(" ");
  return {
    id,
    name,
    firstName,
    lastName,
    hasRfid: false,
    isTeacher: false,
    isSupervising: false,
    supervisions: [],
    ...extra,
  };
}

beforeEach(() => {
  swr.data = {
    "staff-directory-list-": [
      person("1", "Anna Becker", { role: "Erzieherin" }),
      person("2", "Ben Krüger"),
      person("3", "Clara Sommer"),
      person("4", "Dora Vertrag"),
      person("5", "Emil Extern", { isExternal: true }),
    ],
    "work-time-model-staff-facts": [
      {
        staffId: "1",
        workTimeModelId: "7",
        hasSchedule: true,
        sollKeptByTraeger: false,
        closedThrough: null,
      },
      {
        staffId: "2",
        workTimeModelId: null,
        hasSchedule: true,
        sollKeptByTraeger: false,
        closedThrough: null,
      },
      {
        staffId: "4",
        workTimeModelId: null,
        hasSchedule: true,
        sollKeptByTraeger: true,
        closedThrough: null,
      },
    ],
    "database-work-time-models": [model()],
  };
  workTimeModelService.assign.mockResolvedValue({
    assignedStaffIds: ["2", "3"],
    unchangedStaffIds: [],
    validFrom: "2026-09-09",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Personen zuordnen" }));
  return screen.getByRole("dialog", { name: "Personen zuordnen" });
}

function tileOf(dialog: HTMLElement, name: string) {
  return within(dialog).getByText(name).closest("label")!;
}

describe("Reiter „Personen“ einer Vorlage (#6921)", () => {
  it("lists who uses the template and offers everybody else, with the reason a person is blocked", () => {
    render(<WorkTimeModelPeopleTab model={model()} />);

    expect(screen.getByTestId("people-count")).toHaveTextContent(
      "1 Person nutzt diese Vorlage.",
    );
    expect(screen.getByText("Anna Becker")).toBeVisible();
    expect(screen.getByText("Erzieherin")).toBeVisible();

    const dialog = openDialog();
    expect(within(dialog).queryByText("Anna Becker")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Emil Extern")).not.toBeInTheDocument();
    expect(tileOf(dialog, "Ben Krüger")).toHaveTextContent("Eigenes Soll");
    expect(tileOf(dialog, "Clara Sommer")).toHaveTextContent("Noch kein Soll");
    const kept = within(tileOf(dialog, "Dora Vertrag")).getByRole("checkbox");
    expect(kept).toBeDisabled();
    expect(kept).toHaveAccessibleDescription(
      "Das Soll legt der Träger fest. Die Schule kann es nicht ändern.",
    );
  });

  it("assigns everybody chosen from today in one request and reloads the Soll views", async () => {
    render(<WorkTimeModelPeopleTab model={model()} />);
    const dialog = openDialog();
    const submit = within(dialog).getByRole("button", { name: "Zuordnen" });
    expect(submit).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Alle auswählen" }),
    );
    expect(screen.getByTestId("assign-summary")).toHaveTextContent(
      "2 Personen · ab heute",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "2 Personen zuordnen" }),
    );

    await waitFor(() =>
      expect(workTimeModelService.assign).toHaveBeenCalledWith(
        "7",
        ["2", "3"],
        undefined,
      ),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "„Vollzeit 40 Stunden“ gilt jetzt für 2 Personen ab heute.",
      ),
    );
    expect(swr.tenantMutate).toHaveBeenCalledWith("database-work-time-models");
    expect(swr.mutate).toHaveBeenCalled();
    expect(swr.invalidate).toHaveBeenCalled();
  });

  it("starts earlier only for a first Soll and only after the warning is confirmed", async () => {
    render(<WorkTimeModelPeopleTab model={model()} />);
    const dialog = openDialog();
    fireEvent.click(within(tileOf(dialog, "Ben Krüger")).getByRole("checkbox"));
    fireEvent.click(
      within(tileOf(dialog, "Clara Sommer")).getByRole("checkbox"),
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Früheres Datum" }),
    );

    expect(
      within(dialog).getByText("Rückwirkend kann es Minusstunden geben"),
    ).toBeVisible();
    const withSchedule = within(tileOf(dialog, "Ben Krüger")).getByRole(
      "checkbox",
    );
    expect(withSchedule).toBeDisabled();
    expect(withSchedule).not.toBeChecked();
    // Wer noch wählbar ist, steht oben; die Gesperrten folgen.
    const order = within(within(dialog).getByRole("list", { name: "Personen" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(order[0]).toContain("Clara Sommer");
    expect(order.slice(1).join()).toContain("Ben Krüger");
    expect(screen.getByTestId("assign-summary")).toHaveTextContent(
      "1 Person · ab dem 01.09.2026",
    );
    const submit = within(dialog).getByRole("button", {
      name: "1 Person zuordnen",
    });
    expect(submit).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "Ich ordne trotzdem rückwirkend zu.",
      }),
    );
    fireEvent.click(submit);

    await waitFor(() =>
      expect(workTimeModelService.assign).toHaveBeenCalledWith(
        "7",
        ["3"],
        "2026-09-01",
      ),
    );
  });

  it("offers no assignment for a template that is no longer offered", () => {
    render(
      <WorkTimeModelPeopleTab
        model={model({ archivedAt: "2026-09-01T08:00:00Z" })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Personen zuordnen" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(
        "Diese Vorlage wird nicht mehr angeboten. Wer sie nutzt, behält sie und ihr Soll.",
      ),
    ).toBeVisible();
  });
});

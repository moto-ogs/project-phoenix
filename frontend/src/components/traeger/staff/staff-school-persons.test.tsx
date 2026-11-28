import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { StaffEmployment } from "~/lib/traeger-staff-api";

const api = vi.hoisted(() => ({ adoptStaffPersonAtSchool: vi.fn() }));
vi.mock("~/lib/traeger-staff-api", async (original) => ({
  ...(await original<typeof import("~/lib/traeger-staff-api")>()),
  ...api,
}));

import { StaffSchoolPersons } from "./staff-school-persons";

function employment(
  schoolId: string,
  schoolName: string,
  schoolPerson: StaffEmployment["schoolPerson"],
): StaffEmployment {
  return {
    schoolId,
    schoolName,
    staffId: `${schoolId}1`,
    active: true,
    viaPool: false,
    employerName: "",
    employerBody: "",
    employerPersonnelNumber: null,
    employerNumberVersion: "",
    schoolPerson,
  };
}

const NORTH = employment("1", "OGS Nord", {
  firstName: "Mira",
  lastName: "Sommer",
  birthday: "",
  fields: ["first_name", "last_name", "birthday"],
});
const SOUTH = employment("2", "OGS Süd", null);

function renderList(
  employments: readonly StaffEmployment[],
  onAdopted = vi.fn().mockResolvedValue(undefined),
) {
  const view = render(
    <ToastProvider>
      <StaffSchoolPersons
        record={{ id: "5", personVersion: "person-v1", employments }}
        onAdopted={onAdopted}
      />
    </ToastProvider>,
  );
  return { onAdopted, unmount: view.unmount };
}

describe("StaffSchoolPersons (#8208)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names each school that keeps other values and what it keeps", () => {
    renderList([NORTH, SOUTH]);
    expect(
      screen.getByRole("heading", { name: "Andere Angaben an Schulen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Diese Schulen führen die Person anders als hier. moto ändert die Angaben der Schulen nicht von selbst.",
      ),
    ).toBeInTheDocument();
    const row = screen.getByText("OGS Nord").closest("li");
    expect(row).toHaveTextContent(
      "OGS Nord: Vorname „Mira“, Nachname „Sommer“, kein Geburtstag",
    );
    expect(screen.queryByText("OGS Süd")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /übernehmen/ })).toHaveLength(
      1,
    );
  });

  it("shows nothing when every school keeps the record's values", () => {
    const { unmount } = renderList([SOUTH]);
    expect(
      screen.queryByRole("heading", { name: "Andere Angaben an Schulen" }),
    ).not.toBeInTheDocument();
    unmount();
    renderList([NORTH, SOUTH]);
    // Anker: dieselbe Abfrage findet die Liste, sobald eine Schule abweicht.
    expect(
      screen.getByRole("heading", { name: "Andere Angaben an Schulen" }),
    ).toBeInTheDocument();
  });

  it("takes the record's values over into this school only and reloads", async () => {
    api.adoptStaffPersonAtSchool.mockResolvedValue(undefined);
    const { onAdopted } = renderList([NORTH, SOUTH]);
    fireEvent.click(
      screen.getByRole("button", { name: "Für OGS Nord übernehmen" }),
    );
    await waitFor(() => expect(onAdopted).toHaveBeenCalledTimes(1));
    expect(api.adoptStaffPersonAtSchool).toHaveBeenCalledWith(
      "5",
      "1",
      "person-v1",
    );
    expect(
      await screen.findByText(
        "OGS Nord führt die Person jetzt mit den Angaben aus der Akte.",
      ),
    ).toBeInTheDocument();
  });
});

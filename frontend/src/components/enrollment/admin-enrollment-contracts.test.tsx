import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useSWRAuth = vi.hoisted(() => vi.fn());
vi.mock("~/lib/swr", () => ({ useSWRAuth }));

import { ApiError } from "~/lib/api-error";
import type { ApplicationContractResponse } from "~/lib/contract/care-contracts.generated";
import type { AdminRequestChild } from "~/lib/enrollment-admin-api";
import { AdminEnrollmentContracts } from "./admin-enrollment-contracts";

function child(id: string, firstName: string): AdminRequestChild {
  return {
    id,
    first_name: firstName,
    last_name: "Muster",
    date_of_birth: "2019-04-01",
    status: "approved",
    activation_mode: "immediate",
  } as AdminRequestChild;
}

const children = [child("11", "Lina"), child("12", "Ben"), child("13", "Ida")];

function contract(
  overrides: Partial<ApplicationContractResponse>,
): ApplicationContractResponse {
  return {
    request_child_id: "11",
    contract_id: "7",
    status: "versendet",
    sent_at: "2026-09-01T08:00:00Z",
    concluded: null,
    ends_on: null,
    effective_from: "2026-09-14",
    services: [
      { weekday: "mon", module_name: "Früh", ends_at: "08:00", last_day: null },
      {
        weekday: "mon",
        module_name: "Ganztag",
        ends_at: "16:00",
        last_day: null,
      },
    ],
    ...overrides,
  };
}

// The school's read of the contracts of an application (#4788).
describe("AdminEnrollmentContracts", () => {
  beforeEach(() => {
    useSWRAuth.mockReset();
  });

  it("shows each child's contract state, booked care, and who acts next", () => {
    useSWRAuth.mockReturnValue({
      data: [
        contract({}),
        contract({
          request_child_id: "12",
          status: "aktiv",
          concluded: {
            method: "mit_anmeldung",
            at: "2026-09-02T07:15:00Z",
            date_unknown: false,
            taken_over: false,
          },
        }),
      ],
      error: undefined,
      mutate: vi.fn(),
    });
    render(<AdminEnrollmentContracts requestId="5" childList={children} />);

    expect(screen.getByText("Betreuungsverträge")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nur zur Ansicht. Die Verträge erstellt und verwaltet der Träger.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Versendet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Am 01.09.2026 an die Eltern geschickt. Die Eltern müssen ihn noch unterschreiben.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Aktiv")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Abgeschlossen: Am 02.09.2026 um 09:15 Uhr, bei der Annahme der Anmeldung.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Gebucht ab 14.09.2026: Mo bis 08:00 und 16:00"),
    ).toHaveLength(2);
    expect(
      screen.getByText("Noch kein Vertrag. Den Vertrag erstellt der Träger."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(useSWRAuth.mock.calls[0]?.[0]).toBe(
      "enrollment-request-contracts-5-11,12,13",
    );
  });

  it("stays away while no child has a contract", () => {
    useSWRAuth.mockReturnValue({ data: [], error: undefined, mutate: vi.fn() });
    const { container } = render(
      <AdminEnrollmentContracts requestId="5" childList={children} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the last day of each booked service", () => {
    useSWRAuth.mockReturnValue({
      data: [
        contract({
          services: [
            {
              weekday: "mon",
              module_name: "Früh",
              ends_at: "08:00",
              last_day: "2026-10-31",
            },
            {
              weekday: "mon",
              module_name: "Ganztag",
              ends_at: "16:00",
              last_day: "2026-11-30",
            },
          ],
        }),
      ],
      error: undefined,
      mutate: vi.fn(),
    });
    render(<AdminEnrollmentContracts requestId="5" childList={children} />);

    expect(
      screen.getByText(
        "Gebucht ab 14.09.2026: Mo bis 08:00, gebucht bis 31.10.2026 und 16:00, gebucht bis 30.11.2026",
      ),
    ).toBeInTheDocument();
  });

  it("uses a fresh cache entry when the enrollment's children change", () => {
    useSWRAuth.mockReturnValue({ data: [], error: undefined, mutate: vi.fn() });
    const { rerender } = render(
      <AdminEnrollmentContracts requestId="5" childList={[children[0]!]} />,
    );
    rerender(
      <AdminEnrollmentContracts
        requestId="5"
        childList={[children[0]!, children[1]!]}
      />,
    );

    expect(useSWRAuth.mock.calls.map(([key]) => key)).toEqual([
      "enrollment-request-contracts-5-11",
      "enrollment-request-contracts-5-11,12",
    ]);
  });

  it("stays away where the school did not book the module of the read", () => {
    useSWRAuth.mockReturnValue({
      data: undefined,
      error: new ApiError("not booked", 403, {
        code: "module.not_booked",
        details: { module: "online_anmeldung" },
      }),
      mutate: vi.fn(),
    });
    const { container } = render(
      <AdminEnrollmentContracts requestId="5" childList={children} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names a failed load", async () => {
    useSWRAuth.mockReturnValue({
      data: undefined,
      error: new ApiError("boom", 500, { code: "general.server" }),
      mutate: vi.fn(),
    });
    render(<AdminEnrollmentContracts requestId="5" childList={children} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

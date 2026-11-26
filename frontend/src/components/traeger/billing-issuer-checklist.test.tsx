import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingIssuerStatus as WireStatus } from "~/lib/contract/traeger-required-details.generated";
import { SWRConfig } from "~/lib/swr/testing";

const request = vi.hoisted(() => vi.fn());
vi.mock("~/lib/bff-fetch", () => ({ bffJson: request }));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "A",
        scope: "org",
        orgId: "7",
        permissions: ["traeger_overview:read"],
      },
    },
    status: "authenticated",
  }),
}));
afterEach(() => request.mockReset());

vi.unmock("swr");

import { BillingIssuerChecklists } from "./billing-issuer-checklist";

const SCHOOLS = [
  { schoolId: "3", schoolName: "Grundschule Hardt" },
  { schoolId: "4", schoolName: "Grundschule Am Wald" },
  { schoolId: "5", schoolName: "Grundschule Süchteln" },
];

const HARDT: WireStatus = {
  issuer: {
    key: "DE13ZZZ00000012345",
    body: "gemeinde",
    name: "Gemeinde Hardt",
  },
  school_ids: ["3", "4"],
  number_ranges: [
    { service: "holiday", pattern: "GH-F-{YYYY}-{NNNN}" },
    { service: "care", pattern: "" },
  ],
  document_kinds: [
    {
      service: "holiday",
      document_kind: "fee_notice",
      choices: ["fee_notice"],
      updated_at: null,
    },
    {
      service: "care",
      document_kind: "fee_notice",
      choices: ["fee_notice"],
      updated_at: null,
    },
  ],
  legal_remedy_missing: true,
  direct_debit_families: 7,
  families_without_mandate: 2,
  creditor_is_traegers: false,
};

function renderChecklists(schoolId?: string) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BillingIssuerChecklists schools={SCHOOLS} schoolId={schoolId} />
    </SWRConfig>,
  );
}

describe("BillingIssuerChecklists (#8040)", () => {
  it("names what a Gemeinde that bills its schools still needs and where to fix it", async () => {
    request.mockResolvedValue({ issuers: [HARDT] });
    renderChecklists();

    const card = (
      await screen.findByText("Abrechnung durch Gemeinde Hardt")
    ).closest("section");
    expect(card).not.toBeNull();
    const scope = within(card as HTMLElement);
    expect(request).toHaveBeenCalledWith(
      "org",
      "GET /traeger/required-details/issuers",
    );
    expect(
      scope.getByText(/für Grundschule Hardt, Grundschule Am Wald aus/),
    ).toBeInTheDocument();
    expect(scope.getByText("3 offen")).toBeInTheDocument();
    expect(
      scope.getByText(/Es fehlt das Muster für die Monatsbeiträge/),
    ).toBeInTheDocument();
    expect(
      scope.getByText(/Sie fehlt noch in der Vorlage „Bescheid“/),
    ).toBeInTheDocument();
    expect(
      scope.getByText(
        /2 von 7 Familien mit Lastschrift für die Monatsbeiträge brauchen ein neues Mandat für Gemeinde Hardt/,
      ),
    ).toBeInTheDocument();
    expect(
      scope.getByRole("link", { name: "Muster festlegen" }),
    ).toHaveAttribute("href", "/einstellungen/abrechnung");
    expect(
      scope.getByRole("link", { name: "Mandate ansehen" }),
    ).toHaveAttribute("href", "/abrechnung/lastschrift");
  });

  it("shows a body whose details are complete as done", async () => {
    request.mockResolvedValue({
      issuers: [
        {
          ...HARDT,
          number_ranges: [
            { service: "holiday", pattern: "GH-F-{NNNN}" },
            { service: "care", pattern: "GH-M-{NNNN}" },
          ],
          legal_remedy_missing: false,
          families_without_mandate: 0,
        },
      ],
    });
    renderChecklists();

    expect(await screen.findByText("Alles da")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Alle 7 Familien mit Lastschrift für die Monatsbeiträge haben ein gültiges Mandat/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Muster festlegen" }),
    ).not.toBeInTheDocument();
  });

  it("shows only the body of the school it is asked for", async () => {
    request.mockResolvedValue({
      issuers: [
        HARDT,
        {
          ...HARDT,
          issuer: {
            key: "DE57ZZZ00000067890",
            body: "schultraeger",
            name: "Kreis Viersen",
          },
          school_ids: ["5"],
        },
      ],
    });
    renderChecklists("5");

    expect(
      await screen.findByText("Abrechnung durch Kreis Viersen"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Abrechnung durch Gemeinde Hardt"),
    ).not.toBeInTheDocument();
  });
  it("asks for a creditor identifier of its own when a body names the Träger's", async () => {
    request.mockResolvedValue({
      issuers: [{ ...HARDT, creditor_is_traegers: true }],
    });
    renderChecklists();

    expect(
      await screen.findByText(/trägt die Gläubiger-ID deines Trägers/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Gläubiger-ID ändern" }),
    ).toHaveAttribute("href", "/schulen/3?bereich=zustaendigkeiten");
  });
});

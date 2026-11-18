import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { TraegerErrorFixTargetsProvider } from "./error-fix-targets";

const session = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "1", roles: [], permissions: session.permissions },
      expires: "",
    },
    status: "authenticated",
  }),
}));

// The test host is no Träger host, so the paths keep their prefix.
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

function refusal(code: string) {
  return { message: "Abgelehnt.", code, attempt: 1 };
}

describe("TraegerErrorFixTargetsProvider (#7092)", () => {
  afterEach(() => {
    session.permissions = [];
  });

  it.each([
    [
      "parent_billing.datev_not_ready",
      "traeger_settings:manage",
      "DATEV-Werte eintragen",
      "/traeger/einstellungen?bereich=datev",
    ],
    [
      "parent_billing.payment_text_debtor_number_missing",
      "traeger_settings:manage",
      "Zahlungstext öffnen",
      "/traeger/einstellungen?bereich=ferien",
    ],
    [
      "parent_billing.care_amendment_disabled",
      "traeger_settings:manage",
      "Einstellungen öffnen",
      "/traeger/einstellungen?bereich=monatsbeitrag",
    ],
    [
      "parent_billing.number_range_missing",
      "traeger_billing:manage",
      "Abrechnungsvorgaben öffnen",
      "/traeger/einstellungen/abrechnung",
    ],
    [
      "parent_billing.sepa_creditor_account_missing",
      "traeger_settings:manage",
      "Abrechnungsvorgaben öffnen",
      "/traeger/einstellungen/abrechnung",
    ],
    [
      "parent_billing.legal_remedy_missing",
      "traeger_settings:manage",
      "Vorlage öffnen",
      "/traeger/einstellungen/briefkopf/vorlagen/bescheid",
    ],
    [
      "care_contract.letterhead_too_long",
      "traeger_settings:manage",
      "Briefkopf öffnen",
      "/traeger/einstellungen/briefkopf",
    ],
    [
      "parent_billing.export_recipient_not_ready",
      "traeger_billing:manage",
      "Empfänger prüfen",
      "/traeger/abrechnung/exporte/empfaenger",
    ],
  ])("leads %s to its place with %s", (code, right, label, href) => {
    session.permissions = [right];

    render(
      <TraegerErrorFixTargetsProvider>
        <LoadErrorAlert error={refusal(code)} />
      </TraegerErrorFixTargetsProvider>,
    );

    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      href,
    );
  });

  it("shows no link without the right for the target", () => {
    session.permissions = ["traeger_settings:manage"];

    render(
      <TraegerErrorFixTargetsProvider>
        <FormErrorAlert
          message={refusal("parent_billing.number_range_missing")}
        />
      </TraegerErrorFixTargetsProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Abgelehnt.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens the place in a new tab from a dialog, so the input stays", () => {
    session.permissions = ["traeger_settings:manage"];

    render(
      <TraegerErrorFixTargetsProvider>
        <FormModal
          isOpen
          onClose={() => {}}
          title="Schreiben erstellen"
          error={refusal("parent_billing.bank_account_missing")}
        >
          <p>Inhalt</p>
        </FormModal>
      </TraegerErrorFixTargetsProvider>,
    );

    const link = screen.getByRole("link", {
      name: "Abrechnungsvorgaben öffnen, neuer Tab",
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("href", "/traeger/einstellungen/abrechnung");
  });
});

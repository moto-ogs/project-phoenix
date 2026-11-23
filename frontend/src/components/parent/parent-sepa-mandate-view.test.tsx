import { useSWRAuth } from "~/lib/swr";
import { parentInboxKeys } from "~/lib/swr/parent-inbox-keys";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ParentResourceTestProvider } from "~/test/parent-resource-provider";

vi.unmock("swr");
import { ApiError } from "~/lib/api-error";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { deferred } from "~/test/helpers/form-modal-pending";
import { catalogText } from "~/test/error-catalog-text";
import type {
  SepaMandateText,
  SepaMandateView,
} from "~/lib/parent-sepa-mandate-api";
import { ParentSepaMandateEntry } from "./parent-sepa-mandate-entry";
import { ParentSepaMandateView } from "./parent-sepa-mandate-view";
import {
  expectPageReloadedAfterRefusal,
  resetPageReloads,
} from "~/test/helpers/refused-refresh";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  preview: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("~/lib/parent-sepa-mandate-api", () => ({
  fetchSepaMandate: mocks.fetch,
  previewSepaMandate: mocks.preview,
  grantSepaMandate: mocks.grant,
  revokeSepaMandate: mocks.revoke,
}));

let retryMandateRead!: () => Promise<boolean>;
vi.mock("~/lib/hooks/use-refresh-after-write", async (original) => {
  const actual =
    await original<typeof import("~/lib/hooks/use-refresh-after-write")>();
  return {
    ...actual,
    useRefreshAfterWrite: (
      ...args: Parameters<typeof actual.useRefreshAfterWrite>
    ) => {
      const result = actual.useRefreshAfterWrite(...args);
      retryMandateRead = result.refresh;
      return result;
    },
  };
});

const IBAN = "DE89370400440532013000";

const open: SepaMandateView = {
  enabled: true,
  canManage: true,
  creditorMissing: false,
  creditor: {
    name: "Jugendring Muster",
    address: "Hauptstraße 1, 75175 Pforzheim",
    creditorId: "DE98ZZZ09999999999",
  },
  mandate: null,
  prefill: {
    accountHolder: "Eva Muster",
    street: "",
    postalCode: "",
    city: "",
  },
};

const text: SepaMandateText = {
  version: "sepa-core-de-1",
  reference: "MOTO-75-20260909-1A2B",
  text: "SEPA-Lastschriftmandat\n\nMandatsreferenz: MOTO-75-20260909-1A2B",
  textSha256: "a".repeat(64),
  accountToken: "sealed-preview-account",
};

const granted: SepaMandateView = {
  ...open,
  prefill: null,
  mandate: {
    collectionEligible: true,
    id: "9",
    version: "v-9",
    reference: text.reference,
    signedOn: "2026-09-09",
    accountHolder: "Eva Muster",
    ibanMasked: "DE•• •••• •••• •••• ••30 00",
    bic: "",
    source: "parent",
    creditorId: "DE98ZZZ09999999999",
    revokedOn: null,
    proof: {
      channel: "parent_account",
      version: text.version,
      textSha256: text.textSha256,
      text: text.text,
      confirmedAt: "2026-09-09T10:00:00Z",
    },
  },
};

function renderView() {
  return render(
    <ParentResourceTestProvider>
      <ToastProvider>
        <ParentSepaMandateView organizationId="4" contractId="75" />
      </ToastProvider>
    </ParentResourceTestProvider>,
  );
}

async function fillAccount() {
  fireEvent.change(await screen.findByLabelText(/^IBAN/), {
    target: { value: IBAN },
  });
  fireEvent.change(screen.getByLabelText(/Straße und Hausnummer/), {
    target: { value: "Gartenweg 2" },
  });
  fireEvent.change(screen.getByLabelText(/^PLZ/), {
    target: { value: "75175" },
  });
  fireEvent.change(screen.getByLabelText(/^Ort/), {
    target: { value: "Pforzheim" },
  });
}

describe("ParentSepaMandateView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the mandate again on every opening to record access", async () => {
    mocks.fetch.mockResolvedValueOnce(granted);
    const next = deferred<SepaMandateView>();
    mocks.fetch.mockReturnValueOnce(next.promise);
    const view = renderView();
    expect(await screen.findByText(granted.mandate!.ibanMasked)).toBeVisible();
    const reopen = (
      <ParentResourceTestProvider>
        <ToastProvider>
          <ParentSepaMandateView organizationId="4" contractId="75" />
        </ToastProvider>
      </ParentResourceTestProvider>
    );
    view.rerender(
      <ParentResourceTestProvider>
        <ToastProvider>{null}</ToastProvider>
      </ParentResourceTestProvider>,
    );
    view.rerender(reopen);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText(granted.mandate!.ibanMasked),
    ).not.toBeInTheDocument();
    await act(async () => {
      next.resolve(granted);
    });
    expect(await screen.findByText(granted.mandate!.ibanMasked)).toBeVisible();
  });

  it("never restores a refused mandate after a later server failure", async () => {
    mocks.fetch.mockResolvedValue(granted);
    let reload!: () => Promise<unknown>;
    function Probe() {
      const { mutate } = useSWRAuth(
        parentInboxKeys.sepaMandate("4", "75"),
        () => mocks.fetch(),
      );
      reload = () => mutate();
      return null;
    }
    render(
      <ParentResourceTestProvider>
        <ToastProvider>
          <ParentSepaMandateView organizationId="4" contractId="75" />
          <Probe />
        </ToastProvider>
      </ParentResourceTestProvider>,
    );
    expect(await screen.findByText(granted.mandate!.ibanMasked)).toBeVisible();
    mocks.fetch.mockRejectedValueOnce(
      new ApiError("gone", 404, {
        code: "parent_billing.parent_document_not_found",
      }),
    );
    await act(async () => {
      await reload();
    });
    expect(
      await screen.findByText(
        catalogText(
          "parent_billing.parent_document_not_found",
          "das Lastschrift-Mandat",
        ),
      ),
    ).toBeVisible();
    mocks.fetch.mockRejectedValueOnce(new ApiError("down", 500));
    await act(async () => {
      await reload();
    });
    // Anker: der Ladefehler bleibt sichtbar, keine Finanzdaten ohne erfolgreichen Abruf.
    expect(
      screen.getByText(
        catalogText(
          "parent_billing.parent_document_not_found",
          "das Lastschrift-Mandat",
        ),
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(granted.mandate!.ibanMasked),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mandat widerrufen" }),
    ).not.toBeInTheDocument();
    mocks.fetch.mockResolvedValue(granted);
    await act(async () => {
      await reload();
    });
    expect(await screen.findByText(granted.mandate!.ibanMasked)).toBeVisible();
  });

  it("only points to paper while the Träger has the switch off", async () => {
    mocks.fetch.mockResolvedValue({ ...open, enabled: false });
    renderView();
    expect(
      await screen.findByText(/Frage den Träger nach einem Formular/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Weiter" }),
    ).not.toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledWith("4", "75");
  });

  it("checks the account before it asks for the text", async () => {
    mocks.fetch.mockResolvedValue(open);
    renderView();
    fireEvent.change(await screen.findByLabelText(/^IBAN/), {
      target: { value: "DE00123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    expect(
      await screen.findByText(
        "Diese IBAN stimmt nicht. Bitte prüfe jede Ziffer.",
      ),
    ).toBeInTheDocument();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("gives exactly the confirmed text, and only as account holder", async () => {
    mocks.fetch.mockResolvedValue(open);
    mocks.preview.mockResolvedValue(text);
    mocks.grant.mockResolvedValue(granted);
    renderView();
    await fillAccount();
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    const grant = await screen.findByRole("button", {
      name: "Mandat erteilen",
    });
    expect(screen.getByText(/Mandatsreferenz: MOTO-75/)).toBeInTheDocument();

    fireEvent.click(grant);
    const form = grant.closest("form") as HTMLFormElement;
    expect(await within(form).findByRole("alert")).toBeInTheDocument();
    expect(mocks.grant).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Ich bin Inhaberin oder Inhaber dieses Kontos/,
      }),
    );
    fireEvent.click(grant);
    expect(await screen.findByText("Dein Mandat")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Du erlaubst deinem Träger, Beiträge von diesem Konto abzubuchen. Wie du bezahlst, steht auf deiner Rechnung.",
      ),
    ).toBeInTheDocument();
    expect(mocks.grant).toHaveBeenCalledWith(
      "4",
      "75",
      expect.objectContaining({
        accountHolder: "Eva Muster",
        city: "Pforzheim",
      }),
      expect.objectContaining({
        reference: text.reference,
        textSha256: text.textSha256,
        accountToken: text.accountToken,
      }),
    );
    expect(screen.queryByText(IBAN)).not.toBeInTheDocument();
    expect(screen.getByText("DE•• •••• •••• •••• ••30 00")).toBeInTheDocument();
  });

  it("shows the new text when the old one no longer holds", async () => {
    mocks.fetch.mockResolvedValue(open);
    mocks.preview.mockResolvedValueOnce(text).mockResolvedValueOnce({
      ...text,
      text: "Neuer Text",
      textSha256: "b".repeat(64),
    });
    mocks.grant.mockRejectedValue(
      Object.assign(new ApiError("changed", 409), {
        code: "parent_billing.sepa_mandate_text_changed",
      }),
    );
    renderView();
    await fillAccount();
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /Ich bin Inhaberin oder Inhaber dieses Kontos/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mandat erteilen" }));
    expect(await screen.findByText("Neuer Text")).toBeInTheDocument();
    expect(screen.getByText(/Der Text hat sich geändert/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: /Ich bin Inhaberin oder Inhaber dieses Kontos/,
      }),
    ).not.toBeChecked();
  });

  // #7111: each step replaced the last one without moving the focus.
  it("focuses the heading of each new step", async () => {
    mocks.fetch.mockResolvedValueOnce(open).mockResolvedValueOnce(open);
    mocks.preview.mockResolvedValue(text);
    mocks.grant.mockResolvedValue(granted);
    mocks.revoke.mockResolvedValue({
      ...granted,
      mandate: { ...granted.mandate!, revokedOn: "2026-09-10" },
    });
    renderView();
    await fillAccount();
    // Loading the page is no step: nothing takes the focus.
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Schritt 2 von 2: Mandat bestätigen",
        }),
      ).toHaveFocus(),
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Ich bin Inhaberin oder Inhaber dieses Kontos/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mandat erteilen" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Dein Mandat" }),
      ).toHaveFocus(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Mandat widerrufen" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Widerrufen" }));
    const first = await screen.findByRole("heading", {
      name: "Schritt 1 von 2: Konto angeben",
    });
    await waitFor(() => expect(first).toHaveFocus());
  });

  it("revokes the mandate after a confirmation", async () => {
    mocks.fetch.mockResolvedValueOnce(granted).mockResolvedValueOnce(open);
    mocks.revoke.mockResolvedValue(granted);
    renderView();
    fireEvent.click(
      await screen.findByRole("button", { name: "Mandat widerrufen" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Ab der nächsten Rechnung/),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Widerrufen" }));
    expect(
      await screen.findByRole("button", { name: "Weiter" }),
    ).toBeInTheDocument();
    expect(mocks.revoke).toHaveBeenCalledWith("4", "75", "v-9");
  });

  it("shows the mandate given since instead of revoking it unseen", async () => {
    const replaced: SepaMandateView = {
      ...granted,
      mandate: {
        ...granted.mandate!,
        id: "12",
        version: "v-12",
        ibanMasked: "DE•• •••• •••• •••• ••77 00",
      },
    };
    mocks.fetch.mockResolvedValueOnce(granted).mockResolvedValueOnce(replaced);
    mocks.revoke.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    renderView();
    fireEvent.click(
      await screen.findByRole("button", { name: "Mandat widerrufen" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Widerrufen" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "das Lastschrift-Mandat"),
      ),
    ).toBeVisible();
    expect(mocks.revoke).toHaveBeenCalledWith("4", "75", "v-9");
    expect(await screen.findByText(replaced.mandate!.ibanMasked)).toBeVisible();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: /Erneut versuchen|Wiederholen/ }),
    ).not.toBeInTheDocument();
  });
});

// #6652: the revocation holds once the write is through; a failed reload
// keeps the mandate card and says the change is saved.
describe("Reload after the revocation (#6652)", () => {
  beforeEach(() => vi.clearAllMocks());

  // #6801: a refused reload loads the page anew; its first load shows the
  // refusal without the mandate.
  it("loads the page anew when the reload refuses access (403)", async () => {
    mocks.fetch
      .mockResolvedValueOnce(granted)
      .mockRejectedValueOnce(
        new ApiError("refused", 403, { code: "general.permission" }),
      )
      .mockResolvedValue(open);
    mocks.revoke.mockResolvedValue(granted);
    renderView();
    expect(await screen.findByText(granted.mandate!.ibanMasked)).toBeVisible();
    resetPageReloads();
    fireEvent.click(screen.getByRole("button", { name: "Mandat widerrufen" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Widerrufen",
      }),
    );

    await expectPageReloadedAfterRefusal();
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
  });

  it.each([[404, "parent_billing.parent_document_not_found"]] as const)(
    "hides the mandate and its actions when the reload no longer finds it (%s)",
    async (status, code) => {
      mocks.fetch
        .mockResolvedValueOnce(granted)
        .mockRejectedValueOnce(new ApiError("refused", status, { code }))
        .mockResolvedValue(open);
      mocks.revoke.mockResolvedValue(granted);
      renderView();
      expect(
        await screen.findByText(granted.mandate!.ibanMasked),
      ).toBeVisible();
      fireEvent.click(
        screen.getByRole("button", { name: "Mandat widerrufen" }),
      );
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Widerrufen",
        }),
      );

      // Anker: die gespeicherte Änderung wird auch ohne Mandatsdaten bestätigt.
      expect(
        await screen.findByText(
          `${catalogText(code, "die Anzeige des Mandats")} ${SAVED_BUT_STALE_SUFFIX}`,
        ),
      ).toBeVisible();
      expect(
        screen.queryByText(granted.mandate!.ibanMasked),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Eva Muster")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Mandat widerrufen" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Als Datei speichern" }),
      ).not.toBeInTheDocument();
      await act(async () => {
        await retryMandateRead();
      });
      expect(await screen.findByLabelText(/^IBAN/)).toBeVisible();
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
      expect(mocks.revoke).toHaveBeenCalledTimes(1);
    },
  );

  it.each([true, false])(
    "keeps the revocation when the reload fails (can manage: %s)",
    async (canManage) => {
      mocks.fetch
        .mockResolvedValueOnce(granted)
        .mockRejectedValueOnce(
          new ApiError("down", 503, { code: "general.unavailable" }),
        )
        .mockResolvedValue(open);
      mocks.revoke.mockResolvedValue({
        ...open,
        canManage,
        mandate: { ...granted.mandate, revokedOn: "2026-09-09" },
      });
      renderView();
      fireEvent.click(
        await screen.findByRole("button", { name: "Mandat widerrufen" }),
      );
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Widerrufen" }),
      );

      expect(
        await screen.findByText(
          `${catalogText("general.unavailable", "die Anzeige des Mandats")} ${SAVED_BUT_STALE_SUFFIX}`,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Mandat widerrufen" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(granted.mandate!.ibanMasked),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
      expect(
        await screen.findByRole("button", { name: "Weiter" }),
      ).toBeInTheDocument();
      expect(mocks.revoke).toHaveBeenCalledTimes(1);
    },
  );
});

describe("Mandate collection status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps proof and revocation available when a replacement is needed", async () => {
    mocks.fetch.mockResolvedValue({
      ...granted,
      mandate: { ...granted.mandate, collectionEligible: false },
    });
    renderView();
    expect(await screen.findByText("Neues Mandat nötig")).toBeInTheDocument();
    expect(screen.queryByText(/Gültig seit/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Ihr Träger bucht die Beiträge von diesem Konto ab."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mandat widerrufen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Als Datei speichern" }),
    ).toBeInTheDocument();
  });

  it("uses only the inbox status for links and eligible badges", async () => {
    mocks.fetch.mockResolvedValue(granted);
    const { rerender } = render(
      <ParentSepaMandateEntry
        organizationId="4"
        contractId="75"
        status={{ enabled: true, collection_eligible: true }}
      />,
    );
    expect(
      await screen.findByRole("link", { name: "Lastschrift" }),
    ).toHaveAttribute("href", expect.stringContaining("/4/75?lastschrift=1"));
    expect(screen.getByText("Lastschrift erteilt")).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
    rerender(
      <ParentSepaMandateEntry
        organizationId="4"
        contractId="75"
        status={{ enabled: true, collection_eligible: false }}
      />,
    );
    expect(screen.queryByText("Lastschrift erteilt")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Lastschrift" }),
    ).toBeInTheDocument();
    rerender(
      <ParentSepaMandateEntry
        organizationId="4"
        contractId="75"
        status={{ enabled: false, collection_eligible: false }}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

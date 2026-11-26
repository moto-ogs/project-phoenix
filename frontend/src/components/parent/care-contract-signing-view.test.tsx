import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import type { SigningView } from "~/lib/care-contract-signing-api";
import { ContractSigningView } from "./care-contract-signing-view";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), sign: vi.fn() }));
// The mail link has no session; the inbox refresh then does nothing.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("~/lib/care-contract-signing-api", () => ({
  fetchSigningView: mocks.fetch,
  signContract: mocks.sign,
  signingDocumentUrl: () => "/contract.pdf",
  // The PDF is not part of these cases: its request never answers.
  fetchSigningDocument: () => new Promise(() => undefined),
}));
vi.mock("./parent-family-children-card", () => ({
  ParentFamilyChildrenCard: () => null,
}));

const view: SigningView = {
  status: "versendet",
  traegerName: "Jugendring Muster",
  partyName: "Eva Muster",
  childName: "Ben Muster",
  schoolName: "OGS Nord",
  phaseName: "Schuljahr 2026/27",
  effectiveFrom: "2026-10-01",
  endsOn: null,
  priceCents: null,
  services: [],
  documentSha256: "a".repeat(64),
  withdrawalNotice: ["Sie können den Vertrag widerrufen."],
  signature: null,
  awaitsSignature: true,
  previous: null,
};

function renderView() {
  return render(
    <ContractSigningView source={{ kind: "link", link: "abc" }} />,
    { wrapper: ToastProvider },
  );
}

const submit = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Vertrag verbindlich unterschreiben" }),
  );

// #7111: a missing signature showed its hint, but the focus stayed on the
// send button and the form's alert path was unused.
describe("ContractSigningView focus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(view);
  });

  it("focuses the first missing field and names the problem", async () => {
    renderView();
    await screen.findByRole("button", {
      name: "Vertrag verbindlich unterschreiben",
    });

    submit();

    const notice = screen.getByRole("checkbox", {
      name: /Widerrufsbelehrung gelesen/,
    });
    await waitFor(() => expect(notice).toHaveFocus());
    expect(notice).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bitte prüfe die markierten Felder.",
    );
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("focuses the signature when only the signature is missing", async () => {
    renderView();
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /Widerrufsbelehrung gelesen/,
      }),
    );

    submit();

    const pad = screen.getByRole("group", { name: "Deine Unterschrift" });
    await waitFor(() => expect(pad).toHaveFocus());
    expect(pad).toHaveAccessibleDescription(
      "Bitte unterschreibe und bestätige die Unterschrift.",
    );
  });

  it("focuses the confirmation once the contract is signed", async () => {
    mocks.sign.mockResolvedValue({
      ...view,
      status: "aktiv",
      awaitsSignature: false,
      signature: {
        method: "typed",
        signerName: "Eva Muster",
        signedAt: "2026-09-09T10:00:00Z",
        earlyStartRequested: false,
        withdrawalEndsOn: null,
      },
    });
    renderView();
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /Widerrufsbelehrung gelesen/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Namen tippen" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Unterschrift bestätigen" }),
    );

    submit();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Vielen Dank. Der Vertrag ist unterschrieben.",
        }),
      ).toHaveFocus(),
    );
  });
});

// #4816: a changed version of a contract in force waits for the signature.
// The parents see what changes before they sign.
describe("ContractSigningView for a changed version", () => {
  const monday = {
    weekday: "mon",
    moduleName: "Ganztag",
    endsAt: "16:00",
    lastDay: null,
  } as const;
  const change: SigningView = {
    ...view,
    status: "aktiv",
    priceCents: 12000,
    services: [
      monday,
      {
        ...monday,
        weekday: "tue",
        moduleName: "Spätbetreuung",
        endsAt: "17:00",
      },
      { ...monday, weekday: "thu" },
    ],
    previous: {
      effectiveFrom: "2026-08-01",
      endsOn: null,
      priceCents: 9500,
      services: [
        monday,
        { ...monday, weekday: "tue" },
        { ...monday, weekday: "wed" },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(change);
  });

  it("shows per weekday what changes and that the contract holds until the signature", async () => {
    renderView();

    expect(
      await screen.findByRole("heading", {
        name: "Neue Fassung für Ben Muster",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Bis du unterschreibst, gilt dein Vertrag wie bisher\./),
    ).toBeInTheDocument();
    // The test catalog does not resolve plurals: the count is the message.
    expect(screen.getByText(/Tage ändern sich/)).toBeInTheDocument();
    const row = (weekday: string) => {
      const item = screen.getByText(weekday).closest("li");
      if (!item) throw new Error(`no row for ${weekday}`);
      return item;
    };
    expect(row("Montag")).toHaveTextContent("Ganztag · bis 16:00 Uhr");
    expect(row("Montag")).not.toHaveTextContent("Bisher");
    expect(row("Dienstag")).toHaveTextContent(
      /Bisher:\s*Ganztag · bis 16:00 Uhr.*Neu:\s*Spätbetreuung · bis 17:00 Uhr/,
    );
    expect(row("Dienstag")).toHaveTextContent("Geändert");
    expect(row("Mittwoch")).toHaveTextContent(/Neu:\s*Keine Betreuung/);
    expect(row("Mittwoch")).toHaveTextContent("Entfällt");
    expect(row("Donnerstag")).toHaveTextContent(/Bisher:\s*Keine Betreuung/);
    // The fee before stands struck through in front of the new one.
    expect(screen.getByText(/95,00/)).toBeInTheDocument();
    expect(screen.getByText(/120,00/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Neue Fassung verbindlich unterschreiben",
      }),
    ).toBeInTheDocument();
  });

  it("confirms the signed new version", async () => {
    mocks.sign.mockResolvedValue({
      ...change,
      awaitsSignature: false,
      previous: null,
      signature: {
        method: "drawn",
        signerName: "Eva Muster",
        signedAt: "2026-09-09T10:00:00Z",
        earlyStartRequested: false,
        withdrawalEndsOn: null,
      },
    });
    renderView();
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /Widerrufsbelehrung gelesen/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Namen tippen" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Unterschrift bestätigen" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Neue Fassung verbindlich unterschreiben",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Vielen Dank. Die neue Fassung ist unterschrieben.",
      }),
    ).toBeInTheDocument();
  });

  it("explains a version the parents asked for themselves", async () => {
    mocks.fetch.mockResolvedValue({
      ...change,
      awaitsSignature: false,
      previous: null,
      signature: {
        method: "request",
        signerName: "Eva Muster",
        signedAt: "2026-09-01T10:00:00Z",
        earlyStartRequested: false,
        withdrawalEndsOn: null,
      },
    });
    renderView();

    expect(
      await screen.findByRole("heading", {
        name: "Diese Fassung gilt. Du musst nichts unterschreiben.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Dein Antrag vom 01\.09\.2026 gilt als deine Zustimmung\./,
      ),
    ).toBeInTheDocument();
  });
});

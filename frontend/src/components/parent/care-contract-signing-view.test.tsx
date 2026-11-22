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

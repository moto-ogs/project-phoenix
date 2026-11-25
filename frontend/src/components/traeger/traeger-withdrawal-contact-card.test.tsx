import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { catalogText } from "~/test/error-catalog-text";

// The link to the letterhead page needs no portal host here.
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path,
}));
const { mockSave } = vi.hoisted(() => ({ mockSave: vi.fn() }));
vi.mock("~/lib/traeger-api", () => ({
  saveTraegerWithdrawalContact: mockSave,
}));

import { TraegerWithdrawalContactCard } from "./traeger-withdrawal-contact-card";

const CONTACT = {
  name: "Petra Lindner",
  phone: "0211 123 45",
  email: "p.lindner@traeger.example",
};
const LETTERHEAD = "Ganztag im Quartier e.V.\nAm Markt 4\n40210 Düsseldorf";

function card(
  withdrawal = { phone: "", email: "" },
  contact = CONTACT,
  canEdit = true,
  letterheadText = LETTERHEAD,
) {
  return (
    <ToastProvider>
      <TraegerWithdrawalContactCard
        version="w-1"
        reload={vi.fn()}
        withdrawal={withdrawal}
        contact={contact}
        letterheadText={letterheadText}
        canEdit={canEdit}
        onSaved={() => Promise.resolve()}
      />
    </ToastProvider>
  );
}

const resolved = () => Promise.resolve();

/** The page: its read takes the save's answer (ADR 0311, rule 5). */
function Page({
  onSaved = resolved,
}: Readonly<{ onSaved?: () => Promise<unknown> }>) {
  const [read, setRead] = useState({
    value: { phone: "", email: "" },
    version: "w-1",
  });
  return (
    <ToastProvider>
      <TraegerWithdrawalContactCard
        withdrawal={read.value}
        version={read.version}
        reload={vi.fn()}
        write={(saved) => {
          setRead(saved);
          return Promise.resolve();
        }}
        contact={CONTACT}
        letterheadText={LETTERHEAD}
        canEdit
        onSaved={onSaved}
      />
    </ToastProvider>
  );
}

function preview() {
  return within(
    screen.getByRole("figure", { name: "Vorschau der Widerrufsbelehrung" }),
  );
}

describe("TraegerWithdrawalContactCard", () => {
  it("shows the contact person's phone and e-mail in the notice while the fields are empty", () => {
    render(card());

    expect(screen.getByLabelText("Telefon für Widerrufe")).toHaveAttribute(
      "placeholder",
      "0211 123 45",
    );
    expect(
      screen.getByText(
        "Leer lassen: Dann steht hier 0211 123 45 von der Ansprechperson.",
      ),
    ).toBeInTheDocument();
    expect(
      preview().getByText(
        "Ganztag im Quartier e.V., Am Markt 4, 40210 Düsseldorf, Telefon: 0211 123 45, E-Mail: p.lindner@traeger.example",
      ),
    ).toBeInTheDocument();
    expect(preview().getAllByText("Von der Ansprechperson")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
  });

  // #8131: name and address come from the letterhead, never from the
  // contact person; the preview says so at the values and leads there.
  it("shows that name and address come from the letterhead and links there", () => {
    render(card());

    expect(preview().getByText("Name und Anschrift")).toBeInTheDocument();
    expect(preview().getByText("Ganztag im Quartier e.V.")).toBeInTheDocument();
    expect(
      preview().getByText("Am Markt 4, 40210 Düsseldorf"),
    ).toBeInTheDocument();
    expect(preview().getByText("Aus dem Briefkopf")).toBeInTheDocument();
    const link = preview().getByRole("link", {
      name: "Im Briefkopf ändern, neuer Tab",
    });
    expect(link).toHaveAttribute("href", "/traeger/einstellungen/briefkopf");
    expect(link).toHaveAttribute("target", "_blank");
    // The contact person's name is not the addressee, and the card says so.
    expect(preview().queryByText("Petra Lindner")).not.toBeInTheDocument();
    expect(
      preview().getByText(/Der Name der Ansprechperson steht nicht darin\./),
    ).toBeInTheDocument();
  });

  it("reads the letterhead again when the person comes back from its tab", () => {
    const refreshLetterhead = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <TraegerWithdrawalContactCard
          version="w-1"
          reload={vi.fn()}
          withdrawal={{ phone: "", email: "" }}
          contact={CONTACT}
          letterheadText={LETTERHEAD}
          refreshLetterhead={refreshLetterhead}
          canEdit
          onSaved={() => Promise.resolve()}
        />
      </ToastProvider>,
    );
    globalThis.dispatchEvent(new Event("focus"));
    expect(refreshLetterhead).not.toHaveBeenCalled();

    const link = preview().getByRole("link", {
      name: "Im Briefkopf ändern, neuer Tab",
    });
    // The test document opens no tab.
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    globalThis.dispatchEvent(new Event("focus"));
    globalThis.dispatchEvent(new Event("focus"));
    expect(refreshLetterhead).toHaveBeenCalledTimes(1);
  });

  it("asks for the letterhead when it holds no name or no address", () => {
    const { rerender } = render(card(undefined, CONTACT, true, ""));

    expect(preview().getByText("Fehlt")).toBeInTheDocument();
    expect(
      preview().getByRole("link", {
        name: "Im Briefkopf eintragen, neuer Tab",
      }),
    ).toBeInTheDocument();

    rerender(card(undefined, CONTACT, true, "Ganztag im Quartier e.V."));
    expect(preview().getByText("Anschrift fehlt")).toBeInTheDocument();
    expect(
      preview().getByRole("link", {
        name: "Im Briefkopf eintragen, neuer Tab",
      }),
    ).toBeInTheDocument();
  });

  it("updates the preview as the office types its own e-mail", () => {
    render(card());
    fireEvent.change(screen.getByLabelText("E-Mail für Widerrufe"), {
      target: { value: "widerruf@traeger.example" },
    });

    expect(
      preview().getByText(
        /Telefon: 0211 123 45, E-Mail: widerruf@traeger\.example$/,
      ),
    ).toBeInTheDocument();
    expect(preview().getByText("Eigene Angabe")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Speichern" }),
    ).toBeInTheDocument();
  });

  it("warns when the notice would miss a phone or an e-mail", () => {
    render(card({ phone: "", email: "" }, { name: "", phone: "", email: "" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Es fehlt: Telefonnummer und E-Mail-Adresse.",
    );
    expect(preview().getAllByText("Fehlt")).toHaveLength(2);
    // The notice leads to the contact person's phone (#7054).
    const phone = document.createElement("input");
    phone.id = "traeger-contact-phone";
    phone.setAttribute("aria-label", "Telefon der Ansprechperson");
    document.body.append(phone);
    fireEvent.click(screen.getByRole("button", { name: "Zur Ansprechperson" }));
    expect(
      screen.getByRole("textbox", { name: "Telefon der Ansprechperson" }),
    ).toHaveFocus();
    phone.remove();
  });

  it("saves and shows the values as the backend keeps them", async () => {
    mockSave.mockResolvedValue({
      value: { phone: "", email: "widerruf@traeger.example" },
      version: "w-2",
    });
    render(<Page />);
    fireEvent.change(screen.getByLabelText("E-Mail für Widerrufe"), {
      target: { value: " Widerruf@Traeger.Example " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(screen.getByLabelText("E-Mail für Widerrufe")).toHaveValue(
        "widerruf@traeger.example",
      ),
    );
    expect(mockSave).toHaveBeenCalledWith(
      {
        phone: "",
        // An e-mail field drops the spaces itself; the backend lowers the case.
        email: "Widerruf@Traeger.Example",
      },
      "w-1",
    );
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
  });

  it("shows the fields read-only without the right to change them", () => {
    render(card({ phone: "0800 111", email: "" }, CONTACT, false));

    expect(screen.getByLabelText("Telefon für Widerrufe")).toBeDisabled();
    expect(preview().getByText("Eigene Angabe")).toBeInTheDocument();
    // Without the right the letterhead is no place to change it.
    expect(preview().getByText("Aus dem Briefkopf")).toBeInTheDocument();
    expect(preview().queryByRole("link")).not.toBeInTheDocument();
  });

  // #6652: the save holds once the write is through; a failed reload of the
  // page is a load error in the card that says the change is saved.
  it("keeps the saved values when the page reload fails", async () => {
    mockSave.mockClear();
    mockSave.mockResolvedValue({
      value: { phone: "", email: "widerruf@traeger.example" },
      version: "w-2",
    });
    const onSaved = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValue(undefined);
    render(<Page onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("E-Mail für Widerrufe"), {
      target: { value: "widerruf@traeger.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        `${catalogText("general.unavailable", "die Anzeige des Kontakts für Widerrufe")} ${SAVED_BUT_STALE_SUFFIX}`,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

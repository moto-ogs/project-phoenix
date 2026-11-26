import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { catalogText } from "~/test/error-catalog-text";

const { mockSave } = vi.hoisted(() => ({ mockSave: vi.fn() }));
vi.mock("~/lib/traeger-api", () => ({ saveTraegerContact: mockSave }));

import { TraegerContactCard } from "./traeger-contact-card";

const SAVED = { name: "Petra Lindner", phone: "", email: "" };

// The version moves with the stored contact (ADR 0311).
function card(contact: typeof SAVED, version = "c-1") {
  return (
    <ToastProvider>
      <TraegerContactCard
        version={version}
        reload={vi.fn()}
        contact={contact}
        canEdit
        onSaved={() => Promise.resolve()}
      />
    </ToastProvider>
  );
}

const resolved = () => Promise.resolve();
const noReload = () => Promise.reject(new Error("no read in this case"));

/** The page: its read takes the save's answer (ADR 0311, rule 5). */
function Page({
  onSaved = resolved,
  reload = noReload,
}: Readonly<{
  onSaved?: () => Promise<unknown>;
  reload?: () => Promise<{ value: typeof SAVED; version: string }>;
}>) {
  const [read, setRead] = useState({ value: SAVED, version: "c-1" });
  return (
    <ToastProvider>
      <TraegerContactCard
        contact={read.value}
        version={read.version}
        reload={async () => {
          const next = await reload();
          setRead(next);
          return next;
        }}
        write={(saved) => {
          setRead(saved);
          return Promise.resolve();
        }}
        canEdit
        onSaved={onSaved}
      />
    </ToastProvider>
  );
}

describe("TraegerContactCard", () => {
  it("keeps an open draft when the page reads the master data again", () => {
    const { rerender } = render(card(SAVED));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Jonas Weber" },
    });

    // Another change on the page reads the master data again: a new object
    // with the same stored contact.
    rerender(card({ ...SAVED }));

    expect(screen.getByLabelText("Name")).toHaveValue("Jonas Weber");
    expect(
      screen.getByRole("button", { name: "Speichern" }),
    ).toBeInTheDocument();
  });

  it("takes a new stored contact while nothing is being edited", () => {
    const { rerender } = render(card(SAVED));

    rerender(card({ ...SAVED, phone: "+49 5402 1234-0" }, "c-2"));

    expect(screen.getByLabelText("Telefon")).toHaveValue("+49 5402 1234-0");
  });

  it("shows the contact as the backend keeps it after saving", async () => {
    mockSave.mockResolvedValue({
      value: {
        name: "Petra Lindner",
        phone: "",
        email: "buero@traeger.example",
      },
      version: "c-2",
    });
    render(<Page />);
    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
      target: { value: " Buero@Traeger.Example " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(screen.getByLabelText("E-Mail-Adresse")).toHaveValue(
        "buero@traeger.example",
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Petra Lindner");
  });

  // #6652: the save holds once the write is through; a failed reload of the
  // page is a load error in the card that says the change is saved.
  it("keeps the saved values when the page reload fails", async () => {
    mockSave.mockClear();
    mockSave.mockResolvedValue({
      value: {
        name: "Petra Lindner",
        phone: "",
        email: "buero@traeger.example",
      },
      version: "c-2",
    });
    const onSaved = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValue(undefined);
    render(<Page onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
      target: { value: "buero@traeger.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        `${catalogText("general.unavailable", "die Anzeige der Ansprechperson")} ${SAVED_BUT_STALE_SUFFIX}`,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  // ADR 0311: a contact a colleague saved since is not overwritten; the
  // card shows it with the refusal and saves over its version.
  it("shows the contact a colleague saved since instead of overwriting it", async () => {
    mockSave.mockClear();
    mockSave.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    const stored = { value: { ...SAVED, name: "Jonas Weber" }, version: "c-2" };
    const reload = vi.fn().mockResolvedValue(stored);
    render(<Page reload={reload} />);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Anna Brandt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText(
          "general.changed_since_read",
          "die Änderung der Ansprechperson",
        ),
      ),
    ).toBeInTheDocument();
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Anna Brandt" }),
      "c-1",
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText("Name")).toHaveValue("Jonas Weber");

    mockSave.mockResolvedValueOnce(stored);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Anna Brandt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: "Anna Brandt" }),
        "c-2",
      ),
    );
  });
});

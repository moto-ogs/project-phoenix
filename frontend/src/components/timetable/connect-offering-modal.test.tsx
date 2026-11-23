import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import { SWRConfig } from "~/lib/swr/testing";
import { duplicateIds } from "~/test/helpers/duplicate-ids";
import type { OfferingPreview, RosterDeviation } from "~/lib/roster-deviation";

vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "1", token: "test-token" } },
  }),
}));

/** Real SWR with a fresh cache per render (the preview reads through it). */
function SWRTestCache({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

const { mockPreview, mockConnect, mockToastSuccess, mockOfferingSources } =
  vi.hoisted(() => ({
    mockPreview: vi.fn(),
    mockConnect: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockOfferingSources: vi.fn(),
  }));

vi.mock("~/lib/timetable-api", () => ({
  timetableService: {
    getOfferingPreview: mockPreview,
    connectTemplateToOffering: mockConnect,
    getOfferingSources: mockOfferingSources,
  },
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({ success: mockToastSuccess, error: vi.fn() }),
}));

vi.mock("~/lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

import { ConnectOfferingModal } from "./connect-offering-modal";

const deviation: RosterDeviation = {
  templateId: "9",
  offerings: [{ id: "3", name: "Randstunde" }],
  gradeLevels: [],
  schoolClasses: ["1b"],
  unbookedCount: 2,
  missingCount: 1,
  candidates: [
    { id: "3", name: "Randstunde" },
    { id: "4", name: "Ganztag" },
  ],
  combinations: [],
  ambiguous: false,
};

const preview: OfferingPreview = {
  from: "2026-10-28",
  weekdays: [
    {
      weekday: 3,
      added: [{ studentId: "11", name: "Ada Berg" }],
      removed: [
        { studentId: "12", name: "Ben Kurz" },
        { studentId: "13", name: "Cem Ott" },
      ],
      keptCount: 4,
    },
  ],
  segments: [
    { templateId: "8", validFrom: "2026-09-01", validUntil: "2026-10-30" },
    { templateId: "9", validFrom: "2026-10-30" },
  ],
  fingerprint: "vorschau-1",
};

describe("ConnectOfferingModal (#5103)", () => {
  beforeEach(() => {
    mockPreview.mockReset().mockResolvedValue(preview);
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockToastSuccess.mockReset();
    mockOfferingSources.mockReset().mockResolvedValue([]);
  });

  it("previews per weekday who joins and who leaves, then connects every period", async () => {
    const onConnected = vi.fn();
    const onClose = vi.fn();
    render(
      <ConnectOfferingModal
        isOpen
        templateName="RDST 1b"
        deviation={deviation}
        onClose={onClose}
        onConnected={onConnected}
      />,
      { wrapper: SWRTestCache },
    );

    expect(mockPreview).toHaveBeenCalledWith("9", {
      offeringIds: ["3"],
      gradeLevels: [],
      schoolClasses: ["1b"],
    });
    expect(await screen.findByText("Mittwoch")).toBeInTheDocument();
    expect(screen.getByText("Kommt dazu (1): Ada Berg")).toBeInTheDocument();
    expect(screen.getByText("Fällt weg (2)")).toBeInTheDocument();
    expect(screen.getByText("Ben Kurz")).toBeInTheDocument();
    expect(screen.getByText("Cem Ott")).toBeInTheDocument();
    expect(screen.getByText("Bleibt (4)")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ab 28.10.2026 kommen nur noch die für „Randstunde“ angemeldeten Kinder. An- und Abmeldungen werden danach automatisch übernommen.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Nur Kinder der Klasse 1b")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Gilt für alle Termine ab 28.10.2026, auch für den Abschnitt ab 30.10.2026.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));

    await waitFor(() =>
      expect(mockConnect).toHaveBeenCalledWith(
        "9",
        { offeringIds: ["3"], gradeLevels: [], schoolClasses: ["1b"] },
        expect.objectContaining({
          from: "2026-10-28",
          fingerprint: "vorschau-1",
        }),
      ),
    );
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Regeltermin ist mit „Randstunde“ verbunden.",
    );
  });

  it("keeps the dialog open with the error when connecting fails", async () => {
    mockConnect.mockRejectedValue(
      new ApiError("server", 500, { code: "general.server" }),
    );
    const onConnected = vi.fn();
    render(
      <ConnectOfferingModal
        isOpen
        templateName="RDST 1b"
        deviation={deviation}
        onClose={vi.fn()}
        onConnected={onConnected}
      />,
      { wrapper: SWRTestCache },
    );
    await screen.findByText("Mittwoch");

    fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("locks alternative offerings until the pending connection finishes", async () => {
    mockPreview.mockResolvedValue({
      ...preview,
      otherOfferings: [{ offeringId: "4", name: "Ganztag", childCount: 2 }],
    });
    let finishSave!: () => void;
    mockConnect.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
    );
    const onClose = vi.fn();
    render(
      <ConnectOfferingModal
        isOpen
        templateName="RDST 1b"
        deviation={deviation}
        onClose={onClose}
        onConnected={vi.fn()}
      />,
      { wrapper: SWRTestCache },
    );
    const add = await screen.findByRole("button", {
      name: "Angebot dazunehmen",
    });
    expect(add).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));

    try {
      expect(add).toBeDisabled();
      fireEvent.click(add);
      expect(
        screen.getByRole("combobox", { name: "Angebote" }),
      ).toHaveTextContent("Randstunde");
      expect(mockConnect).toHaveBeenCalledWith(
        "9",
        { offeringIds: ["3"], gradeLevels: [], schoolClasses: ["1b"] },
        expect.objectContaining({ from: preview.from }),
      );
      expect(mockPreview).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => finishSave());
    }
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preselects no offering when several fit equally and previews the chosen one (#5138)", async () => {
    render(
      <ConnectOfferingModal
        isOpen
        templateName="RDST 3a"
        deviation={{
          ...deviation,
          offerings: [{ id: "4", name: "Ganztag" }],
          schoolClasses: ["3a"],
          candidates: [
            { id: "4", name: "Ganztag" },
            { id: "3", name: "Randstunde" },
          ],
          ambiguous: true,
        }}
        onClose={vi.fn()}
        onConnected={vi.fn()}
      />,
      { wrapper: SWRTestCache },
    );

    expect(
      screen.getByText(
        "Mehrere Angebote passen zur Kinderliste. Wähle die Angebote, deren angemeldete Kinder kommen sollen.",
      ),
    ).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "Angebote" });
    expect(select).toHaveTextContent("Angebote wählen");
    expect(screen.getByRole("button", { name: "Verbinden" })).toBeDisabled();
    expect(screen.queryByText("Das ändert sich")).not.toBeInTheDocument();
    expect(mockPreview).not.toHaveBeenCalled();

    fireEvent.click(select);
    fireEvent.click(await screen.findByRole("option", { name: "Randstunde" }));

    await waitFor(() =>
      expect(mockPreview).toHaveBeenCalledWith("9", {
        offeringIds: ["3"],
        gradeLevels: [],
        schoolClasses: ["3a"],
      }),
    );
    expect(await screen.findByText("Mittwoch")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ab 28.10.2026 kommen nur noch die für „Randstunde“ angemeldeten Kinder. An- und Abmeldungen werden danach automatisch übernommen.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));
    await waitFor(() =>
      expect(mockConnect).toHaveBeenCalledWith(
        "9",
        { offeringIds: ["3"], gradeLevels: [], schoolClasses: ["3a"] },
        expect.objectContaining({ from: "2026-10-28" }),
      ),
    );
  });

  it("keeps every HTML ID unique before, during and after choosing an offering (#5350)", async () => {
    render(
      <ConnectOfferingModal
        isOpen
        templateName="RDST 3a"
        deviation={{ ...deviation, ambiguous: true }}
        onClose={vi.fn()}
        onConnected={vi.fn()}
      />,
      { wrapper: SWRTestCache },
    );

    // Anker: the offering field is rendered, named by its label.
    const select = screen.getByRole("combobox", { name: "Angebote" });
    expect(select).toHaveTextContent("Angebote wählen");
    expect(duplicateIds()).toEqual([]);

    fireEvent.click(select);
    // Anker: the open menu carries the field name.
    expect(screen.getByRole("listbox", { name: "Angebote" })).toBeVisible();
    fireEvent.click(await screen.findByRole("option", { name: "Ganztag" }));
    expect(duplicateIds()).toEqual([]);

    expect(await screen.findByText("Mittwoch")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Angebote" }),
    ).toHaveTextContent("Ganztag");
    expect(duplicateIds()).toEqual([]);
  });

  it("connects Randstunde and Ganztag together and keeps the Ganztag children (#5139)", async () => {
    mockOfferingSources.mockResolvedValue([
      { id: "3", name: "Randstunde", phaseId: "1", phaseName: "2026/27" },
      { id: "4", name: "Ganztag", phaseId: "1", phaseName: "2026/27" },
      { id: "5", name: "Ferien", phaseId: "1", phaseName: "2026/27" },
      { id: "6", name: "Nachmeldung", phaseId: "2", phaseName: "Nachmeldung" },
    ]);
    render(
      <ConnectOfferingModal
        isOpen
        templateName="RDST 1a"
        periodId="12"
        deviation={{
          ...deviation,
          offerings: [
            { id: "3", name: "Randstunde" },
            { id: "4", name: "Ganztag" },
          ],
          schoolClasses: ["1a"],
          unbookedCount: 3,
          missingCount: 0,
          candidates: [
            { id: "3", name: "Randstunde" },
            { id: "4", name: "Ganztag" },
          ],
        }}
        onClose={vi.fn()}
        onConnected={vi.fn()}
      />,
      { wrapper: SWRTestCache },
    );

    expect(mockPreview).toHaveBeenCalledWith("9", {
      offeringIds: ["3", "4"],
      gradeLevels: [],
      schoolClasses: ["1a"],
    });
    expect(mockOfferingSources).toHaveBeenCalledWith("12");
    expect(
      await screen.findByText(
        "Ab 28.10.2026 kommen nur noch die für „Randstunde“ oder „Ganztag“ angemeldeten Kinder. An- und Abmeldungen werden danach automatisch übernommen.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Angebote" }),
    ).toHaveTextContent("Randstunde, Ganztag");

    // Every offering of the period can be added; another phase cannot.
    fireEvent.click(screen.getByRole("combobox", { name: "Angebote" }));
    expect(await screen.findByRole("option", { name: "Ferien" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Nachmeldung" })).toBeDisabled();
    expect(
      screen.getByText(
        "Angebote anderer Anmeldephasen sind ausgegraut, solange ein Angebot gewählt ist.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));

    await waitFor(() =>
      expect(mockConnect).toHaveBeenCalledWith(
        "9",
        { offeringIds: ["3", "4"], gradeLevels: [], schoolClasses: ["1a"] },
        expect.objectContaining({ from: "2026-10-28" }),
      ),
    );
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        "Regeltermin ist mit „Randstunde“ und „Ganztag“ verbunden.",
      ),
    );
  });
});

it("shows the new preview instead of a retry when the children changed since it was read", async () => {
  mockPreview
    .mockReset()
    .mockResolvedValueOnce(preview)
    .mockResolvedValue({
      ...preview,
      weekdays: [{ ...preview.weekdays[0]!, keptCount: 5 }],
      fingerprint: "vorschau-2",
    });
  mockConnect
    .mockReset()
    .mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    )
    .mockResolvedValue(undefined);
  const onConnected = vi.fn();
  render(
    <ConnectOfferingModal
      isOpen
      templateName="RDST 1b"
      deviation={deviation}
      onClose={vi.fn()}
      onConnected={onConnected}
    />,
    { wrapper: SWRTestCache },
  );
  expect(await screen.findByText("Bleibt (4)")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));

  expect(await screen.findByText("Bleibt (5)")).toBeInTheDocument();
  expect(mockConnect).toHaveBeenCalledWith(
    "9",
    { offeringIds: ["3"], gradeLevels: [], schoolClasses: ["1b"] },
    expect.objectContaining({ fingerprint: "vorschau-1" }),
  );
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Wiederholen|Erneut versuchen/ }),
  ).not.toBeInTheDocument();
  expect(onConnected).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));
  await waitFor(() =>
    expect(mockConnect).toHaveBeenLastCalledWith(
      "9",
      { offeringIds: ["3"], gradeLevels: [], schoolClasses: ["1b"] },
      expect.objectContaining({ fingerprint: "vorschau-2" }),
    ),
  );
  await waitFor(() => expect(onConnected).toHaveBeenCalled());
});

// ADR 0311 rule 6: a failed read of the new preview after a refusal says
// so, and the refused preview is not confirmed again.
it("names a failed read of the preview after a refusal and connects nothing", async () => {
  mockPreview
    .mockReset()
    .mockResolvedValueOnce(preview)
    .mockRejectedValue(
      new ApiError("down", 503, { code: "general.unavailable" }),
    );
  mockConnect
    .mockReset()
    .mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
  render(
    <ConnectOfferingModal
      isOpen
      templateName="RDST 1b"
      deviation={deviation}
      onClose={vi.fn()}
      onConnected={vi.fn()}
    />,
    { wrapper: SWRTestCache },
  );
  expect(await screen.findByText("Bleibt (4)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));

  expect(
    await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Du siehst jetzt den neuen Stand/),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verbinden" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));
  expect(mockConnect).toHaveBeenCalledTimes(1);
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type {
  EnrollmentPreview,
  EnrollmentRow,
} from "~/lib/traeger-contract-enrollments-api";
import type { TraegerSchool } from "~/lib/traeger-api";
import { catalogText } from "~/test/error-catalog-text";
import { setTestClock, testClockDay } from "~/test/clock";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import TraegerContractEnrollmentPage from "./page-content";

const api = vi.hoisted(() => ({
  previewContractEnrollments: vi.fn(),
  runContractEnrollments: vi.fn(),
}));
vi.mock("~/lib/traeger-contract-enrollments-api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
const schools = vi.hoisted(() => ({ fetchTraegerSchools: vi.fn() }));
vi.mock("~/lib/traeger-api", async (original) => ({
  ...(await original<object>()),
  ...schools,
}));
vi.unmock("swr");
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
// The page head is the scaffold's; here its body and dialog matter.
vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({
    children,
    overlays,
  }: {
    children: ReactNode;
    overlays: ReactNode;
  }) => (
    <>
      {children}
      {overlays}
    </>
  ),
  TenantPageStats: () => null,
}));
let mockSearch = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

const SONNENHOF: TraegerSchool = {
  id: "2",
  name: "OGS Sonnenhof",
  slug: "sonnenhof",
  subdomain: "sonnenhof",
  city: "Osnabrück",
};
const MANUELL: TraegerSchool = { ...SONNENHOF, id: "3", name: "Demo-Schule" };

function row(
  contractId: string,
  overrides: Partial<EnrollmentRow> = {},
): EnrollmentRow {
  return {
    contractId,
    status: "ready",
    reason: undefined,
    action: "enroll",
    contractChild: { firstName: "Jonas", lastName: "Zimmermann" },
    student: {
      studentId: "12",
      firstName: "Jonas",
      lastName: "Zimmermann",
      birthDate: "2018-11-30",
    },
    phaseName: "Anmeldung Schuljahr 2026/2027",
    bookings: [
      {
        careOfferingId: "7",
        moduleName: "Betreuung bis 15 Uhr",
        days: ["mon", "tue", "wed", "thu", "fri"],
        validFrom: "2026-09-01",
        validUntil: "2027-08-01",
        endTimes: {
          mon: "15:00",
          tue: "15:00",
          wed: "15:00",
          thu: "15:00",
          fri: "15:00",
        },
      },
    ],
    changes: [],
    requestChildId: null,
    followsContractId: null,
    ...overrides,
  };
}

const ROWS: EnrollmentRow[] = [
  row("82"),
  row("87", {
    action: "bind",
    requestChildId: "94",
    contractChild: { firstName: "Jessica", lastName: "Bader" },
    student: {
      studentId: "99",
      firstName: "Jessica",
      lastName: "Bader",
      birthDate: "2016-09-29",
    },
  }),
  row("79", {
    status: "done",
    action: undefined,
    bookings: [],
    requestChildId: "128",
    contractChild: { firstName: "Lina", lastName: "Schröder" },
  }),
  row("75", {
    status: "unlinked",
    action: undefined,
    student: null,
    bookings: [],
    contractChild: { firstName: "Emil", lastName: "Wagner" },
  }),
  row("80", {
    status: "held",
    action: undefined,
    reason: "not_begun",
    bookings: [],
    contractChild: { firstName: "Emir", lastName: "Yilmaz" },
  }),
  row("88", {
    status: "held",
    action: undefined,
    reason: "has_application",
    requestChildId: "93",
    contractChild: { firstName: "Thore", lastName: "Gritzmann" },
  }),
  row("84", {
    status: "stuck",
    action: undefined,
    reason: "bookings_differ",
    requestChildId: "140",
    contractChild: { firstName: "Leonard", lastName: "Roth" },
    student: {
      studentId: "36",
      firstName: "Leo",
      lastName: "Roth",
      birthDate: "2017-02-22",
    },
  }),
];

function preview(
  overrides: Partial<EnrollmentPreview> = {},
): EnrollmentPreview {
  return {
    schoolId: "2",
    fingerprint: "fp-1",
    counts: { ready: 2, done: 1, unlinked: 1, held: 2, stuck: 1, changed: 0 },
    rows: ROWS,
    ...overrides,
  };
}

function renderPage() {
  render(
    <TraegerResourceTestProvider>
      <TraegerContractEnrollmentPage />
    </TraegerResourceTestProvider>,
  );
}

async function openPreview(result = preview()) {
  schools.fetchTraegerSchools.mockResolvedValue([SONNENHOF]);
  api.previewContractEnrollments.mockResolvedValueOnce(result);
  renderPage();
  await screen.findByRole("heading", { name: "Vorschau prüfen" });
}

async function confirmRun() {
  fireEvent.click(
    screen.getByRole("button", { name: "Für 2 Verträge nachtragen" }),
  );
  await screen.findByRole("dialog", { name: "Für 2 Verträge nachtragen?" });
  fireEvent.click(screen.getByRole("button", { name: "Jetzt nachtragen" }));
}

describe("Anmeldungen nachtragen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSearch = "";
  });

  it("asks for the school when the Träger has several", async () => {
    schools.fetchTraegerSchools.mockResolvedValue([MANUELL, SONNENHOF]);
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Schule wählen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /OGS Sonnenhof/ })).toHaveAttribute(
      "href",
      "/traeger/vertraege/anmeldungen?schule=2",
    );
    expect(screen.getByText(/Eltern bekommen keine Mail/)).toBeInTheDocument();
    expect(api.previewContractEnrollments).not.toHaveBeenCalled();
  });

  it("opens the preview of the chosen school", async () => {
    mockSearch = "schule=2";
    schools.fetchTraegerSchools.mockResolvedValue([MANUELL, SONNENHOF]);
    api.previewContractEnrollments.mockResolvedValueOnce(preview());
    renderPage();
    await screen.findByRole("heading", { name: "Vorschau prüfen" });
    expect(api.previewContractEnrollments).toHaveBeenCalledWith("2");
  });

  it("skips the choice for a single school and opens on the ready rows", async () => {
    await openPreview();
    expect(api.previewContractEnrollments).toHaveBeenCalledWith("2");
    expect(screen.getByRole("button", { name: "Bereit 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The contract's child next to the child record, before anything runs.
    expect(screen.getAllByText("Jonas Zimmermann").length).toBe(2);
    expect(screen.getAllByText("Mo–Fr bis 15:00").length).toBeGreaterThan(0);
    // The last day of the half-open booking, not the first day after it.
    expect(
      screen.getAllByText("01.09.2026 bis 31.07.2027").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "moto legt die Anmeldung mit dieser Betreuung an und bindet den Vertrag daran.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Eine passende Anmeldung gibt es schon. moto bindet nur den Vertrag daran.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Emir Yilmaz")).not.toBeInTheDocument();
    expect(
      screen.getByText("4 Zeilen bleiben offen. An ihnen ändert moto nichts."),
    ).toBeInTheDocument();
  });

  it("says for every open row what is wrong and who acts", async () => {
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Zurückgestellt 2" }));
    expect(
      screen.getByText(
        "Der Vertrag hat noch nicht begonnen. Ab seinem ersten Tag nimmt ein neuer Lauf ihn mit.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /schon eine andere Anmeldung, die nicht zum Vertrag passt/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hängt 1" }));
    expect(
      screen.getByText(/Die Anmeldung an der Schule zu beenden hilft nicht/),
    ).toBeInTheDocument();
    // A child record named otherwise than the contract shows before the run.
    expect(screen.getByText("Name weicht ab")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ohne Kinderakte 1" }));
    // The row of an unlinked contract leads to the linking, as the order of
    // work above does.
    const linking = screen.getAllByRole("link", {
      name: "Mit Kinderakten verknüpfen",
    });
    expect(linking).toHaveLength(2);
    for (const link of linking) {
      expect(link).toHaveAttribute("href", "/traeger/vertraege/verknuepfen");
    }

    fireEvent.click(screen.getByRole("button", { name: "Erledigt 1" }));
    expect(
      screen.getByText(
        "Der Vertrag ist an die Anmeldung gebunden und folgt ihren Buchungen.",
      ),
    ).toBeInTheDocument();
  });

  it("runs the confirmed preview and keeps the open rows as a work list", async () => {
    await openPreview();
    api.runContractEnrollments.mockResolvedValueOnce({
      schoolId: "2",
      changed: true,
      counts: { ready: 0, done: 3, unlinked: 1, held: 2, stuck: 1, changed: 0 },
      rows: ROWS.map((one) =>
        one.status === "ready" ? { ...one, status: "done" as const } : one,
      ),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Für 2 Verträge nachtragen" }),
    );
    await screen.findByRole("dialog", { name: "Für 2 Verträge nachtragen?" });
    // The weight of the run, without drama.
    expect(
      screen.getByText(
        /moto legt an der Schule OGS Sonnenhof 1 Anmeldung an, schon genehmigt/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 Vertrag wird an eine Anmeldung gebunden/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Eltern bekommen keine Nachricht/),
    ).toBeInTheDocument();
    expect(api.runContractEnrollments).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Jetzt nachtragen" }));

    expect(
      await screen.findByRole("heading", { name: "2 Verträge gebunden" }),
    ).toBeInTheDocument();
    expect(api.runContractEnrollments).toHaveBeenCalledWith("2", "fp-1");
    expect(
      screen.getByText(
        "OGS Sonnenhof: 1 nachgetragen, 1 nur gebunden, 1 war schon erledigt, 4 offen.",
      ),
    ).toBeInTheDocument();
    // The parent step is the school's (#7760): the bulk invitation, with the
    // notice for parents who already have an account.
    expect(
      screen.getByText(/Eltern ins Elternportal einladen macht die Schule/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/„Eltern mit Konto benachrichtigen“/),
    ).toBeInTheDocument();
    // The work list opens on what is stuck.
    expect(screen.getByRole("button", { name: "Hängt 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Erledigt 3" }));
    expect(screen.getByText("Nachgetragen")).toBeInTheDocument();
    expect(screen.getByText("Gebunden")).toBeInTheDocument();
    expect(
      screen.getByText("Anmeldung eingetragen, Vertrag daran gebunden."),
    ).toBeInTheDocument();
  });

  it("reads a rerun as done, with nothing to run", async () => {
    const done = ROWS.filter((one) => one.status === "done");
    await openPreview(
      preview({
        counts: {
          ready: 0,
          done: 1,
          unlinked: 0,
          held: 0,
          stuck: 0,
          changed: 0,
        },
        rows: done,
      }),
    );
    expect(
      screen.getByText(
        "Alle Verträge sind schon an ihre Anmeldung gebunden. Hier ist nichts zu tun.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Anmeldungen nachtragen" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("reads the preview again quietly when the server answers that it changed", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await openPreview();
    // The office confirms the next morning: rows that bind carry their day.
    setTestClock(testClockDay(1));
    api.runContractEnrollments.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "care_contract.enrollment_preview_changed",
      }),
    );
    api.previewContractEnrollments.mockResolvedValueOnce(
      preview({ fingerprint: "fp-2" }),
    );
    await confirmRun();
    expect(
      await screen.findByText(/Seit deiner Vorschau hat sich etwas geändert/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.previewContractEnrollments).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.queryByText(
        catalogText(
          "care_contract.enrollment_preview_changed",
          "die Anmeldungen",
        ),
      ),
    ).not.toBeInTheDocument();
    expect(errors).not.toHaveBeenCalledWith(
      expect.stringContaining("contract_enrollment_run_failed"),
      expect.anything(),
    );

    // The new preview is the one the next confirmation takes.
    api.runContractEnrollments.mockResolvedValueOnce({
      schoolId: "2",
      changed: false,
      counts: preview().counts,
      rows: ROWS,
    });
    await screen.findByRole("heading", { name: "Vorschau prüfen" });
    await confirmRun();
    await waitFor(() =>
      expect(api.runContractEnrollments).toHaveBeenLastCalledWith("2", "fp-2"),
    );
    errors.mockRestore();
  });

  it("says children may be enrolled already when the run failed", async () => {
    await openPreview();
    api.runContractEnrollments.mockRejectedValueOnce(
      new ApiError("Request failed (500)", 500, { code: "general.internal" }),
    );
    api.previewContractEnrollments.mockResolvedValueOnce(preview());
    await confirmRun();
    expect(
      await screen.findByText(/Manche Kinder können schon angemeldet sein/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.previewContractEnrollments).toHaveBeenCalledTimes(2),
    );
  });

  it("retires a refused preview until a fresh one has answered", async () => {
    await openPreview();
    api.runContractEnrollments.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "care_contract.enrollment_preview_changed",
      }),
    );
    let answer: (value: EnrollmentPreview) => void = () => undefined;
    api.previewContractEnrollments.mockReturnValueOnce(
      new Promise<EnrollmentPreview>((resolve) => {
        answer = resolve;
      }),
    );
    await confirmRun();
    await screen.findByText(/Seit deiner Vorschau hat sich etwas geändert/);
    // While the new preview is on its way, the old one is gone: nothing to
    // confirm a second time.
    await waitFor(() =>
      expect(api.previewContractEnrollments).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.queryByRole("button", { name: "Für 2 Verträge nachtragen" }),
    ).not.toBeInTheDocument();
    answer(preview({ fingerprint: "fp-2" }));
    expect(
      await screen.findByRole("button", { name: "Für 2 Verträge nachtragen" }),
    ).toBeInTheDocument();
  });

  it("shows the load error, not the old preview, when the fresh read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await openPreview();
    api.runContractEnrollments.mockRejectedValueOnce(
      new ApiError("Request failed (500)", 500, { code: "general.internal" }),
    );
    api.previewContractEnrollments.mockRejectedValue(
      new ApiError("Request failed (500)", 500, { code: "general.internal" }),
    );
    await confirmRun();
    await screen.findByText(/Manche Kinder können schon angemeldet sein/);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Für 2 Verträge nachtragen" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: "Vorschau prüfen" }),
    ).not.toBeInTheDocument();
  });

  it("does not warn about enrolled children when the run was refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await openPreview();
    api.runContractEnrollments.mockRejectedValueOnce(
      new ApiError("Request failed (403)", 403, { code: "general.forbidden" }),
    );
    api.previewContractEnrollments.mockResolvedValueOnce(preview());
    await confirmRun();
    await waitFor(() =>
      expect(api.previewContractEnrollments).toHaveBeenCalledTimes(2),
    );
    await screen.findByRole("button", { name: "Für 2 Verträge nachtragen" });
    expect(
      screen.queryByText(/Manche Kinder können schon angemeldet sein/),
    ).not.toBeInTheDocument();
  });

  it("names a run that enrolled a child without binding its contract", async () => {
    await openPreview();
    api.runContractEnrollments.mockResolvedValueOnce({
      schoolId: "2",
      changed: true,
      counts: { ready: 0, done: 2, unlinked: 1, held: 2, stuck: 1, changed: 1 },
      rows: ROWS.map((one) =>
        one.contractId === "82"
          ? { ...one, status: "changed" as const, requestChildId: "150" }
          : one.status === "ready"
            ? { ...one, status: "done" as const }
            : one,
      ),
    });
    await confirmRun();
    expect(
      await screen.findByRole("heading", { name: "Nicht ganz durchgelaufen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /1 Vertrag ist nicht gebunden, obwohl an der Schule schon eine Anmeldung stehen kann/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Zu den Verträgen" }),
    ).not.toBeInTheDocument();
  });

  it("drops the result of a run when the office went to another school", async () => {
    schools.fetchTraegerSchools.mockResolvedValue([MANUELL, SONNENHOF]);
    mockSearch = "schule=2";
    api.previewContractEnrollments.mockResolvedValueOnce(preview());
    const view = render(
      <TraegerResourceTestProvider>
        <TraegerContractEnrollmentPage />
      </TraegerResourceTestProvider>,
    );
    await screen.findByRole("heading", { name: "Vorschau prüfen" });
    let answer: (value: unknown) => void = () => undefined;
    api.runContractEnrollments.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await confirmRun();
    // Browser back to the other school while the run is on its way.
    api.previewContractEnrollments.mockResolvedValue(
      preview({
        schoolId: "3",
        fingerprint: "fp-3",
        rows: [],
        counts: {
          ready: 0,
          done: 0,
          unlinked: 0,
          held: 0,
          stuck: 0,
          changed: 0,
        },
      }),
    );
    mockSearch = "schule=3";
    view.rerender(
      <TraegerResourceTestProvider>
        <TraegerContractEnrollmentPage />
      </TraegerResourceTestProvider>,
    );
    await screen.findByText("Keine importierten Verträge");
    answer({
      schoolId: "2",
      changed: true,
      counts: preview().counts,
      rows: ROWS.map((one) =>
        one.status === "ready" ? { ...one, status: "done" as const } : one,
      ),
    });
    await waitFor(() =>
      expect(api.runContractEnrollments).toHaveBeenCalledTimes(1),
    );
    await Promise.resolve();
    expect(screen.getByText("Keine importierten Verträge")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "2 Verträge gebunden" }),
    ).not.toBeInTheDocument();
  });

  it("lets only the run that owns the screen answer after a school switch and back", async () => {
    schools.fetchTraegerSchools.mockResolvedValue([MANUELL, SONNENHOF]);
    mockSearch = "schule=2";
    api.previewContractEnrollments.mockResolvedValue(preview());
    const page = () => (
      <TraegerResourceTestProvider>
        <TraegerContractEnrollmentPage />
      </TraegerResourceTestProvider>
    );
    const view = render(page());
    await screen.findByRole("heading", { name: "Vorschau prüfen" });
    let first: (value: unknown) => void = () => undefined;
    api.runContractEnrollments.mockReturnValueOnce(
      new Promise((resolve) => {
        first = resolve;
      }),
    );
    await confirmRun();
    // Away and back while the first run is on its way, then a second run.
    mockSearch = "";
    view.rerender(page());
    await screen.findByRole("heading", { name: "Schule wählen" });
    mockSearch = "schule=2";
    view.rerender(page());
    await screen.findByRole("heading", { name: "Vorschau prüfen" });
    api.runContractEnrollments.mockReturnValueOnce(
      new Promise(() => undefined),
    );
    await confirmRun();
    await waitFor(() =>
      expect(api.runContractEnrollments).toHaveBeenCalledTimes(2),
    );
    first({
      schoolId: "2",
      changed: true,
      counts: preview().counts,
      rows: ROWS.map((one) =>
        one.status === "ready" ? { ...one, status: "done" as const } : one,
      ),
    });
    await Promise.resolve();
    await Promise.resolve();
    // The second confirmation is still the screen: its dialog stays open.
    expect(
      screen.getByRole("dialog", { name: "Für 2 Verträge nachtragen?" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "2 Verträge gebunden" }),
    ).not.toBeInTheDocument();
  });

  it("moves the focus to the fresh preview after a refused one", async () => {
    await openPreview();
    api.runContractEnrollments.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "care_contract.enrollment_preview_changed",
      }),
    );
    api.previewContractEnrollments.mockResolvedValueOnce(
      preview({ fingerprint: "fp-2" }),
    );
    await confirmRun();
    await screen.findByText(/Seit deiner Vorschau hat sich etwas geändert/);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Vorschau prüfen" }),
      ).toHaveFocus(),
    );
  });
});

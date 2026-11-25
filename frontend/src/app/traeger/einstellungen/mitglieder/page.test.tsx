import { useEffect } from "react";
import { useSWRAuth } from "~/lib/swr";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "~/test/helpers/form-modal-pending";
import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";
import { ApiError } from "~/lib/api-error";
import { ErrorContactProvider } from "~/lib/error-contact";
import { catalogText } from "~/test/error-catalog-text";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { downloadTraegerList } from "~/lib/traeger-list-export";

vi.unmock("swr");
vi.mock("~/lib/traeger-list-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/traeger-list-export")>()),
  downloadTraegerList: vi.fn(),
}));
// downloadTraegerList is mocked; the file request it would read never runs.
vi.mock("~/lib/bff-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/bff-fetch")>()),
  bffFile: () => new Promise<Response>(() => undefined),
}));

const api = vi.hoisted(() => ({
  fetchTraegerBuero: vi.fn(),
  inviteTraegerAccount: vi.fn(),
  changeTraegerRoles: vi.fn(),
  changeTraegerMemberName: vi.fn(),
  removeTraegerMember: vi.fn(),
  revokeTraegerInvitation: vi.fn(),
  fetchTraegerAccountHistory: vi.fn(),
}));

vi.mock("~/lib/traeger-api", () => api);
const leaveRemovedSession = vi.hoisted(() =>
  vi.fn(async (_portal: string) => undefined),
);
vi.mock("~/lib/shell-auth-context", () => ({ leaveRemovedSession }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "1",
        scope: "org",
        orgId: "7",
        email: "leitung@traeger.example",
      },
    },
    status: "authenticated",
  }),
}));

import TraegerAccountsPage from "./page";
import {
  expectPageReloadedAfterRefusal,
  resetPageReloads,
} from "~/test/helpers/refused-refresh";

const BUERO = {
  members: [
    {
      accountId: "1",
      email: "leitung@traeger.example",
      name: "Lea Leitung",
      roles: ["leadership", "administration"],
      version: "r1",
    },
    {
      accountId: "2",
      email: "kasse@traeger.example",
      name: "",
      roles: ["billing"],
      version: "r2",
    },
  ],
  invitations: [
    {
      id: "9",
      email: "neu@traeger.example",
      roles: ["read_only"],
      expiresAt: "2026-09-11T10:00:00Z",
    },
  ],
};

/** The role change answers the person as saved, with a new version. */
function savedRoles(accountId: string, roles: readonly string[]) {
  const member = BUERO.members.find((one) => one.accountId === accountId);
  return Promise.resolve({
    accountId,
    email: member?.email ?? "",
    name: member?.name ?? "",
    roles,
    version: `${accountId}-saved`,
  });
}

const HISTORY = {
  entries: [
    {
      id: "12",
      occurredAt: "2026-09-08T14:05:00Z",
      action: "roles_changed",
      actorEmail: "leitung@traeger.example",
      targetEmail: "kasse@traeger.example",
      targetName: "",
      rolesBefore: ["read_only"],
      rolesAfter: ["billing"],
    },
    {
      id: "11",
      occurredAt: "2026-09-07T08:00:00Z",
      action: "member_removed",
      actorEmail: "",
      targetEmail: "weg@traeger.example",
      rolesBefore: ["personnel"],
      rolesAfter: [],
    },
  ],
  hasMore: true,
};

function BackgroundRefusal() {
  const reader = useTraegerResource(
    traegerKeys.buero(),
    api.fetchTraegerBuero,
    "die Liste der Personen",
  );
  const { reload, refused } = reader;
  useEffect(() => {
    reload();
  }, [reload]);
  return refused ? <span>Zugriff verweigert</span> : null;
}

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <ToastProvider>
        <TraegerAccountsPage />
      </ToastProvider>
    </SWRConfig>,
  );
}

async function openMenu(email: string) {
  const [menu] = await screen.findAllByRole("button", {
    name: `Aktionen für ${email}`,
  });
  fireEvent.click(menu!);
}

/**
 * Opens the download menu of a list: the members' export sits in the page
 * menu (#7416), the history's on its table head.
 */
async function openDownload(label: string) {
  if (label === "Verlauf herunterladen") {
    fireEvent.click(screen.getByRole("button", { name: label }));
    return;
  }
  expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "Weitere Aktionen" })).at(
      -1,
    )!,
  );
}

describe("TraegerAccountsPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchTraegerBuero.mockResolvedValue(BUERO);
    api.fetchTraegerAccountHistory.mockResolvedValue(HISTORY);
  });

  it.each([
    "Mitglieder und Einladungen herunterladen",
    "Verlauf herunterladen",
  ])(
    "withdraws office and history caches after a refused %s",
    async (downloadLabel) => {
      vi.mocked(downloadTraegerList).mockRejectedValue(
        new ApiError("refused", 403),
      );
      let office!: ReturnType<typeof useSWRAuth>;
      let history!: ReturnType<typeof useSWRAuth>;
      function Probe() {
        office = useSWRAuth(traegerKeys.buero(), api.fetchTraegerBuero);
        history = useSWRAuth(
          traegerKeys.accountHistory(),
          api.fetchTraegerAccountHistory,
        );
        return null;
      }
      function View({ open }: { open: boolean }) {
        return (
          <>
            {open && <TraegerAccountsPage />}
            <Probe />
          </>
        );
      }
      function Providers({ children }: { children: React.ReactNode }) {
        return (
          <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
            <ToastProvider>{children}</ToastProvider>
          </SWRConfig>
        );
      }
      const view = render(<View open />, { wrapper: Providers });
      expect(await screen.findByText("Lea Leitung")).toBeVisible();
      expect((await screen.findAllByText("Rollen geändert"))[0]).toBeVisible();
      expect(office.readCurrent?.().data).toEqual(BUERO);
      expect(history.readCurrent?.().data).toEqual(HISTORY);
      // The right is gone: the list, read anew on every opening, is refused
      // as well.
      api.fetchTraegerBuero.mockRejectedValue(new ApiError("refused", 403));
      await openDownload(downloadLabel);
      fireEvent.click(await screen.findByRole("menuitem", { name: /Excel/ }));
      expect(
        (
          await screen.findAllByText(
            catalogText("general.permission", "die Liste der Personen"),
          )
        )[0],
      ).toBeVisible();
      // The toast can render before the effect withdraws the cached data.
      await waitFor(() => {
        expect(office.readCurrent?.().data).toBeUndefined();
        expect(history.readCurrent?.().data).toBeUndefined();
      });
      view.rerender(<View open={false} />);
      api.fetchTraegerBuero.mockRejectedValue(new ApiError("offline", 503));
      api.fetchTraegerAccountHistory.mockRejectedValue(
        new ApiError("offline", 503),
      );
      view.rerender(<View open />);
      expect(
        (
          await screen.findAllByText(
            catalogText("general.permission", "die Liste der Personen"),
          )
        )[0],
      ).toBeVisible();
      expect(screen.queryByText("Lea Leitung")).not.toBeInTheDocument();
      expect(screen.queryByText("Verlauf")).not.toBeInTheDocument();
    },
  );

  it.each([
    "Rollen bearbeiten",
    "Namen eintragen",
    "Einladung zurücknehmen",
    "Person einladen",
  ])("closes %s after a refused background read", async (action) => {
    const { rerender } = renderPage();
    await screen.findByText("Lea Leitung");
    if (action === "Person einladen")
      fireEvent.click(screen.getByRole("button", { name: action }));
    else if (action === "Einladung zurücknehmen") {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Aktionen für die Einladung an neu@traeger.example",
        }),
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: action }));
    } else {
      await openMenu("kasse@traeger.example");
      fireEvent.click(await screen.findByRole("menuitem", { name: action }));
    }
    expect(await screen.findByRole("dialog")).toBeVisible();
    api.fetchTraegerBuero.mockRejectedValue(new ApiError("forbidden", 403));
    rerender(
      <SWRConfig value={{ errorRetryCount: 0 }}>
        <ToastProvider>
          <TraegerAccountsPage />
          <BackgroundRefusal />
        </ToastProvider>
      </SWRConfig>,
    );
    // Anker: der zweite Leser hat denselben Schlüssel erneut gelesen und verweigert.
    expect(await screen.findByText("Zugriff verweigert")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists the people with their roles and the open invitations", async () => {
    renderPage();

    const [kasse] = await screen.findAllByText("kasse@traeger.example");
    expect(kasse).toBeInTheDocument();
    expect((await screen.findAllByText("Abrechnung"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("(Du)")[0]).toBeInTheDocument();
    expect(screen.getByText("Offene Einladungen")).toBeInTheDocument();
    expect(screen.getAllByText("neu@traeger.example")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Nur lesen")[0]).toBeInTheDocument();
  });

  it("invites a person with the chosen roles", async () => {
    api.inviteTraegerAccount.mockResolvedValue(undefined);
    renderPage();
    await screen.findAllByText("kasse@traeger.example");

    fireEvent.click(screen.getByRole("button", { name: "Person einladen" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Einladung senden" }),
    );
    // Without an address and a role nothing is sent.
    expect(
      await within(dialog).findByText("Bitte wähle mindestens eine Rolle."),
    ).toBeInTheDocument();
    expect(api.inviteTraegerAccount).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/E-Mail-Adresse/), {
      target: { value: "personal@traeger.example" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Personal/ }));
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /Nur lesen/ }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Einladung senden" }),
    );

    await waitFor(() =>
      expect(api.inviteTraegerAccount).toHaveBeenCalledWith({
        email: "personal@traeger.example",
        roles: ["personnel", "read_only"],
      }),
    );
    expect(
      await screen.findByText("Die Einladung ist verschickt."),
    ).toBeInTheDocument();
    expect(api.fetchTraegerBuero).toHaveBeenCalledTimes(2);
  });

  it("changes the roles of a person", async () => {
    api.changeTraegerRoles.mockImplementation(savedRoles);
    renderPage();

    await openMenu("kasse@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    const billing = within(dialog).getByRole("checkbox", {
      name: /Abrechnung/,
    });
    expect(billing).toBeChecked();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Personal/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.changeTraegerRoles).toHaveBeenCalledWith(
        "2",
        ["billing", "personnel"],
        "r2",
      ),
    );
  });

  // #5992: the role Dokumente has its own row with a plain description. A
  // person who holds it keeps it when someone changes their other roles.
  it("shows the role Dokumente and keeps it when roles change", async () => {
    api.changeTraegerRoles.mockImplementation(savedRoles);
    api.fetchTraegerBuero.mockResolvedValue({
      ...BUERO,
      members: [
        ...BUERO.members,
        {
          accountId: "3",
          name: "",
          email: "verwaltung@traeger.example",
          roles: ["administration", "documents"],
          version: "r3",
        },
      ],
    });
    renderPage();

    const [labels] = await screen.findAllByText("Verwaltung, Dokumente");
    expect(labels).toBeInTheDocument();
    await openMenu("verwaltung@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("checkbox", { name: /Dokumente/ }),
    ).toBeChecked();
    expect(
      within(dialog).getByText(
        "Darf Dokumente für Eltern und Schulen hochladen, freigeben und löschen.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Personal/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.changeTraegerRoles).toHaveBeenCalledWith(
        "3",
        ["administration", "documents", "personnel"],
        "r3",
      ),
    );
  });

  it("keeps Leitung for its only holder and says why", async () => {
    api.changeTraegerRoles.mockImplementation(savedRoles);
    renderPage();

    await openMenu("leitung@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    const leadership = within(dialog).getByRole("checkbox", {
      name: /Leitung/,
    });
    expect(leadership).toBeChecked();
    expect(leadership).toBeDisabled();
    expect(
      within(dialog).getByText(/Nur diese Person hat die Rolle Leitung/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /Schulzugang/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.changeTraegerRoles).toHaveBeenCalledWith(
        "1",
        ["leadership", "administration", "school_access"],
        "r1",
      ),
    );
  });

  // ADR 0311: the change rests on the roles as read. A refusal shows the
  // stored roles, and the next save goes out over their version.
  it("shows the stored roles after a refusal and saves over their version", async () => {
    const changed = new ApiError("changed", 409, {
      code: "general.changed_since_read",
    });
    api.changeTraegerRoles
      .mockRejectedValueOnce(changed)
      .mockImplementation(savedRoles);
    api.fetchTraegerBuero.mockResolvedValueOnce(BUERO).mockResolvedValue({
      ...BUERO,
      members: [
        BUERO.members[0]!,
        {
          ...BUERO.members[1]!,
          roles: ["billing", "read_only"],
          version: "r2b",
        },
      ],
    });
    renderPage();

    await openMenu("kasse@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Personal/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(
        within(dialog).getByRole("checkbox", { name: /Nur lesen/ }),
      ).toBeChecked(),
    );
    expect(
      within(dialog).getByRole("checkbox", { name: /Personal/ }),
    ).not.toBeChecked();
    expect(api.changeTraegerRoles).toHaveBeenLastCalledWith(
      "2",
      ["billing", "personnel"],
      "r2",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(api.changeTraegerRoles).toHaveBeenLastCalledWith(
        "2",
        ["billing", "read_only"],
        "r2b",
      ),
    );
  });

  // ADR 0311 rule 6: after a refusal whose read fails, nothing is sent.
  it("sends no role change after a refusal until the stored roles are read", async () => {
    api.changeTraegerRoles.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    api.fetchTraegerBuero
      .mockResolvedValueOnce(BUERO)
      .mockRejectedValue(
        new ApiError("down", 503, { code: "general.unavailable" }),
      );
    renderPage();

    await openMenu("kasse@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.fetchTraegerBuero).toHaveBeenCalledTimes(2));
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(api.fetchTraegerBuero).toHaveBeenCalledTimes(2));
    expect(api.changeTraegerRoles).toHaveBeenCalledTimes(1);
  });

  // A person removed after the refused change has nothing left to save:
  // the dialog closes and says so, instead of a load error that blocks
  // Speichern.
  it("closes the role change when the person left meanwhile", async () => {
    api.changeTraegerRoles.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    api.fetchTraegerBuero
      .mockResolvedValueOnce(BUERO)
      .mockResolvedValue({ ...BUERO, members: [BUERO.members[0]!] });
    renderPage();

    await openMenu("kasse@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        "Diese Person gehört nicht mehr zum Träger-Büro. Die Rollen sind nicht geändert.",
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", {
        name: "Aktionen für kasse@traeger.example",
      }),
    ).not.toBeInTheDocument();
    expect(api.changeTraegerRoles).toHaveBeenCalledTimes(1);
  });

  // ADR 0311 rule 1: the server logs every read of the people in the
  // history, so each opening of the page reads once and shows no cached
  // list without that entry.
  it("reads the people anew on every opening", async () => {
    function View({ open }: { open: boolean }) {
      return open ? <TraegerAccountsPage /> : null;
    }
    function Providers({ children }: { children: React.ReactNode }) {
      return (
        <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
          <ToastProvider>{children}</ToastProvider>
        </SWRConfig>
      );
    }
    const view = render(<View open />, { wrapper: Providers });
    await screen.findAllByText("kasse@traeger.example");
    expect(api.fetchTraegerBuero).toHaveBeenCalledTimes(1);

    view.rerender(<View open={false} />);
    const reopened = deferred<typeof BUERO>();
    api.fetchTraegerBuero.mockReturnValueOnce(reopened.promise);
    view.rerender(<View open />);

    await waitFor(() => expect(api.fetchTraegerBuero).toHaveBeenCalledTimes(2));
    const actions = { name: "Aktionen für kasse@traeger.example" };
    expect(screen.queryByRole("button", actions)).not.toBeInTheDocument();
    await act(async () => reopened.resolve(BUERO));
    expect((await screen.findAllByRole("button", actions))[0]).toBeVisible();
    expect(api.fetchTraegerBuero).toHaveBeenCalledTimes(2);
  });

  it("lets Leitung pass on once another person holds it", async () => {
    api.fetchTraegerBuero.mockResolvedValue({
      ...BUERO,
      members: [
        ...BUERO.members,
        {
          accountId: "3",
          name: "",
          email: "zweite@traeger.example",
          roles: ["leadership"],
        },
      ],
    });
    renderPage();

    await openMenu("leitung@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("checkbox", { name: /Leitung/ }),
    ).toBeEnabled();
    expect(
      within(dialog).getByText(
        "Darf Personen einladen, ihre Rollen ändern und sie entfernen.",
      ),
    ).toBeInTheDocument();
  });

  it("does not offer removing the only Leitung and says why", async () => {
    renderPage();

    expect(
      (await screen.findAllByText("Einzige Leitung, bleibt im Träger-Büro"))[0],
    ).toBeInTheDocument();
    await openMenu("leitung@traeger.example");
    expect(
      await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Aus dem Träger-Büro entfernen" }),
    ).not.toBeInTheDocument();
  });

  it("shows why the last person with Leitung cannot leave", async () => {
    // The list on screen still shows a second Leitung, who lost the role
    // meanwhile: the server refuses and the dialog says why.
    api.fetchTraegerBuero.mockResolvedValue({
      ...BUERO,
      members: [
        BUERO.members[0]!,
        { ...BUERO.members[1]!, roles: ["leadership", "billing"] },
      ],
    });
    api.removeTraegerMember.mockRejectedValue(
      new ApiError("conflict", 409, { code: "traeger.last_administrator" }),
    );
    renderPage();

    await openMenu("leitung@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "Aus dem Träger-Büro entfernen",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    // The two-step gate: the first click arms, the second removes.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Ja, entfernen" }),
    );
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Entfernen" }),
    );

    await waitFor(() =>
      expect(api.removeTraegerMember).toHaveBeenCalledWith("1"),
    );
    expect(
      await within(dialog).findByText(
        catalogText("traeger.last_administrator", "das Entfernen"),
      ),
    ).toBeInTheDocument();
  });

  it("leaves the session at once when the person removed themselves", async () => {
    api.fetchTraegerBuero.mockResolvedValue({
      ...BUERO,
      members: [
        BUERO.members[0]!,
        { ...BUERO.members[1]!, roles: ["leadership", "billing"] },
      ],
    });
    api.removeTraegerMember.mockResolvedValue(undefined);
    renderPage();

    await openMenu("leitung@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "Aus dem Träger-Büro entfernen",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Ja, entfernen" }),
    );
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Entfernen" }),
    );

    // The server ended the sessions: nothing of this one shows, also while
    // Auth.js deletes the cookie (#8082).
    await waitFor(() =>
      expect(leaveRemovedSession).toHaveBeenCalledWith("traeger"),
    );
  });

  it("shows the history of changes and loads older entries", async () => {
    api.fetchTraegerAccountHistory
      .mockResolvedValueOnce(HISTORY)
      .mockResolvedValueOnce({
        entries: [
          {
            id: "10",
            occurredAt: "2026-09-01T09:00:00Z",
            action: "invitation_created",
            actorEmail: "leitung@traeger.example",
            targetEmail: "alt@traeger.example",
            rolesBefore: [],
            rolesAfter: ["read_only"],
          },
        ],
        hasMore: false,
      });
    renderPage();

    expect(await screen.findByText("Verlauf")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Rollen geändert"))[0],
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Vorher: Nur lesen. Jetzt: Abrechnung.")[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText("Entfernt")[0]).toBeInTheDocument();
    expect(screen.getAllByText("weg@traeger.example")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Bisher: Personal.")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Gelöschtes Konto")[0]).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Ältere Einträge laden" }),
    );
    await waitFor(() =>
      expect(api.fetchTraegerAccountHistory).toHaveBeenLastCalledWith("11"),
    );
    expect(
      (await screen.findAllByText("alt@traeger.example"))[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText("Eingeladen")[0]).toBeInTheDocument();
    // Anker: die ältere Seite ist geladen.
    expect(screen.getAllByText("alt@traeger.example")[0]).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ältere Einträge laden" }),
    ).not.toBeInTheDocument();
  });

  // #4693: the name of each person, and a clear hint for one without.
  it("shows the name of each person and marks a missing one", async () => {
    renderPage();

    expect((await screen.findAllByText("Lea Leitung"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("Kein Name")[0]).toBeInTheDocument();
    expect(screen.getAllByText("kasse@traeger.example")[0]).toBeInTheDocument();
  });

  it("enters the name of a person and shows it in the row", async () => {
    const named = { ...BUERO.members[1]!, name: "Karl Kasse" };
    api.changeTraegerMemberName.mockResolvedValue(named);
    api.fetchTraegerBuero
      .mockResolvedValueOnce(BUERO)
      .mockResolvedValue({ ...BUERO, members: [BUERO.members[0], named] });
    renderPage();

    await openMenu("kasse@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Namen eintragen" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(
      await within(dialog).findAllByText("Bitte gib einen Namen ein."),
    ).not.toHaveLength(0);
    expect(api.changeTraegerMemberName).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Name/), {
      target: { value: " Karl Kasse " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.changeTraegerMemberName).toHaveBeenCalledWith(
        "2",
        "Karl Kasse",
      ),
    );
    expect((await screen.findAllByText("Karl Kasse"))[0]).toBeInTheDocument();
    expect(
      await screen.findByText("Der Name ist gespeichert."),
    ).toBeInTheDocument();
    // The list and the history are read again.
    await waitFor(() =>
      expect(api.fetchTraegerAccountHistory).toHaveBeenCalledTimes(2),
    );
  });

  it("offers to change an existing name", async () => {
    renderPage();

    await openMenu("leitung@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Namen bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Name/)).toHaveValue("Lea Leitung");
  });

  it("names a changed name in the history", async () => {
    api.fetchTraegerAccountHistory.mockResolvedValue({
      entries: [
        {
          id: "13",
          occurredAt: "2026-09-08T15:00:00Z",
          action: "name_changed",
          actorEmail: "leitung@traeger.example",
          targetEmail: "kasse@traeger.example",
          targetName: "Karl Kasse",
          rolesBefore: [],
          rolesAfter: [],
        },
      ],
      hasMore: false,
    });
    renderPage();

    expect(
      (await screen.findAllByText("Name geändert"))[0],
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Neuer Name: Karl Kasse.")[0],
    ).toBeInTheDocument();
  });

  it("shows no history without the right to manage the accounts", async () => {
    api.fetchTraegerBuero.mockRejectedValue(
      new ApiError("forbidden", 403, { code: "traeger.no_membership" }),
    );
    renderPage();

    // Anker: die Seite zeigt den Ladefehler statt der Personen.
    expect(
      await screen.findByText(
        catalogText("traeger.no_membership", "die Liste der Personen"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Verlauf")).not.toBeInTheDocument();
  });

  // #6871: the billing role without „Konten verwalten“ gets the 403 of the
  // permission check, and the page sends it to the Leitung of its Büro.
  it("sends the billing role to the Leitung of the Träger-Büro", async () => {
    api.fetchTraegerBuero.mockRejectedValue(new ApiError("Forbidden", 403));
    render(
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        <ErrorContactProvider contact="traeger">
          <ToastProvider>
            <TraegerAccountsPage />
          </ToastProvider>
        </ErrorContactProvider>
      </SWRConfig>,
    );

    expect(
      await screen.findByText(
        "Für die Liste der Personen fehlt dir die Berechtigung. Bitte frage die Leitung deines Träger-Büros.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/frage die Schule/)).not.toBeInTheDocument();
    expect(screen.queryByText("kasse@traeger.example")).not.toBeInTheDocument();
  });

  it("shows the history with the right to manage the accounts", async () => {
    renderPage();

    // Anker: die Personen sind geladen.
    expect(
      (await screen.findAllByText("kasse@traeger.example"))[0],
    ).toBeInTheDocument();
    expect(await screen.findByText("Verlauf")).toBeInTheDocument();
  });

  it.each([
    [403, "Mitglieder und Einladungen herunterladen"],
    [403, "Verlauf herunterladen"],
    [503, "Mitglieder und Einladungen herunterladen"],
  ] as const)(
    "keeps the page usable after a %s from %s",
    async (status, downloadLabel) => {
      vi.mocked(downloadTraegerList).mockRejectedValue(
        new ApiError("download failed", status),
      );
      renderPage();
      await screen.findAllByText("kasse@traeger.example");
      await screen.findAllByText("Rollen geändert");
      // A 403 means the right is gone: the list, read anew on every
      // opening, is refused as well.
      if (status === 403) {
        api.fetchTraegerBuero.mockRejectedValue(new ApiError("refused", 403));
      }
      await openDownload(downloadLabel);
      fireEvent.click(await screen.findByRole("menuitem", { name: /Excel/ }));
      const closeToast = await screen.findByRole("button", {
        name: "Schließen",
      });
      fireEvent.click(closeToast);
      await waitForElementToBeRemoved(closeToast);

      if (status === 403) {
        // Anker: nach dem Schließen des Toasts bleibt der Seitenfehler sichtbar.
        expect(
          await screen.findByText(
            catalogText("general.permission", "die Liste der Personen"),
          ),
        ).toBeInTheDocument();
        expect(
          screen.queryByText("kasse@traeger.example"),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("Verlauf")).not.toBeInTheDocument();
      } else {
        expect(
          screen.getAllByText("kasse@traeger.example")[0],
        ).toBeInTheDocument();
        expect(screen.getByText("Verlauf")).toBeInTheDocument();
      }
    },
  );

  it("reads the history again after a change", async () => {
    api.changeTraegerRoles.mockImplementation(savedRoles);
    renderPage();
    await waitFor(() =>
      expect(api.fetchTraegerAccountHistory).toHaveBeenCalledTimes(1),
    );

    await openMenu("kasse@traeger.example");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Personal/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.fetchTraegerAccountHistory).toHaveBeenCalledTimes(2),
    );
    expect(api.fetchTraegerAccountHistory).toHaveBeenLastCalledWith();
  });

  it.each([403, 503])(
    "handles a %s reload while another member dialog is open",
    async (status) => {
      const read = deferred<typeof BUERO>();
      api.fetchTraegerBuero
        .mockResolvedValueOnce(BUERO)
        .mockReturnValueOnce(read.promise);
      api.revokeTraegerInvitation.mockResolvedValue(undefined);
      renderPage();
      await openMenu("die Einladung an neu@traeger.example");
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /zurücknehmen/ }),
      );
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Ja, zurücknehmen" }),
      );
      fireEvent.click(
        await within(dialog).findByRole("button", { name: "Zurücknehmen" }),
      );
      await waitFor(() =>
        expect(api.fetchTraegerBuero).toHaveBeenCalledTimes(2),
      );
      await openMenu("kasse@traeger.example");
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
      );
      expect(await screen.findByRole("dialog")).toBeVisible();
      resetPageReloads();
      await act(async () => read.reject(new ApiError("failed", status)));
      if (status === 403) {
        // #6801: the page loads anew; its first load shows the refusal.
        await expectPageReloadedAfterRefusal();
        return;
      }
      // Anker: der Nachladefehler bestätigt den abgeschlossenen Widerruf.
      expect(
        await screen.findByText(
          `${catalogText("general.unavailable", "die Anzeige des Träger-Büros")} ${SAVED_BUT_STALE_SUFFIX}`,
        ),
      ).toBeVisible();
      expect(
        screen.getAllByText("kasse@traeger.example").length,
      ).toBeGreaterThan(0);
      expect(screen.getByRole("dialog")).toBeVisible();
    },
  );

  // #6652: a confirmed write whose reload fails is no failed action and does
  // not replace the list: the error stands above it, says the change is
  // saved, and its retry only reads the list again.
  describe("reload after a confirmed write (#6652)", () => {
    const reloadText = `${catalogText("general.unavailable", "die Anzeige des Träger-Büros")} ${SAVED_BUT_STALE_SUFFIX}`;

    beforeEach(() => {
      api.fetchTraegerBuero
        .mockReset()
        .mockResolvedValueOnce(BUERO)
        .mockRejectedValueOnce(
          new ApiError("down", 503, { code: "general.unavailable" }),
        )
        .mockResolvedValue(BUERO);
    });

    async function expectListKept(write: ReturnType<typeof vi.fn>) {
      expect(await screen.findByText(reloadText)).toBeInTheDocument();
      // Anker: die bestätigte Liste bleibt stehen.
      expect(
        screen.getAllByText("kasse@traeger.example").length,
      ).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
      await waitFor(() =>
        expect(api.fetchTraegerBuero).toHaveBeenCalledTimes(3),
      );
      expect(write).toHaveBeenCalledTimes(1);
    }

    it("keeps an invitation sent and the list shown when the reload fails", async () => {
      api.inviteTraegerAccount.mockResolvedValue(undefined);
      renderPage();
      await screen.findAllByText("kasse@traeger.example");

      fireEvent.click(screen.getByRole("button", { name: "Person einladen" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(/E-Mail-Adresse/), {
        target: { value: "personal@traeger.example" },
      });
      fireEvent.click(
        within(dialog).getByRole("checkbox", { name: /Personal/ }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Einladung senden" }),
      );

      await expectListKept(api.inviteTraegerAccount);
    });

    it("keeps changed roles and the list shown when the reload fails", async () => {
      api.changeTraegerRoles.mockImplementation(savedRoles);
      renderPage();

      await openMenu("kasse@traeger.example");
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Rollen bearbeiten" }),
      );
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("checkbox", { name: /Personal/ }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
      );

      await expectListKept(api.changeTraegerRoles);
    });

    it("keeps a revoked invitation revoked and the list shown when the reload fails", async () => {
      api.revokeTraegerInvitation.mockResolvedValue(undefined);
      renderPage();

      await openMenu("die Einladung an neu@traeger.example");
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /zurücknehmen/ }),
      );
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Ja, zurücknehmen" }),
      );
      fireEvent.click(
        await within(dialog).findByRole("button", { name: "Zurücknehmen" }),
      );

      await expectListKept(api.revokeTraegerInvitation);
    });
  });
});

import "@testing-library/jest-dom/vitest";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import type { ReactNode as TenantSWRNode } from "react";
import { SWRConfig as TenantSWRConfig } from "~/lib/swr/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type { BulkInviteResult } from "~/lib/guardian-bulk-invite-api";
import { SelectionBulkInviteModal } from "./selection-bulk-invite-modal";

vi.unmock("swr");

// Real SWR with a fresh cache and a signed-in OGS session per render.
function TenantSWRWrapper({ children }: Readonly<{ children: TenantSWRNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1", scope: "tenant" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <TenantSWRConfig
        value={{ provider: () => new Map(), errorRetryCount: 0 }}
      >
        {children}
      </TenantSWRConfig>
    </SessionProvider>
  );
}

function render(...[ui, options]: Parameters<typeof rtlRender>) {
  const Outer = options?.wrapper;
  return rtlRender(ui, {
    ...options,
    wrapper: ({ children }: Readonly<{ children: TenantSWRNode }>) => (
      <TenantSWRWrapper>
        {Outer ? <Outer>{children}</Outer> : children}
      </TenantSWRWrapper>
    ),
  });
}

const { bulkInvite, toastSuccess } = vi.hoisted(() => ({
  bulkInvite: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("~/lib/guardian-bulk-invite-api", () => ({
  bulkInviteGuardians: bulkInvite,
}));
vi.mock("~/contexts/ToastContext", async () => {
  const actual = await vi.importActual<
    typeof import("~/contexts/ToastContext")
  >("~/contexts/ToastContext");
  return {
    ...actual,
    useToast: () => ({ success: toastSuccess, error: vi.fn() }),
  };
});

function result(overrides: Partial<BulkInviteResult>): BulkInviteResult {
  return {
    dryRun: true,
    invited: 0,
    linkedExistingAccount: 0,
    resent: 0,
    skippedActive: 0,
    skippedOpen: 0,
    skippedRestricted: 0,
    notified: 0,
    alreadyNotified: 0,
    withoutVisibleCare: 0,
    problems: [],
    fingerprint: "counted",
    ...overrides,
  };
}

function renderModal(onClose = vi.fn()) {
  render(
    <SelectionBulkInviteModal
      isOpen
      onClose={onClose}
      studentIds={["4", "9"]}
    />,
  );
  return onClose;
}

describe("SelectionBulkInviteModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts first and mails only after the click", async () => {
    bulkInvite
      .mockResolvedValueOnce(result({ invited: 3, skippedActive: 2 }))
      .mockResolvedValueOnce(
        result({ dryRun: false, invited: 2, linkedExistingAccount: 1 }),
      );
    renderModal();

    const send = await screen.findByRole("button", {
      name: "3 Eltern einladen",
    });
    expect(bulkInvite).toHaveBeenCalledTimes(1);
    expect(bulkInvite).toHaveBeenCalledWith(["4", "9"], {
      dryRun: true,
      resendOpen: false,
      notifyActive: false,
    });
    expect(screen.getByText("Nutzen das Elternportal schon")).toBeVisible();

    fireEvent.click(send);

    await waitFor(() =>
      expect(bulkInvite).toHaveBeenLastCalledWith(["4", "9"], {
        dryRun: false,
        resendOpen: false,
        notifyActive: false,
        expectedFingerprint: "counted",
      }),
    );
    expect(
      await screen.findByText(
        "Die Einladung an 2 Eltern wird jetzt verschickt. Der Hinweis an 1 Elternteil mit moto-Konto wird jetzt verschickt. Das dauert ein paar Minuten.",
      ),
    ).toBeVisible();
    expect(toastSuccess).toHaveBeenCalledWith("3 Eltern sind eingeladen.");
    expect(screen.getByRole("button", { name: "Schließen" })).toBeVisible();
  });

  it("shows the new counts without a retry when the parents changed since counting", async () => {
    bulkInvite
      .mockResolvedValueOnce(result({ invited: 3 }))
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockResolvedValueOnce(result({ skippedOpen: 3, fingerprint: "now" }));
    renderModal();

    fireEvent.click(
      await screen.findByRole("button", { name: "3 Eltern einladen" }),
    );
    // Meanwhile the parents were invited elsewhere: the dialog counts again.
    expect(
      await screen.findByText(
        "Für diese Auswahl gibt es niemanden einzuladen.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Einladen" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(bulkInvite).toHaveBeenCalledTimes(3);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("allows submitting a preview containing only existing accounts", async () => {
    bulkInvite
      .mockResolvedValueOnce(result({ linkedExistingAccount: 1 }))
      .mockResolvedValueOnce(
        result({ dryRun: false, linkedExistingAccount: 1 }),
      );
    renderModal();

    const send = await screen.findByRole("button", {
      name: "1 Elternteil einladen",
    });
    expect(send).toBeEnabled();
    expect(
      screen.getByText("Vorhandenes moto-Konto wird verbunden"),
    ).toBeVisible();
    fireEvent.click(send);
    await waitFor(() =>
      expect(bulkInvite).toHaveBeenLastCalledWith(["4", "9"], {
        dryRun: false,
        resendOpen: false,
        notifyActive: false,
        expectedFingerprint: "counted",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Schließen" }),
    ).toBeVisible();
  });

  it("offers to resend open invitations and recounts", async () => {
    let resolvePreview: (value: BulkInviteResult) => void;
    const reloadingPreview = new Promise<BulkInviteResult>((resolve) => {
      resolvePreview = resolve;
    });
    bulkInvite
      .mockResolvedValueOnce(result({ skippedOpen: 1 }))
      .mockReturnValueOnce(reloadingPreview);
    renderModal();

    const checkbox = await screen.findByLabelText(
      "Offene Einladungen noch einmal senden",
    );
    expect(screen.getByRole("button", { name: "Einladen" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.click(checkbox);

    expect(screen.getByRole("button", { name: "Einladen" })).toBeDisabled();

    resolvePreview!(result({ resent: 1 }));

    const invite = await screen.findByRole("button", {
      name: "1 Elternteil einladen",
    });
    expect(invite).toBeEnabled();
    expect(invite).not.toHaveAttribute("aria-disabled");
    expect(bulkInvite).toHaveBeenLastCalledWith(["4", "9"], {
      dryRun: true,
      resendOpen: true,
      notifyActive: false,
    });
  });

  it("describes existing-account notices without claiming a token invitation", async () => {
    bulkInvite
      .mockResolvedValueOnce(result({ invited: 1 }))
      .mockResolvedValueOnce(
        result({ dryRun: false, linkedExistingAccount: 1 }),
      );
    renderModal();

    fireEvent.click(
      await screen.findByRole("button", { name: "1 Elternteil einladen" }),
    );

    expect(
      await screen.findByText(
        "Der Hinweis an 1 Elternteil mit moto-Konto wird jetzt verschickt. Das dauert ein paar Minuten.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/Die Einladung an 0 Eltern/),
    ).not.toBeInTheDocument();
  });

  it("names the parents that cannot be invited and the child to fix", async () => {
    bulkInvite.mockResolvedValueOnce(
      result({
        invited: 1,
        problems: [
          {
            guardianProfileId: "7",
            guardianName: "Katharina Brenner",
            studentNames: ["Mia Brenner"],
            reason: "missing_email",
          },
        ],
      }),
    );
    renderModal();

    expect(await screen.findByText("Katharina Brenner")).toBeVisible();
    expect(
      screen.getByText(/\(Mia Brenner\): E-Mail-Adresse fehlt/),
    ).toBeVisible();
  });

  it("gives matching steps for each address problem", async () => {
    bulkInvite.mockResolvedValueOnce(
      result({
        problems: [
          {
            guardianProfileId: "7",
            guardianName: "Ohne Adresse",
            studentNames: ["Mia Brenner"],
            reason: "missing_email",
          },
          {
            guardianProfileId: "8",
            guardianName: "Falsche Adresse",
            studentNames: ["Noah Brenner"],
            reason: "invalid_email",
          },
          {
            guardianProfileId: "9",
            guardianName: "Doppelte Adresse",
            studentNames: ["Lina Brenner"],
            reason: "duplicate_email",
          },
        ],
      }),
    );
    renderModal();

    expect(
      await screen.findByText("Trage die E-Mail-Adresse beim Kind ein."),
    ).toBeVisible();
    expect(
      screen.getByText("Prüfe die E-Mail-Adresse beim Kind."),
    ).toBeVisible();
    expect(
      screen.getByText("Prüfe die E-Mail-Adressen bei den Eltern."),
    ).toBeVisible();
  });

  it("asks to try again later when a mail could not be sent (#4602)", async () => {
    bulkInvite
      .mockResolvedValueOnce(result({ invited: 2 }))
      .mockResolvedValueOnce(
        result({
          dryRun: false,
          invited: 1,
          problems: [
            {
              guardianProfileId: "7",
              guardianName: "Katharina Brenner",
              studentNames: ["Mia Brenner"],
              reason: "email_not_queued",
            },
          ],
        }),
      );
    renderModal();

    fireEvent.click(
      await screen.findByRole("button", { name: "2 Eltern einladen" }),
    );

    expect(await screen.findByText("Katharina Brenner")).toBeVisible();
    expect(
      screen.getByText(
        /\(Mia Brenner\): E-Mail konnte gerade nicht verschickt werden/,
      ),
    ).toBeVisible();
    expect(screen.getByText("Versuche es später noch einmal.")).toBeVisible();
  });

  it("reports a failed run in the dialog and keeps it open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    bulkInvite
      .mockResolvedValueOnce(result({ invited: 1 }))
      .mockRejectedValueOnce(
        new ApiError("boom", 500, {
          code: "general.server",
          instance: "req-invite",
        }),
      )
      .mockResolvedValueOnce(result({ invited: 1, dryRun: false }));
    const onClose = renderModal();

    fireEvent.click(
      await screen.findByRole("button", { name: "1 Elternteil einladen" }),
    );

    expect(
      await screen.findByText(
        "Die Einladung konnte nicht bearbeitet werden. Bitte versuche es später erneut.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Vorgangskennung kopieren" }),
    ).toHaveTextContent("req-invite");
    expect(onClose).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledOnce());
  });

  it("shows a failed count in the dialog and counts again on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    bulkInvite
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce(result({ invited: 2 }));
    renderModal();

    expect(
      await screen.findByText(
        "Die Vorschau ist gerade nicht erreichbar. Bitte versuche es erneut.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    expect(
      await screen.findByRole("button", { name: "2 Eltern einladen" }),
    ).toBeVisible();
    expect(bulkInvite).toHaveBeenCalledTimes(2);
  });

  it("offers the notice to parents with an account only on request (#7760)", async () => {
    bulkInvite
      .mockResolvedValueOnce(result({ invited: 1, skippedActive: 2 }))
      .mockResolvedValueOnce(
        result({
          invited: 1,
          notified: 2,
          fingerprint: "counted-with-notice",
          problems: [
            {
              guardianProfileId: "7",
              guardianName: "Paul Brenner",
              studentNames: ["Mia Brenner"],
              reason: "missing_email",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        result({
          dryRun: false,
          invited: 1,
          notified: 2,
          withoutVisibleCare: 2,
        }),
      );
    renderModal();

    const option = await screen.findByRole("checkbox", {
      name: /Eltern mit Konto benachrichtigen/,
    });
    expect(option).not.toBeChecked();
    expect(
      screen.queryByText("Bekommen die Nachricht"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1 Elternteil einladen" }),
    ).toBeVisible();

    fireEvent.click(option);

    const send = await screen.findByRole("button", {
      name: "3 Eltern anschreiben",
    });
    expect(bulkInvite).toHaveBeenLastCalledWith(["4", "9"], {
      dryRun: true,
      resendOpen: false,
      notifyActive: true,
    });
    const counts = screen.getByRole("list", { name: "Was verschickt wird" });
    expect(counts).toHaveTextContent(
      "Werden eingeladen1Bekommen die Nachricht2Keine E-Mail-Adresse1",
    );
    expect(
      screen.getByText(/1 Elternteil kann keine E-Mail bekommen/),
    ).toBeVisible();

    fireEvent.click(send);

    expect(
      await screen.findByText(
        "Die Einladung an 1 Elternteil wird jetzt verschickt. Die Nachricht an 2 Eltern mit Konto wird jetzt verschickt. Das dauert ein paar Minuten.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "2 Kinder haben heute keine Betreuung gebucht. Für sie geht keine Nachricht raus.",
      ),
    ).toBeVisible();
    expect(bulkInvite).toHaveBeenNthCalledWith(3, ["4", "9"], {
      dryRun: false,
      resendOpen: false,
      notifyActive: true,
      // The token of the counts with the notice, not of the first preview.
      expectedFingerprint: "counted-with-notice",
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "1 Elternteil ist eingeladen. 2 Eltern bekommen die Nachricht.",
    );
  });

  it("says that nobody gets the notice twice and which children it leaves out (#7760)", async () => {
    bulkInvite
      .mockResolvedValueOnce(result({ skippedActive: 1 }))
      .mockResolvedValueOnce(
        result({ skippedActive: 1, alreadyNotified: 1, withoutVisibleCare: 2 }),
      );
    renderModal();

    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /Eltern mit Konto benachrichtigen/,
      }),
    );

    expect(await screen.findByText("Nachricht schon verschickt")).toBeVisible();
    expect(
      screen.getByRole("list", { name: "Was verschickt wird" }),
    ).toHaveTextContent("Kinder ohne gebuchte Betreuung: keine Nachricht2");
    expect(
      screen.queryByText("Nutzen das Elternportal schon"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Einladen" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("hides the notice without parents who have an account (#7760)", async () => {
    bulkInvite.mockResolvedValueOnce(result({ invited: 2 }));
    renderModal();

    await screen.findByRole("button", { name: "2 Eltern einladen" });
    expect(
      screen.queryByRole("checkbox", {
        name: /Eltern mit Konto benachrichtigen/,
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps the option while ticked, also when nobody can be told (#7760)", async () => {
    bulkInvite
      .mockResolvedValueOnce(result({ skippedActive: 1 }))
      // With the option, the only parent with an account has a blocked
      // address: in no counter of account holders.
      .mockResolvedValueOnce(
        result({
          problems: [
            {
              guardianProfileId: "7",
              guardianName: "Katharina Brenner",
              studentNames: ["Mia Brenner"],
              reason: "address_blocked",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(result({ skippedActive: 1 }));
    renderModal();

    const option = await screen.findByRole("checkbox", {
      name: /Eltern mit Konto benachrichtigen/,
    });
    fireEvent.click(option);
    expect(await screen.findByText("Katharina Brenner")).toBeVisible();

    const ticked = screen.getByRole("checkbox", {
      name: /Eltern mit Konto benachrichtigen/,
    });
    expect(ticked).toBeChecked();
    fireEvent.click(ticked);
    await waitFor(() =>
      expect(bulkInvite).toHaveBeenLastCalledWith(["4", "9"], {
        dryRun: true,
        resendOpen: false,
        notifyActive: false,
      }),
    );
    expect(
      await screen.findByRole("checkbox", {
        name: /Eltern mit Konto benachrichtigen/,
      }),
    ).not.toBeChecked();
  });

  it("keeps both choices and the focus while it counts again (#7760)", async () => {
    let answer!: (value: BulkInviteResult) => void;
    bulkInvite
      .mockResolvedValueOnce(result({ skippedActive: 1, skippedOpen: 1 }))
      .mockReturnValueOnce(
        new Promise<BulkInviteResult>((resolve) => {
          answer = resolve;
        }),
      );
    renderModal();

    const option = await screen.findByRole("checkbox", {
      name: /Eltern mit Konto benachrichtigen/,
    });
    option.focus();
    fireEvent.click(option);

    // Counting again: the same checkboxes stay, the focus with them.
    expect(
      screen.getByRole("checkbox", {
        name: /Eltern mit Konto benachrichtigen/,
      }),
    ).toBe(option);
    expect(option).toHaveFocus();
    expect(option).toBeChecked();
    expect(
      screen.getByLabelText("Offene Einladungen noch einmal senden"),
    ).toBeVisible();
    expect(
      screen.getByText("Nutzen das Elternportal schon").closest("ul"),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Einladen" })).toBeDisabled();

    answer(result({ notified: 1, skippedOpen: 1 }));
    expect(
      await screen.findByRole("button", {
        name: "1 Elternteil benachrichtigen",
      }),
    ).toBeEnabled();
    expect(option).toHaveFocus();
  });
});

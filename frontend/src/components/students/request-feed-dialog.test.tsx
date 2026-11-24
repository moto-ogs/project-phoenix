import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import type { ReactNode as TenantSWRNode } from "react";
import { SWRConfig as TenantSWRConfig } from "~/lib/swr/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RequestFeedDialog } from "./request-feed-dialog";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import {
  createRequestFeed,
  getRequestFeedStatus,
  rotateRequestFeed,
} from "~/lib/request-feed-api";

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

const { copy } = vi.hoisted(() => ({
  copy: vi.fn(),
}));

vi.mock("~/lib/use-clipboard-copy", () => ({
  useClipboardCopy: () => ({ copied: false, copy }),
}));

vi.mock("~/lib/request-feed-api", () => ({
  getRequestFeedStatus: vi.fn(),
  createRequestFeed: vi.fn(),
  rotateRequestFeed: vi.fn(),
}));

vi.mock("~/components/ui/modal", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}));

const status = vi.mocked(getRequestFeedStatus);
const create = vi.mocked(createRequestFeed);
const rotate = vi.mocked(rotateRequestFeed);

function renderDialog() {
  return render(
    <ToastProvider>
      <RequestFeedDialog isOpen onClose={vi.fn()} />
    </ToastProvider>,
  );
}

describe("RequestFeedDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    copy.mockResolvedValue(true);
  });

  it("zeigt einen neu erstellten Link genau in diesem Dialog", async () => {
    status.mockResolvedValue({ active: false });
    create.mockResolvedValue({
      url: "https://schule.test/api/request-feed/secret",
    });

    renderDialog();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "RSS-Link erstellen" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "RSS-Link erstellen" }));

    const input = await screen.findByLabelText("Dein RSS-Link");
    expect(input).toHaveValue("https://schule.test/api/request-feed/secret");
    expect(
      screen.getByText(/persönliche Daten stehen nicht im Feed/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Kopieren" }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(
        "https://schule.test/api/request-feed/secret",
      ),
    );
  });

  it("ersetzt einen bestehenden Link erst nach einer Bestätigung", async () => {
    status.mockResolvedValue({ active: true });
    rotate.mockResolvedValue({
      url: "https://schule.test/api/request-feed/new",
    });

    renderDialog();

    expect(
      await screen.findByText("Es gibt schon einen RSS-Link."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Neuen Link erstellen" }),
    );
    expect(
      screen.getByText(/bisherige Link funktioniert danach nicht mehr/),
    ).toBeInTheDocument();
    expect(rotate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Alten Link ersetzen" }),
    );
    await waitFor(() => expect(rotate).toHaveBeenCalledOnce());
    expect(await screen.findByLabelText("Dein RSS-Link")).toHaveValue(
      "https://schule.test/api/request-feed/new",
    );
  });

  it("zeigt einen Ladefehler im Dialog und lädt per Wiederholen neu", async () => {
    status
      .mockRejectedValueOnce(
        new ApiError("down", 503, {
          code: "general.unavailable",
          instance: "req-feed",
        }),
      )
      .mockResolvedValueOnce({ active: true });

    renderDialog();

    expect(
      await screen.findByText(
        "Das Abo ist gerade nicht erreichbar. Bitte versuche es erneut.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "RSS-Link erstellen" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    expect(
      await screen.findByText("Es gibt schon einen RSS-Link."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nicht erreichbar/)).toBeNull();
  });

  it("meldet ein gescheitertes Erstellen im Dialog mit dem Katalogtext", async () => {
    status.mockResolvedValue({ active: false });
    create.mockRejectedValueOnce(
      new ApiError("forbidden", 403, { code: "general.permission" }),
    );

    renderDialog();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "RSS-Link erstellen" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "RSS-Link erstellen" }));

    // Im Dialog, nicht als Toast: der läge hinter dem Hintergrund.
    expect(
      await within(screen.getByRole("dialog")).findByText(
        "Für das Abo fehlt dir die Berechtigung. Bitte frage die Schule.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("alert", { name: /^Fehler:/ }),
    ).not.toBeInTheDocument();
  });

  it("nennt beim Ersetzen ohne Link den nächsten Schritt (#7688)", async () => {
    status.mockResolvedValue({ active: true });
    rotate.mockRejectedValueOnce(
      new ApiError("Not Found", 404, { code: "care.request_feed_not_found" }),
    );

    renderDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Neuen Link erstellen" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Alten Link ersetzen" }),
    );

    expect(
      await within(screen.getByRole("dialog")).findByText(
        "Es gibt keinen RSS-Link mehr. Bitte lade die Seite neu und erstelle einen neuen Link.",
      ),
    ).toBeVisible();
  });

  it("nennt den Weg von Hand, wenn das Kopieren scheitert", async () => {
    status.mockResolvedValue({ active: false });
    create.mockResolvedValue({ url: "https://schule.test/feed" });
    copy.mockResolvedValue(false);

    renderDialog();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "RSS-Link erstellen" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "RSS-Link erstellen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Kopieren" }));

    expect(
      await within(screen.getByRole("dialog")).findByText(
        /markiere den Link und kopiere ihn selbst/,
      ),
    ).toBeVisible();
  });
});

import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { releaseFakeTimers } from "~/test/clock";

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: ToastProvider });
}

const { state, mutate, mailsMutate, api } = vi.hoisted(() => ({
  state: {
    detail: null as Record<string, unknown> | null,
    mails: {} as Record<string, Record<string, number>>,
  },
  mutate: vi.fn(() => Promise.resolve(undefined)),
  mailsMutate: vi.fn(() => Promise.resolve(undefined)),
  api: {
    closeGroupThread: vi.fn(),
    postGroupMessage: vi.fn(),
    fetchGroupThread: vi.fn(),
  },
}));

vi.mock("~/lib/swr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/swr")>()),
  // The mails of the messages (#7058) come under their own key.
  useSWRAuth: (key: string | null) =>
    key?.startsWith("group-message-mails-")
      ? {
          data: { mails: state.mails, awaitingFeedback: false },
          error: undefined,
          isLoading: false,
          mutate: mailsMutate,
        }
      : { data: state.detail, error: undefined, isLoading: false, mutate },
}));
// The send overlay (#5011) is bound to the signed-in session's scope.
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "1", tenantId: "1" }, expires: "2099-01-01" },
    status: "authenticated",
  }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ groupThreadId: "4" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/schule/messages/groups/4",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenant: () => ({ tenant: { messagingEnabled: true } }),
  useTenantSlugSafe: () => "schule",
  useTenantRoutingModeSafe: () => "subdomain",
}));
vi.mock("~/lib/parent-group-threads-api", async (importOriginal) => ({
  ...(await importOriginal()),
  ...api,
}));
import GroupMessagePage from "./page-content";

/**
 * Findet die Statuszeile aus genau diesen Angaben. Die Angaben stehen ohne
 * Trennpunkt nebeneinander, Zahl und Wort in eigenen Elementen.
 */
function statusLine(...parts: string[]) {
  return (_: string, element: Element | null) =>
    element?.tagName === "SPAN" && element.textContent === parts.join(", ");
}

function detail(closed: boolean) {
  return {
    thread: {
      id: "4",
      target_type: "group",
      target_id: "5",
      target_label: "Gruppe Bären",
      title: "Sommerfest",
      created_at: "2026-09-08T08:00:00Z",
      ...(closed ? { closed_at: "2026-09-09T09:00:00Z" } : {}),
    },
    messages: [
      {
        id: "1",
        sender_name: "Olivia Berg",
        body: "Wer bringt einen Kuchen mit?",
        created_at: "2026-09-08T08:00:00Z",
      },
    ],
    family_count: 2,
    read_count: 1,
    children: [
      {
        student_id: "7",
        first_name: "Felix",
        last_name: "Schneider",
        school_class: "1a",
        reachable: true,
        read: false,
      },
      {
        student_id: "8",
        first_name: "Emma",
        last_name: "Klein",
        reachable: true,
        read: true,
      },
    ],
  };
}

describe("Gruppennachricht: Objektseite", () => {
  beforeEach(() => {
    state.detail = detail(false);
    state.mails = {};
    mutate.mockClear();
    api.closeGroupThread.mockReset();
  });

  it("shows the messages, the status line and who has read", () => {
    render(<GroupMessagePage />);
    expect(
      screen.getByText("Wer bringt einen Kuchen mit?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(statusLine("Gruppe Bären", "1 von 2 Familien gelesen")),
    ).toBeInTheDocument();
    const list = screen.getByTestId("group-read-list");
    const felix = within(list)
      .getByText(/Felix Schneider/)
      .closest("li")!;
    expect(within(felix).getByText("Noch nicht gelesen")).toBeInTheDocument();
    const emma = within(list)
      .getByText(/Emma Klein/)
      .closest("li")!;
    expect(within(emma).getByText("Gelesen")).toBeInTheDocument();
  });

  it("closes the thread only after confirmation", async () => {
    api.closeGroupThread.mockResolvedValue(detail(true));
    render(<GroupMessagePage />);
    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Schließen" }));
    expect(api.closeGroupThread).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Danach können Eltern nicht mehr antworten/),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(api.closeGroupThread).toHaveBeenCalledWith("4"));
    expect(mutate).toHaveBeenCalledWith(detail(true), { revalidate: false });
  });

  it("offers no composer and no close once closed", () => {
    state.detail = detail(true);
    render(<GroupMessagePage />);
    expect(
      screen.getByText(/Diese Gruppennachricht ist geschlossen/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Nachricht" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        statusLine("Gruppe Bären", "1 von 2 Familien gelesen", "Geschlossen"),
      ),
    ).toBeInTheDocument();
  });

  // #8214: Der Schuljahreswechsel nimmt die Klassen-Nachricht mit.
  it("sagt an einer versetzten Klassen-Nachricht, in welcher Klasse sie jetzt ist", () => {
    const moved = detail(false);
    state.detail = {
      ...moved,
      thread: {
        ...moved.thread,
        target_type: "class",
        target_id: "4a",
        target_label: "Klasse 4a",
        class_move: { from_class: "3a", to_class: "4a" },
      },
    };
    render(<GroupMessagePage />);
    expect(
      screen.getByText("Klasse wurde versetzt: jetzt 4a"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Neue Nachrichten gehen weiter an dieselben Familien/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Nachricht" }),
    ).toBeInTheDocument();
  });

  it("nennt den Grund, wenn der Schuljahreswechsel die Klassen-Nachricht geschlossen hat", () => {
    const left = detail(true);
    state.detail = {
      ...left,
      thread: {
        ...left.thread,
        target_type: "class",
        target_id: "4a",
        target_label: "Klasse 4a",
        class_move: { from_class: "4a", to_class: null },
      },
    };
    render(<GroupMessagePage />);
    expect(
      screen.getByText(
        "Die Kinder dieser Klasse 4a haben die OGS zum Schuljahreswechsel verlassen. Darum ist diese Gruppennachricht geschlossen. Eltern können nicht mehr antworten.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Nachricht" }),
    ).not.toBeInTheDocument();
  });

  it("aktualisiert die offene Ansicht nach einer Nachricht aus einem anderen Tab", async () => {
    render(<GroupMessagePage />);
    expect(
      await screen.findByText("Wer bringt einen Kuchen mit?"),
    ).toBeInTheDocument();
    mutate.mockClear();

    // Fake timers skip the 500-ms debounce of the activity event; the real
    // event loop then sees the refetch through.
    vi.useFakeTimers();
    window.dispatchEvent(new CustomEvent("messages-activity"));
    await act(() => vi.advanceTimersByTimeAsync(500));
    releaseFakeTimers();

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mailsMutate).toHaveBeenCalled();
  });

  it("zeigt unter der Nachricht, was aus den E-Mails an die Familien wurde (#7058)", () => {
    state.mails = { "1": { delivered: 1, undeliverable: 1 } };
    render(<GroupMessagePage />);
    expect(screen.getByTestId("group-message-mails")).toHaveTextContent(
      "E-Mails1 nicht zustellbar1 zugestellt",
    );
    expect(
      screen.getByText(
        "Eine Mail kam nicht an. Welche Adresse betroffen ist, siehst du beim Kind unter „Erziehungsberechtigte“.",
      ),
    ).toBeInTheDocument();
  });
});

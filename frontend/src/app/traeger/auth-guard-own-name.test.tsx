import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";
import { useShellAuth } from "~/lib/shell-auth-context";
import { _resetTraegerHostCache } from "~/lib/traeger-url";

// #6870: the header shows the name of the current Träger membership, not the
// e-mail address of the session; the page „Konto“ updates it in place.

vi.unmock("swr");
const { mockUseSession, api } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  api: {
    fetchTraegerOrganization: vi.fn(),
    fetchTraegerProfile: vi.fn(),
    changeTraegerProfileName: vi.fn(),
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  usePathname: () => "/traeger/konto",
}));
vi.mock("~/lib/traeger-api", () => api);
// „Konto“ also lists the trusted devices; these tests cover the name only.
vi.mock("~/lib/mfa-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mfa-api")>()),
  listTrustedDevices: () => Promise.resolve([]),
}));
// The real shell needs the whole portal; the header reads the same context.
vi.mock("~/components/traeger/traeger-shell", () => ({
  TraegerShell: ({ children }: { children: React.ReactNode }) => (
    <>
      <HeaderName />
      {children}
    </>
  ),
}));

function HeaderName() {
  const { user } = useShellAuth();
  return <p data-testid="header-name">{user?.name}</p>;
}

import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { TraegerAuthGuard } from "./auth-guard";
import TraegerAccountPage from "./konto/page";

function sessionOf(id: string, orgId: number, email: string) {
  return {
    status: "authenticated",
    data: {
      user: { id, orgId, scope: "org", email, name: email, roles: [] },
    },
  };
}

function ReloadProfile() {
  const { reload } = useTraegerResource(
    traegerKeys.profile(),
    api.fetchTraegerProfile,
    "Ihr Konto",
  );
  return (
    <button type="button" onClick={reload}>
      Reload profile
    </button>
  );
}

function renderPortal(page: React.ReactNode = <p>Seite</p>) {
  const cache = new Map();
  return render(
    <ToastProvider>
      <TraegerAuthGuard>{page}</TraegerAuthGuard>
    </ToastProvider>,
    {
      wrapper: ({ children }) => (
        <SWRConfig value={{ provider: () => cache, errorRetryCount: 0 }}>
          {children}
        </SWRConfig>
      ),
    },
  );
}

const headerName = () => screen.getByTestId("header-name");

describe("Träger header name (#6870)", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchTraegerOrganization.mockResolvedValue({
      id: "7",
      name: "Träger",
      testSystem: false,
    });
    mockUseSession.mockReturnValue(sessionOf("4", 7, "kasse@traeger.example"));
    vi.stubEnv("NEXT_PUBLIC_TRAEGER_HOSTNAME", "traeger.localhost:3000");
    _resetTraegerHostCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetTraegerHostCache();
  });

  it("shows the name of the membership instead of the e-mail address", async () => {
    api.fetchTraegerProfile.mockResolvedValue({
      accountId: "4",
      email: "kasse@traeger.example",
      name: "Karl Kasse",
    });
    renderPortal();

    await waitFor(() => expect(headerName()).toHaveTextContent("Karl Kasse"));
  });

  it("uses the neutral fallback for an account without a name", async () => {
    api.fetchTraegerProfile.mockResolvedValue({
      accountId: "4",
      email: "kasse@traeger.example",
      name: "",
    });
    renderPortal();

    await waitFor(() => expect(api.fetchTraegerProfile).toHaveBeenCalled());
    expect(headerName()).toHaveTextContent("Träger-Büro");
  });

  it("uses the neutral fallback when the profile cannot be read", async () => {
    api.fetchTraegerProfile.mockRejectedValue(new Error("offline"));
    renderPortal();

    await waitFor(() => expect(api.fetchTraegerProfile).toHaveBeenCalled());
    expect(headerName()).toHaveTextContent("Träger-Büro");
  });

  it("takes a name saved under „Konto“ without signing in again", async () => {
    api.fetchTraegerProfile.mockResolvedValue({
      accountId: "4",
      email: "kasse@traeger.example",
      name: "",
    });
    api.changeTraegerProfileName.mockResolvedValue({
      accountId: "4",
      email: "kasse@traeger.example",
      name: "Karl Kasse",
    });
    renderPortal(<TraegerAccountPage />);

    const field = await screen.findByRole("textbox", { name: /Ihr Name/ });
    expect(headerName()).toHaveTextContent("Träger-Büro");
    fireEvent.change(field, { target: { value: "Karl Kasse" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(headerName()).toHaveTextContent("Karl Kasse"));
  });

  it("keeps the saved name when a profile read from before the save answers later", async () => {
    const oldProfile = {
      accountId: "4",
      email: "kasse@traeger.example",
      name: "Karl Kasse",
    };
    // Header and „Konto“ share one profile (#4986): the read still running
    // at the save is a reload of that shared profile.
    let answerLate: (profile: typeof oldProfile) => void = () => {};
    api.fetchTraegerProfile.mockResolvedValueOnce(oldProfile);
    api.fetchTraegerProfile.mockReturnValueOnce(
      new Promise<typeof oldProfile>((resolve) => {
        answerLate = resolve;
      }),
    );
    api.changeTraegerProfileName.mockResolvedValue({
      ...oldProfile,
      name: "Karla Kasse",
    });
    renderPortal(
      <>
        <ReloadProfile />
        <TraegerAccountPage />
      </>,
    );

    const field = await screen.findByRole("textbox", { name: /Ihr Name/ });
    await waitFor(() => expect(headerName()).toHaveTextContent("Karl Kasse"));
    fireEvent.click(screen.getByRole("button", { name: "Reload profile" }));
    await waitFor(() =>
      expect(api.fetchTraegerProfile).toHaveBeenCalledTimes(2),
    );
    fireEvent.change(field, { target: { value: "Karla Kasse" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(headerName()).toHaveTextContent("Karla Kasse"));

    await act(async () => answerLate(oldProfile));
    expect(headerName()).toHaveTextContent("Karla Kasse");
    expect(field).toHaveValue("Karla Kasse");
  });

  it("drops the name of the former membership after a change of Träger", async () => {
    api.fetchTraegerProfile.mockResolvedValueOnce({
      accountId: "4",
      email: "kasse@traeger.example",
      name: "Karl Kasse",
    });
    const view = renderPortal();
    await waitFor(() => expect(headerName()).toHaveTextContent("Karl Kasse"));

    // The other Träger answers later; until then its name is unknown.
    let answer: (value: unknown) => void = () => {};
    api.fetchTraegerProfile.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    mockUseSession.mockReturnValue(sessionOf("4", 8, "kasse@traeger.example"));
    view.rerender(
      <ToastProvider>
        <TraegerAuthGuard>
          <p>Seite</p>
        </TraegerAuthGuard>
      </ToastProvider>,
    );

    expect(headerName()).toHaveTextContent("Träger-Büro");
    await act(async () =>
      answer({
        accountId: "4",
        email: "kasse@traeger.example",
        name: "K. Kasse",
      }),
    );
    expect(headerName()).toHaveTextContent("K. Kasse");
  });
});

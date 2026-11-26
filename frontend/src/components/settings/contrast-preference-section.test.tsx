import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContrastAccountSync } from "./contrast-account-sync";
import { ContrastPreferenceHydration } from "./contrast-preference-hydration";
import { ContrastPreferenceSection } from "./contrast-preference-section";

const mocks = vi.hoisted(() => ({
  readAccountContrast: vi.fn(),
  storeAccountContrast: vi.fn(),
  useSession: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("~/lib/contrast-account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/contrast-account")>()),
  readAccountContrast: mocks.readAccountContrast,
  storeAccountContrast: mocks.storeAccountContrast,
}));
vi.mock("next-auth/react", () => ({ useSession: mocks.useSession }));
vi.mock("~/contexts/ToastContext", () => ({
  useApiErrorDisplay: () => ({ show: mocks.showError }),
}));

function signedIn(isPreview = false) {
  mocks.useSession.mockReturnValue({
    status: "authenticated",
    data: { user: { id: "7", isPreview } },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  delete document.documentElement.dataset.contrast;
  document.cookie = "moto_contrast=; path=/; max-age=0";
});

afterEach(() => vi.clearAllMocks());

describe("ContrastPreferenceSection", () => {
  it("stores the choice at the account and applies it at once", async () => {
    mocks.storeAccountContrast.mockResolvedValue(true);
    render(<ContrastPreferenceSection portal="school" />);

    const toggle = screen.getByRole("switch", {
      name: "Dunklere Ränder an Eingabefeldern",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);

    expect(document.documentElement.dataset.contrast).toBe("more");
    expect(document.cookie).toContain("moto_contrast=more");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(mocks.storeAccountContrast).toHaveBeenCalledWith("school", true),
    );
  });

  it("springs back and reports when the account refuses the choice", async () => {
    const failure = new Error("offline");
    mocks.storeAccountContrast.mockRejectedValue(failure);
    render(<ContrastPreferenceSection portal="parent" />);

    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() => expect(mocks.showError).toHaveBeenCalled());
    expect(mocks.showError.mock.calls[0]?.[0]).toBe(failure);
    expect(document.documentElement.dataset.contrast).toBeUndefined();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("serializes rapid choices and ignores a stale save failure", async () => {
    const first = deferred<boolean | null>();
    const second = deferred<boolean | null>();
    mocks.storeAccountContrast
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<ContrastPreferenceSection portal="parent" />);

    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mocks.storeAccountContrast).toHaveBeenCalledOnce(),
    );
    first.reject(new Error("first save failed"));
    await waitFor(() =>
      expect(mocks.storeAccountContrast).toHaveBeenCalledTimes(2),
    );
    second.resolve(false);

    await waitFor(() =>
      expect(document.documentElement.dataset.contrast).toBe("normal"),
    );
    expect(mocks.showError).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("uses the server's cookie snapshot during hydration", () => {
    document.documentElement.dataset.contrast = "more";

    render(
      <ContrastPreferenceHydration moreContrast>
        <ContrastPreferenceSection portal="tenant" />
      </ContrastPreferenceHydration>,
    );

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});

describe("ContrastAccountSync", () => {
  it("takes over the account's choice on this device", async () => {
    signedIn();
    mocks.readAccountContrast.mockResolvedValue(true);
    render(<ContrastAccountSync portal="caterer" />);

    await waitFor(() =>
      expect(document.documentElement.dataset.contrast).toBe("more"),
    );
    expect(mocks.readAccountContrast).toHaveBeenCalledWith("caterer");
  });

  it("drops a device choice when the account has none", async () => {
    signedIn();
    document.documentElement.dataset.contrast = "more";
    mocks.readAccountContrast.mockResolvedValue(null);
    render(<ContrastAccountSync portal="tenant" />);

    await waitFor(() =>
      expect(document.documentElement.dataset.contrast).toBeUndefined(),
    );
  });

  it("keeps the device's look in a staff-view preview", async () => {
    signedIn(true);
    document.documentElement.dataset.contrast = "normal";
    render(<ContrastAccountSync portal="tenant" />);

    await act(async () => {});
    expect(mocks.readAccountContrast).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.contrast).toBe("normal");
  });

  it("does not replace a later local choice with a pending account read", async () => {
    signedIn();
    const pendingRead = deferred<boolean | null>();
    mocks.readAccountContrast.mockReturnValue(pendingRead.promise);
    mocks.storeAccountContrast.mockResolvedValue(true);
    render(
      <>
        <ContrastAccountSync portal="tenant" />
        <ContrastPreferenceSection portal="tenant" />
      </>,
    );

    await waitFor(() =>
      expect(mocks.readAccountContrast).toHaveBeenCalledWith("tenant"),
    );
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(mocks.storeAccountContrast).toHaveBeenCalledWith("tenant", true),
    );
    await act(async () => pendingRead.resolve(false));

    expect(document.documentElement.dataset.contrast).toBe("more");
  });
});

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

import { FamilyProtectionControl } from "./family-protection-control";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import {
  getFamilyProtection,
  setFamilyProtection,
} from "~/lib/change-request-list-api";
import { catalogText } from "~/test/error-catalog-text";

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

vi.mock("~/lib/change-request-list-api", () => ({
  getFamilyProtection: vi.fn(),
  setFamilyProtection: vi.fn(),
}));

const mockGet = vi.mocked(getFamilyProtection);
const mockSet = vi.mocked(setFamilyProtection);

function renderControl(initialEnabled?: boolean) {
  return render(
    <ToastProvider>
      <FamilyProtectionControl
        studentId="10"
        canManage
        initialEnabled={initialEnabled}
      />
    </ToastProvider>,
  );
}

describe("FamilyProtectionControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates the child record's protection cache after a seeded save", async () => {
    mockGet.mockReset().mockResolvedValue({ student_id: "10", enabled: false });
    mockSet.mockResolvedValue(undefined);
    const changed = vi.fn();
    function View({ seeded }: { seeded: boolean }) {
      return (
        <ToastProvider>
          <FamilyProtectionControl
            key={String(seeded)}
            studentId="10"
            canManage={seeded}
            initialEnabled={seeded ? false : undefined}
            onChanged={changed}
          />
        </ToastProvider>
      );
    }
    const view = render(<View seeded={false} />);
    expect(await screen.findByText("Ausgeschaltet")).toBeVisible();
    view.rerender(<View seeded />);
    fireEvent.click(screen.getByRole("button", { name: "Einschalten" }));
    fireEvent.change(screen.getByLabelText("Grund für die Änderung"), {
      target: { value: "Private Angaben schützen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schutz einschalten" }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(true));
    mockGet.mockResolvedValue({ student_id: "10", enabled: true });
    view.rerender(<View seeded={false} />);
    expect(await screen.findByText("Eingeschaltet")).toBeVisible();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("zeigt einen Ladefehler vor Ort und lädt per Wiederholen neu", async () => {
    mockGet
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce({ student_id: "10", enabled: true });

    renderControl();

    expect(
      await screen.findByText(
        "Die Einstellung zum Familienschutz ist gerade nicht erreichbar. Bitte versuche es erneut.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("alert", { name: /^Fehler:/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    expect(await screen.findByText("Eingeschaltet")).toBeVisible();
    expect(screen.queryByText(/nicht erreichbar/)).toBeNull();
  });

  it("zeigt einen Speicherfehler im Dialog und markiert die Begründung", async () => {
    mockSet.mockRejectedValueOnce(
      new ApiError("reason required", 400, {
        code: "students.reason_required",
        errors: [{ field: "reason", reason: "required" }],
      }),
    );

    renderControl(false);

    fireEvent.click(screen.getByRole("button", { name: "Einschalten" }));
    const reason = screen.getByLabelText("Grund für die Änderung");
    fireEvent.change(reason, { target: { value: "Schutz nötig" } });
    fireEvent.click(screen.getByRole("button", { name: "Schutz einschalten" }));

    expect(
      await screen.findByText(
        catalogText(
          "students.reason_required",
          "die Einstellung zum Familienschutz",
        ),
      ),
    ).toBeVisible();
    await waitFor(() => expect(reason).toHaveAttribute("aria-invalid", "true"));
    expect(
      screen.getByRole("button", { name: "Schutz einschalten" }),
    ).toBeVisible();
  });
});

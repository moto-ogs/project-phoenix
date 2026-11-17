import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { SWRConfig } from "~/lib/swr/testing";
import { EnrollmentActivationDialog } from "./enrollment-activation-dialog";
import { SettingsField } from "./settings-field";

// The proposal is read through real SWR, a fresh cache per render.
vi.unmock("swr");

const mocks = vi.hoisted(() => ({
  permissions: ["config:update", "config:manage"] as string[],
  push: vi.fn(),
  fetchSchoolContactEmail: vi.fn<() => Promise<string>>(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "1", permissions: mocks.permissions },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));

vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: mocks.push }),
}));

vi.mock("~/lib/settings-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSchoolContactEmail: mocks.fetchSchoolContactEmail,
}));

function renderDialog(
  props: Partial<React.ComponentProps<typeof EnrollmentActivationDialog>> = {},
) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <ToastProvider>
        <EnrollmentActivationDialog
          isOpen
          onClose={onClose}
          noticePresent
          currentRecipients=""
          onSave={onSave}
          {...props}
        />
      </ToastProvider>
    </SWRConfig>,
  );
  return { onSave, onClose };
}

beforeEach(() => {
  mocks.permissions = ["config:update", "config:manage"];
  mocks.push.mockReset();
  mocks.fetchSchoolContactEmail.mockReset();
  mocks.fetchSchoolContactEmail.mockResolvedValue("kontakt@schule.example");
});

describe("EnrollmentActivationDialog (#7176)", () => {
  it("leads to the privacy notice instead of switching on without one", () => {
    const { onSave, onClose } = renderDialog({ noticePresent: false });

    const dialog = screen.getByRole("dialog", {
      name: "Zuerst die Datenschutzinformation eintragen",
    });
    expect(dialog).toHaveTextContent("Sie fehlt noch.");
    fireEvent.click(
      screen.getByRole("button", { name: "Zur Datenschutzinformation" }),
    );

    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
      "/settings?tab=enrollment&highlight=enrollment.legal_dsgvo_enabled",
    );
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("names who may enter the notice when the person may not", () => {
    mocks.permissions = ["config:update"];
    renderDialog({ noticePresent: false });

    expect(
      screen.getByRole("button", { name: "Zur Datenschutzinformation" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("dialog", {
        name: "Zuerst die Datenschutzinformation eintragen",
      }),
    ).toHaveTextContent(/Eintragen kann sie eine Person mit dem Recht/);
  });

  it("prefills the school's contact address and saves it before switching on", async () => {
    const { onSave, onClose } = renderDialog();

    const field = screen.getByLabelText("Empfänger für neue Anmeldungen");
    await waitFor(() => expect(field).toHaveValue("kontakt@schule.example"));
    fireEvent.click(screen.getByRole("button", { name: "Einschalten" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave.mock.calls).toEqual([
      ["enrollment.notification_emails", "kontakt@schule.example"],
      ["enrollment.enabled", true],
    ]);
  });

  it("keeps stored recipients and lets the field stay empty", async () => {
    const { onSave, onClose } = renderDialog({
      currentRecipients: "leitung@schule.example",
    });

    const field = screen.getByLabelText("Empfänger für neue Anmeldungen");
    expect(field).toHaveValue("leitung@schule.example");
    expect(mocks.fetchSchoolContactEmail).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Einschalten" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave.mock.calls).toEqual([
      ["enrollment.notification_emails", ""],
      ["enrollment.enabled", true],
    ]);
  });

  it("does not switch on when saving recipients fails", async () => {
    const onSave = vi.fn(async (key: string) => {
      if (key === "enrollment.notification_emails") {
        throw new ApiError("invalid recipients", 400, {
          code: "general.input",
        });
      }
    });
    const { onClose } = renderDialog({ onSave });

    const field = screen.getByLabelText("Empfänger für neue Anmeldungen");
    await waitFor(() => expect(field).toHaveValue("kontakt@schule.example"));
    fireEvent.click(screen.getByRole("button", { name: "Einschalten" }));

    expect(
      await screen.findByText(
        catalogText("general.input", "die Online-Anmeldung"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Online-Anmeldung einschalten" }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave.mock.calls).toEqual([
      ["enrollment.notification_emails", "kontakt@schule.example"],
    ]);
  });

  it("shows the refusal of the server in the dialog", async () => {
    const onSave = vi.fn(async (key: string) => {
      if (key === "enrollment.enabled") {
        throw new ApiError("refused", 400, {
          code: "settings.enrollment_privacy_notice_missing",
        });
      }
    });
    const { onClose } = renderDialog({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "Einschalten" }));

    expect(
      await screen.findByText(
        catalogText(
          "settings.enrollment_privacy_notice_missing",
          "die Online-Anmeldung",
        ),
      ),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledExactlyOnceWith("enrollment.enabled", true);
  });
});

describe("SettingsField enrollment.enabled", () => {
  it("opens the activation dialog instead of saving", () => {
    const onSave = vi.fn();
    const onEnrollmentEnable = vi.fn();
    render(
      <ToastProvider>
        <SettingsField
          setting={{
            key: "enrollment.enabled",
            label: "Online-Anmeldung",
            description: "",
            type: "boolean",
            default: false,
            value: false,
            is_default: true,
            writable: true,
            visible: true,
            sort_order: 1,
            access_policy: "shared",
            levels: "schule",
            source: "default",
          }}
          onSave={onSave}
          onReset={vi.fn()}
          onEnrollmentEnable={onEnrollmentEnable}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Online-Anmeldung" }));

    expect(onEnrollmentEnable).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});

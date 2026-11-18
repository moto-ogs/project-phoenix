/**
 * Tests for DeleteDeviceModal (Geräteentfernung, #2319).
 *
 * Covers: null device returns null, what removal does, the open-session
 * and system-device preflight, the two-step confirmation, success and
 * already-removed outcomes, and the error path that keeps the modal open.
 */
import {
  render as renderPlain,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { ERROR_CATALOG } from "~/lib/error-catalog.generated";
import { SWRConfig } from "~/lib/swr/testing";
import { catalogText } from "~/test/error-catalog-text";

vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "account-1", scope: "platform" },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));

function Wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <ToastProvider>{children}</ToastProvider>
    </SWRConfig>
  );
}

function render(ui: React.ReactElement) {
  return renderPlain(ui, { wrapper: Wrapper });
}

const FREE_STATUS = {
  isOnline: true,
  isProtected: false,
  lastSeen: null,
  activeSession: null,
  canTransfer: false,
};

/** Opens the two-step gate once the preflight allows the removal. */
async function confirmRemoval() {
  const first = await screen.findByRole("button", { name: "Ja, entfernen" });
  await waitFor(() => expect(first).toBeEnabled());
  fireEvent.click(first);
}

/** What the shared path shows for a failure that is no API error. */
function crashText(object: string) {
  const text = ERROR_CATALOG.de.actions.crash.replace("{object}", object);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const { mockDeleteDevice, mockGetStatus } = vi.hoisted(() => ({
  mockDeleteDevice: vi.fn(),
  mockGetStatus: vi.fn(),
}));

vi.mock("~/lib/operator/provisioning-api", () => ({
  operatorProvisioningService: {
    deleteDevice: mockDeleteDevice,
    getDeviceTransferStatus: mockGetStatus,
  },
}));

import { DeleteDeviceModal } from "./delete-device-modal";
import type { OperatorDevice } from "~/lib/operator/provisioning-helpers";

function makeDevice(overrides: Partial<OperatorDevice> = {}): OperatorDevice {
  return {
    id: "1",
    deviceId: "OGS-001",
    deviceType: "ogs",
    name: "Empfang",
    status: "active",
    apiKey: "",
    maskedApiKey: "abc***",
    lastSeen: null,
    isOnline: false,
    schoolId: "10",
    schoolName: "Schule A",
    organizationId: "42",
    organizationName: "Träger A",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DeleteDeviceModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatus.mockResolvedValue(FREE_STATUS);
  });

  it("renders nothing when device is null", () => {
    render(
      <>
        <p>Geräteliste</p>
        <DeleteDeviceModal
          device={null}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText("Geräteliste")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it("names the device, its school and what removal does", () => {
    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    expect(screen.getByText("Gerät entfernen")).toBeInTheDocument();
    expect(screen.getByText("OGS-001")).toBeInTheDocument();
    expect(screen.getByText("Empfang")).toBeInTheDocument();
    expect(screen.getByText(/Schule A/)).toBeInTheDocument();
    expect(
      screen.getByText("Das Gerät verliert sofort den Zugang zu moto."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bisherige Anwesenheiten und Sitzungen bleiben erhalten.",
      ),
    ).toBeInTheDocument();
  });

  it("blocks the removal while the device runs an open session", async () => {
    mockGetStatus.mockResolvedValue({
      ...FREE_STATUS,
      activeSession: {
        id: "300",
        startedAt: "2026-09-09T11:05:00Z",
        activityName: "Fußball-AG",
        roomName: "Turnhalle",
      },
    });

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        /Offene Sitzung seit .* · Fußball-AG · Turnhalle/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ja, entfernen" }),
    ).toBeDisabled();
    expect(mockDeleteDevice).not.toHaveBeenCalled();
  });

  it("blocks the removal of the protected system device", async () => {
    mockGetStatus.mockResolvedValue({ ...FREE_STATUS, isProtected: true });

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/kann nicht entfernt werden/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ja, entfernen" }),
    ).toBeDisabled();
  });

  it("closes as done when the device is gone before the confirmation", async () => {
    mockGetStatus.mockRejectedValue(
      new ApiError("not found", 404, { code: "provisioning.device_not_found" }),
    );
    const onClose = vi.fn();
    const onDeleted = vi.fn().mockResolvedValue(undefined);

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(mockDeleteDevice).not.toHaveBeenCalled();
  });

  it("treats a device someone already removed as done", async () => {
    mockDeleteDevice.mockRejectedValue(
      new ApiError("not found", 404, { code: "provisioning.device_not_found" }),
    );
    const onClose = vi.fn();
    const onDeleted = vi.fn().mockResolvedValue(undefined);

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );

    await confirmRemoval();
    fireEvent.click(
      screen.getByText("Gerät entfernen", { selector: "button" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Abbrechen is clicked at the first step", () => {
    const onClose = vi.fn();
    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={onClose}
        onDeleted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Abbrechen"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockDeleteDevice).not.toHaveBeenCalled();
  });

  it("requires confirmation before invoking the delete API", async () => {
    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    await confirmRemoval();

    // The final button is now visible; deleteDevice has not yet been called
    expect(
      screen.getByRole("button", { name: "Gerät entfernen" }),
    ).toBeInTheDocument();
    expect(mockDeleteDevice).not.toHaveBeenCalled();
  });

  it("deletes the device, calls onDeleted, and closes on success", async () => {
    mockDeleteDevice.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onDeleted = vi.fn().mockResolvedValue(undefined);

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );

    await confirmRemoval();
    fireEvent.click(screen.getByRole("button", { name: "Gerät entfernen" }));

    await waitFor(() => {
      expect(mockDeleteDevice).toHaveBeenCalledWith("1");
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // #6652: the deletion is done once the write holds. The reload runs after
  // the dialog closed; it never decides whether the deletion shows as done.
  it("closes after the deletion while the reload still runs", async () => {
    mockDeleteDevice.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onDeleted = vi.fn(() => new Promise<boolean>(() => undefined));

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );

    await confirmRemoval();
    fireEvent.click(screen.getByRole("button", { name: "Gerät entfernen" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(mockDeleteDevice).toHaveBeenCalledTimes(1);
  });

  it("surfaces the API error message and keeps the modal open on failure", async () => {
    mockDeleteDevice.mockRejectedValue(
      new ApiError("device in use", 409, {
        code: "provisioning.device_active_session",
      }),
    );
    const onClose = vi.fn();
    const onDeleted = vi.fn();

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );

    await confirmRemoval();
    fireEvent.click(screen.getByRole("button", { name: "Gerät entfernen" }));

    expect(
      await screen.findByText(
        catalogText(
          "provisioning.device_active_session",
          "das Entfernen des Geräts",
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("device in use")).toBeNull();
    // The failure re-checks the device: a session may have started.
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledTimes(2));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables both buttons and shows in-flight label while delete is pending", async () => {
    let resolveDelete: (() => void) | undefined;
    mockDeleteDevice.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    await confirmRemoval();
    fireEvent.click(screen.getByRole("button", { name: "Gerät entfernen" }));

    await waitFor(() => {
      expect(screen.getByText("Wird entfernt…")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Wird entfernt…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDisabled();

    resolveDelete?.();
  });

  it("does not fire a second delete request when the button is clicked twice rapidly", async () => {
    let resolveDelete: (() => void) | undefined;
    mockDeleteDevice.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    await confirmRemoval();
    const confirmButton = screen.getByRole("button", {
      name: "Gerät entfernen",
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockDeleteDevice).toHaveBeenCalledTimes(1);
    });

    resolveDelete?.();
  });

  it("shows the generic text when the failure is no API error", async () => {
    mockDeleteDevice.mockRejectedValue("non-error value");

    render(
      <DeleteDeviceModal
        device={makeDevice()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    await confirmRemoval();
    fireEvent.click(screen.getByRole("button", { name: "Gerät entfernen" }));

    await waitFor(() => {
      expect(
        screen.getByText(crashText("das Entfernen des Geräts")),
      ).toBeInTheDocument();
    });
  });
});

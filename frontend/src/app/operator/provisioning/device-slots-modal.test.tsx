import "@testing-library/jest-dom/vitest";
import {
  render as renderPlain,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";

function render(ui: React.ReactElement) {
  return renderPlain(ui, { wrapper: ToastProvider });
}

const { mockSetSlots } = vi.hoisted(() => ({ mockSetSlots: vi.fn() }));

vi.mock("~/lib/operator/provisioning-api", () => ({
  operatorProvisioningService: {
    setSchoolDeviceSlots: (...args: unknown[]) => mockSetSlots(...args),
  },
}));

vi.mock("~/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { DeviceSlotsModal } from "./device-slots-modal";
import type { SchoolSummary } from "~/lib/operator/provisioning-helpers";

const school: SchoolSummary = {
  id: "10",
  organizationId: "1",
  organizationName: "Test Org",
  name: "OGS Am Park",
  slug: "am-park",
  subdomain: "am-park",
  active: true,
  hidden: false,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  deletedAt: null,
  address: "",
  city: "",
  zip: "",
  phone: "",
  email: "",
  kontenCount: 2,
  geraeteCount: 3,
  personenCount: 30,
  childQuotaBundles: null,
  childQuotaBundleSize: 50,
  childQuotaCount: 0,
  deviceSlots: 5,
};

function renderModal(target: SchoolSummary = school) {
  const onClose = vi.fn();
  const onUpdated = vi.fn().mockResolvedValue(undefined);
  render(
    <DeviceSlotsModal
      isOpen
      onClose={onClose}
      school={target}
      onUpdated={onUpdated}
    />,
  );
  return { onClose, onUpdated };
}

const field = () =>
  screen.getByRole("textbox", { name: "Anzahl Geräteplätze" });

describe("DeviceSlotsModal (#2312)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetSlots.mockResolvedValue(undefined);
  });

  it("raises the limit and shows the places free afterwards", async () => {
    const { onClose, onUpdated } = renderModal();
    expect(field()).toHaveValue("5");
    expect(screen.getByTestId("device-slots-occupied")).toHaveTextContent(
      "3 Geräte",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Einen Geräteplatz mehr" }),
    );
    expect(screen.getByTestId("device-slots-free")).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(mockSetSlots).toHaveBeenCalledWith("10", 6));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onUpdated).toHaveBeenCalled();
  });

  it("warns below the registered devices and leaves the decision to moto", async () => {
    mockSetSlots.mockRejectedValue(
      new ApiError("below", 409, {
        code: "provisioning.device_slots_below_occupied",
        details: { device_slots: 2, occupied: 3 },
      }),
    );
    const { onClose } = renderModal();

    fireEvent.change(field(), { target: { value: "2" } });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Die Schule hat 3 registrierte Geräte",
    );
    // The count on the page can be outdated: saving still asks the backend.
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(mockSetSlots).toHaveBeenCalledWith("10", 2));
    expect(await screen.findByText(/belegt sind schon 3/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks saving a value that is no number of places", () => {
    renderModal();

    fireEvent.change(field(), { target: { value: "viele" } });

    const save = screen.getByRole("button", { name: "Speichern" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(save);
    expect(mockSetSlots).not.toHaveBeenCalled();
  });

  it("starts at the occupied places when the school has no limit", () => {
    renderModal({ ...school, deviceSlots: null });

    expect(field()).toHaveValue("3");
    expect(
      screen.queryByRole("button", { name: "Grenze entfernen" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the backend's refusal in the dialog", async () => {
    mockSetSlots.mockRejectedValue(
      new ApiError("below", 409, {
        code: "provisioning.device_slots_below_occupied",
        details: { device_slots: 5, occupied: 6 },
      }),
    );
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    // The catalog text names the registered devices from the details.
    expect(await screen.findByText(/belegt sind schon 6/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

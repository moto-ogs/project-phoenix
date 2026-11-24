vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "account-1", tenantId: 1, scope: "tenant" },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);

import { ApiError } from "~/lib/api-error";
import { DevicesMasterDetail } from "./devices-master-detail";
import type { GroupDefinition } from "~/components/database/grouped-list";
import type { Device } from "@/lib/iot-helpers";

const onlineDevice: Device = {
  id: "1",
  device_id: "kiosk-001",
  device_type: "kiosk",
  name: "Eingang Kiosk",
  status: "active",
  is_online: true,
  room_name: "Foyer",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  version: "v1",
};

const offlineDeviceWithKey: Device = {
  ...onlineDevice,
  id: "2",
  device_id: "kiosk-002",
  name: "Backup Kiosk",
  is_online: false,
  status: "offline",
  api_key: "secret-token-abc",
  last_seen: "2026-01-01T00:00:00Z",
};

function flatGroup(devices: Device[]): GroupDefinition<Device>[] {
  if (devices.length === 0) return [];
  return [
    {
      id: "__flat__",
      title: `Alle Geräte (${devices.length})`,
      items: devices,
    },
  ];
}

describe("DevicesMasterDetail", () => {
  const onSelect = vi.fn();
  const onSaveDevice = vi.fn(
    async (data: Partial<Device>, _version: string | undefined) =>
      ({ ...onlineDevice, ...data }) as Device,
  );
  const reloadDevice = vi.fn(async () => onlineDevice);
  const onDeleteClick = vi.fn();
  const onSetBlocked = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty detail state when nothing is selected", () => {
    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([onlineDevice])}
        selectedId={null}
        selectedDevice={null}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    expect(screen.queryByText("Bearbeiten")).not.toBeInTheDocument();
    expect(screen.getByText("Eingang Kiosk")).toBeInTheDocument();
  });

  it("renders the selected device detail with id, room, and status", () => {
    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([onlineDevice])}
        selectedId="1"
        selectedDevice={onlineDevice}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    expect(screen.getAllByText("Eingang Kiosk").length).toBeGreaterThan(0);
    expect(screen.getByText("kiosk-001")).toBeInTheDocument();
    expect(screen.getByText("Foyer")).toBeInTheDocument();
    // Einmal als Pille in der Liste, einmal im Feld „Verbindung“.
    expect(screen.getAllByText("Online")).toHaveLength(2);
  });

  it("shows a device without edit, block or remove to devices:read (#2312)", () => {
    const blocked: Device = { ...onlineDevice, status: "inactive" };
    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([blocked])}
        selectedId="1"
        selectedDevice={blocked}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage={false}
      />,
    );

    expect(screen.getByText("kiosk-001")).toBeInTheDocument();
    expect(
      screen.getByText(
        /bis es jemand mit dem Recht „Geräte verwalten“ entsperrt/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Bearbeiten")).not.toBeInTheDocument();
    expect(screen.queryByText("Entfernen")).not.toBeInTheDocument();
    expect(screen.queryByText("Entsperren")).not.toBeInTheDocument();
    expect(screen.queryByText("Sperren")).not.toBeInTheDocument();
  });

  it("opens the inline edit form from the header and triggers delete", () => {
    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([onlineDevice])}
        selectedId="1"
        selectedDevice={onlineDevice}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    fireEvent.click(screen.getByText("Entfernen"));
    expect(onDeleteClick).toHaveBeenCalled();

    // Bearbeitet wird im Detailbereich, nicht in einem Modal daneben: der
    // Knopf schaltet das Formular ein, mit Speichern und Abbrechen unten.
    fireEvent.click(screen.getByText("Bearbeiten"));
    expect(
      screen.getByRole("button", { name: "Speichern" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Abbrechen" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Bearbeiten")).not.toBeInTheDocument();
  });

  // ADR 0311: the edit sends the version of the device as it opened, and a
  // refused save shows the stored device and saves on its version.
  it("saves on the version read when editing started and shows the stored device after a refusal", async () => {
    const stored: Device = {
      ...onlineDevice,
      name: "Von der Kollegin",
      version: "v2",
    };
    const save = vi
      .fn<
        (data: Partial<Device>, version: string | undefined) => Promise<Device>
      >()
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockImplementation(async (data) => ({
        ...stored,
        ...data,
        version: "v3",
      }));
    const reload = vi.fn(async () => stored);
    const view = (device: Device) => (
      <DevicesMasterDetail
        groupDefinitions={flatGroup([device])}
        selectedId="1"
        selectedDevice={device}
        onSelect={onSelect}
        onSaveDevice={save}
        reloadDevice={reload}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />
    );
    const { rerender } = render(view(onlineDevice));
    fireEvent.click(screen.getByText("Bearbeiten"));
    const name = () =>
      screen.getByDisplayValue<HTMLInputElement>(/Kiosk|Kollegin|Entwurf/);
    fireEvent.change(name(), { target: { value: "Entwurf" } });
    // A background read of a newer device keeps the typed draft.
    rerender(view(stored));
    expect(name()).toHaveValue("Entwurf");

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Entwurf" }),
        "v1",
      ),
    );
    await waitFor(() => expect(reload).toHaveBeenCalledWith("1"));
    await waitFor(() => expect(name()).toHaveValue("Von der Kollegin"));

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith(expect.anything(), "v2"),
    );
  });

  it("renders the API key section only when api_key is present", () => {
    const { rerender } = render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([onlineDevice])}
        selectedId="1"
        selectedDevice={onlineDevice}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    expect(screen.queryByText(/API-Schlüssel/)).not.toBeInTheDocument();

    rerender(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([offlineDeviceWithKey])}
        selectedId="2"
        selectedDevice={offlineDeviceWithKey}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    expect(
      screen.getByText(/API-Schlüssel \(nur einmal sichtbar\)/),
    ).toBeInTheDocument();
    // The hidden input value should match the api key.
    expect(
      (screen.getByDisplayValue("secret-token-abc") as HTMLInputElement).type,
    ).toBe("password");

    fireEvent.click(screen.getByText("Anzeigen"));
    expect(
      (screen.getByDisplayValue("secret-token-abc") as HTMLInputElement).type,
    ).toBe("text");
  });

  it("renders the group titles supplied by the page and a Stammdaten tab", () => {
    render(
      <DevicesMasterDetail
        groupDefinitions={[
          {
            id: "kiosk",
            title: "Kiosk (1)",
            items: [onlineDevice],
          },
          {
            id: "info_point",
            title: "Info Point (1)",
            items: [offlineDeviceWithKey],
          },
        ]}
        selectedId="1"
        selectedDevice={onlineDevice}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    expect(screen.getByText("Kiosk (1)")).toBeInTheDocument();
    expect(screen.getByText("Info Point (1)")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Stammdaten" })).toBeInTheDocument();
  });

  it("toggles the API key reveal back to masked after a second click", () => {
    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([offlineDeviceWithKey])}
        selectedId="2"
        selectedDevice={offlineDeviceWithKey}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    const reveal = screen.getByText("Anzeigen");
    fireEvent.click(reveal);
    expect(
      (screen.getByDisplayValue("secret-token-abc") as HTMLInputElement).type,
    ).toBe("text");

    fireEvent.click(screen.getByText("Verbergen"));
    expect(
      (screen.getByDisplayValue("secret-token-abc") as HTMLInputElement).type,
    ).toBe("password");
  });

  it("copies the API key to the clipboard and flips the button to 'Kopiert!'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([offlineDeviceWithKey])}
        selectedId="2"
        selectedDevice={offlineDeviceWithKey}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    fireEvent.click(screen.getByText("Kopieren"));
    expect(writeText).toHaveBeenCalledWith("secret-token-abc");

    await waitFor(() => {
      expect(screen.getByText("Kopiert!")).toBeInTheDocument();
    });
  });

  it("names the offline status in the list and in the connection field", () => {
    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([offlineDeviceWithKey])}
        selectedId="2"
        selectedDevice={offlineDeviceWithKey}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    // Pille in der Liste, Feld „Verbindung“ und Statuspille der Detailansicht.
    expect(screen.getAllByText("Offline")).toHaveLength(3);
  });

  it("names 'Online' as visible text in the list for is_online devices", () => {
    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([onlineDevice])}
        selectedId={null}
        selectedDevice={null}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    expect(screen.getByText("Online")).toBeInTheDocument();
  });
  it("blocks an active device from the header (#2317)", () => {
    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([onlineDevice])}
        selectedId="1"
        selectedDevice={onlineDevice}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Sperren$/ }));

    expect(onSetBlocked).toHaveBeenCalledWith(true);
    expect(
      screen.queryByText(/Dieses Gerät ist gesperrt/),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Online").length).toBeGreaterThan(0);
  });

  it("shows a blocked device as blocked and unblocks it (#2317)", () => {
    const blockedDevice: Device = { ...onlineDevice, status: "inactive" };
    render(
      <DevicesMasterDetail
        groupDefinitions={flatGroup([blockedDevice])}
        selectedId="1"
        selectedDevice={blockedDevice}
        onSelect={onSelect}
        onSaveDevice={onSaveDevice}
        reloadDevice={reloadDevice}
        onDeleteClick={onDeleteClick}
        onSetBlocked={onSetBlocked}
        blockPending={false}
        canManage
      />,
    );

    // The list pill and the status field name the block; the connection
    // overview says the device cannot connect instead of „Online“ (#2321).
    expect(screen.getAllByText("Gesperrt")).toHaveLength(2);
    expect(screen.getByText("Keine Verbindung möglich")).toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Dieses Gerät ist gesperrt\. Es kann sich nicht anmelden/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Foyer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Entsperren$/ }));

    expect(onSetBlocked).toHaveBeenCalledWith(false);
  });
});

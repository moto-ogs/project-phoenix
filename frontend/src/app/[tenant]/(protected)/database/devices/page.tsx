"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "~/lib/auth-utils";
import { DeviceSlotStatus } from "~/components/devices/device-slot-status";
import { deviceSlotsFull, fetchDeviceSlots } from "~/lib/device-slots";
import { redirect, useSearchParams } from "next/navigation";
import { DatabaseCreateAction } from "~/components/database/database-create-action";
import { DatabaseGroupingToggle } from "~/components/database/database-grouping-toggle";
import { DatabasePageLayout } from "~/components/database/database-page-layout";
import { formatCount } from "~/lib/format-utils";
import {
  useGroupedItems,
  type Grouper,
} from "~/components/database/use-grouped-items";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import { createCrudService } from "@/lib/database/service-factory";
import { devicesConfig } from "@/components/database/configs/devices.config";
import {
  getDeviceTypeDisplayName,
  isDeviceBlocked,
  type Device,
} from "@/lib/iot-helpers";
import { setDeviceBlocked } from "~/lib/device-blocking-api";
import { DevicesMasterDetail } from "@/components/devices/devices-master-detail";
import {
  DeviceRemovalSummary,
  isDeviceAlreadyRemoved,
} from "~/components/devices/device-removal-summary";
import { DatabaseFormModal } from "~/components/database/database-form-modal";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { BELOW_MD, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useDeleteConfirmation } from "~/hooks/useDeleteConfirmation";
import { useUpdateUrlParams } from "~/hooks/useUpdateUrlParams";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily, useSWRAuth, useTenantMutate } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { ModuleRouteGuard } from "~/components/tenant/module-route-guard";
import { devicesConcept } from "~/lib/concepts/devices";
import { foldForSearch } from "~/lib/search-fold";
import { TenantPageStats } from "~/components/ui/tenant-page";

/** Info-Knopf am Titel: wofür die Seite da ist und was man zuerst tut. */
const DEVICES_INFO =
  "Hier siehst du alle Geräte deiner OGS und ob sie online sind. Ein geliefertes Tablet steht schon in der Liste, du musst es nicht anlegen. Wähle ein Gerät, um es zu sperren oder zu entfernen.";

const logger = createLogger({ component: "DatabaseDevicesPage" });

type DevicesGroupingMode = "none" | "type" | "room";

/** How often a page that shows every Geräteplatz taken asks again. */
const FULL_DEVICE_SLOTS_POLL_MS = 30_000;

const DEVICES_GROUPING_DEFAULT: DevicesGroupingMode = "type";

const DEVICES_GROUPING_OPTIONS: {
  value: DevicesGroupingMode;
  label: string;
}[] = [
  { value: "type", label: "Typ" },
  { value: "room", label: "Raum" },
  { value: "none", label: "Keine" },
];

function parseDevicesGrouping(value: string | null): DevicesGroupingMode {
  if (value === "room" || value === "none") return value;
  return DEVICES_GROUPING_DEFAULT;
}

export default function DevicesPage() {
  return (
    <ModuleRouteGuard
      module="nfc_anwesenheit"
      title="Geräte"
      info={DEVICES_INFO}
    >
      <Suspense fallback={null}>
        <DevicesPageContent />
      </Suspense>
    </ModuleRouteGuard>
  );
}

function DevicesPageContent() {
  const searchParams = useSearchParams();
  const updateUrlParams = useUpdateUrlParams();

  const selectedId = searchParams.get("device");
  const grouping = parseDevicesGrouping(searchParams.get("groupBy"));
  const [searchTerm, setSearchTerm] = useState("");
  const isMobile = useMediaQuery(BELOW_MD);

  // The list response never carries `api_key` (it's a one-time create-only
  // secret). We snapshot the freshly-created device here so the detail panel
  // can render the key until the user navigates away — same dismiss semantics
  // as the pre-master-detail modal had when it closed.
  const [createdDevice, setCreatedDevice] = useState<Device | null>(null);

  const {
    showConfirmModal: showDeleteConfirmModal,
    handleDeleteClick,
    handleDeleteCancel,
  } = useDeleteConfirmation();

  const { success: toastSuccess } = useToast();
  const { show: showActionError } = useApiErrorDisplay();
  const [blockPending, setBlockPending] = useState(false);
  // Schreibfehler bleiben im jeweiligen Dialog (#2517).
  const createErrors = useApiFormError();
  const deleteErrors = useApiFormError();
  const [deletePending, setDeletePending] = useState(false);
  const latestDeleteRef = useRef<() => void>(() => undefined);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { clear: clearCreateErrors } = createErrors;
  // Ein neu geöffnetes Anlegen beginnt ohne den Fehler des vorigen Versuchs.
  useEffect(() => {
    if (showCreateModal) clearCreateErrors();
  }, [showCreateModal, clearCreateErrors]);

  const { data: session, status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });
  // Ansehen braucht devices:read, jede Verwaltung devices:manage (#2312).
  const canManage = hasPermission(session, "devices:manage");

  const service = useMemo(() => createCrudService(devicesConfig), []);
  const tenantMutate = useTenantMutate();
  const invalidateFamily = useInvalidateFamily();
  // A write changes the device and adds to its history (#2321).
  const refreshDevices = useCallback(async () => {
    await Promise.all([
      tenantMutate(tenantAdminKeys.devices()),
      tenantMutate(tenantAdminKeys.deviceSlots()),
      invalidateFamily(tenantAdminKeys.deviceHistoryFamily),
    ]);
  }, [tenantMutate, invalidateFamily]);

  const {
    data: devicesData,
    isLoading: swrLoading,
    error: devicesError,
    mutate: mutateDevices,
  } = useSWRAuth(tenantAdminKeys.devices(), async () => {
    const data = await service.getList();
    return Array.isArray(data.data) ? data.data : [];
  });

  // Geräteplätze der Schule (#2312). Ein Fehler blendet nur die Zeile aus;
  // das Backend prüft die Grenze beim Anlegen ohnehin selbst.
  // moto may raise the limit while the page stays open: every return to
  // the page, and every half minute while all places are taken, asks again,
  // so registering unlocks without a reload. The interval is a number that
  // changes with the answer, so SWR starts its timer once the first answer
  // shows all places taken.
  const [pollDeviceSlots, setPollDeviceSlots] = useState(false);
  const { data: deviceSlots } = useSWRAuth(
    tenantAdminKeys.deviceSlots(),
    fetchDeviceSlots,
    {
      revalidateOnFocus: true,
      focusThrottleInterval: 0,
      refreshInterval: pollDeviceSlots ? FULL_DEVICE_SLOTS_POLL_MS : 0,
      onSuccess: (slots) => setPollDeviceSlots(deviceSlotsFull(slots)),
    },
  );
  const slotsFull = deviceSlots ? deviceSlotsFull(deviceSlots) : false;
  const error = useSwrLoadError(devicesError, "die Liste der Geräte", () =>
    mutateDevices(),
  );
  // Bis der Katalogtext des Ladefehlers da ist, bleibt das Skelett stehen.
  const loading = swrLoading || (Boolean(devicesError) && error === null);

  // Snapshot lifecycle is managed synchronously in the click/edit/delete
  // handlers below — never via an effect on `selectedId`. router.replace is
  // async and useSearchParams lags one render behind it, so any effect that
  // compares createdDevice.id to selectedId would race the URL update and
  // wipe the api_key before it could render.

  // Statuszeile des Seitenkopfs aus der bereits geladenen Geräteliste.
  const statusLine = useMemo(() => {
    const devices = devicesData ?? [];
    const online = devices.filter(
      (d) => d.is_online && !isDeviceBlocked(d),
    ).length;
    const blocked = devices.filter(isDeviceBlocked).length;
    return (
      <TenantPageStats
        items={[
          {
            value: formatCount(devices.length),
            label: devices.length === 1 ? "Gerät" : "Geräte",
          },
          { value: formatCount(online), label: "online" },
          ...(blocked > 0
            ? [{ value: formatCount(blocked), label: "gesperrt" }]
            : []),
        ]}
      />
    );
  }, [devicesData]);

  const filters: FilterConfig[] = useMemo(() => [], []);

  const activeFilters: ActiveFilter[] = useMemo(
    () =>
      searchTerm
        ? [
            {
              id: "search",
              label: `"${searchTerm}"`,
              onRemove: () => setSearchTerm(""),
            },
          ]
        : [],
    [searchTerm],
  );

  const allDevices = useMemo(() => devicesData ?? [], [devicesData]);

  const filteredDevices = useMemo(() => {
    let arr = [...allDevices];
    if (searchTerm) {
      const q = foldForSearch(searchTerm);
      arr = arr.filter(
        (d) =>
          foldForSearch(d.name).includes(q) ||
          foldForSearch(d.device_id).includes(q) ||
          foldForSearch(d.device_type).includes(q),
      );
    }
    arr.sort((a, b) =>
      (a.name ?? a.device_id).localeCompare(b.name ?? b.device_id, "de"),
    );
    return arr;
  }, [allDevices, searchTerm]);

  // Detail lookup uses the unfiltered list so the panel survives a search
  // narrowing the visible rows. The snapshot wins for the just-created device
  // because it's the only place the api_key lives.
  const selectedDevice = useMemo(() => {
    if (!selectedId) return null;
    const fromList = allDevices.find((d) => d.id === selectedId) ?? null;
    if (createdDevice && createdDevice.id === selectedId) {
      return fromList
        ? { ...fromList, api_key: createdDevice.api_key }
        : createdDevice;
    }
    return fromList;
  }, [allDevices, createdDevice, selectedId]);

  const handleSelectDevice = useCallback(
    (id: string | null) => {
      setCreatedDevice((current) =>
        current && current.id !== id ? null : current,
      );
      updateUrlParams({ device: id });
    },
    [updateUrlParams],
  );

  const handleGroupingChange = useCallback(
    (next: DevicesGroupingMode) => {
      updateUrlParams({
        groupBy: next === DEVICES_GROUPING_DEFAULT ? null : next,
      });
    },
    [updateUrlParams],
  );

  const groupers = useMemo<
    Partial<Record<DevicesGroupingMode, Grouper<Device>>>
  >(
    () => ({
      type: (device) => {
        const id = device.device_type || "__no_type__";
        const title = device.device_type
          ? getDeviceTypeDisplayName(device.device_type)
          : "Ohne Typ";
        return { id, title };
      },
      room: (device) => {
        const id = device.room_name?.trim() || "__no_room__";
        const title = device.room_name?.trim() || "Ohne Raum";
        return { id, title };
      },
    }),
    [],
  );

  const groupDefinitions = useGroupedItems(
    filteredDevices,
    grouping,
    groupers,
    "Geräte",
  );

  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false);
  }, []);

  const handleCreateDevice = useCallback(
    async (data: Partial<Device>) => {
      // Ein Fehler bleibt im Dialog: DatabaseForm zeigt ihn über errorPath,
      // eine vergebene Geräte-ID (iot.device_id_taken) markiert das Feld.
      const payload = devicesConfig.form.transformBeforeSubmit
        ? devicesConfig.form.transformBeforeSubmit(data)
        : data;
      const created = await service.create(payload);
      toastSuccess(
        `Das Gerät „${created.name ?? created.device_id}“ ist registriert.`,
      );
      setShowCreateModal(false);
      setCreatedDevice(created);
      handleSelectDevice(created.id);
      await refreshDevices();
    },
    [service, handleSelectDevice, refreshDevices, toastSuccess],
  );

  const handleUpdateDevice = useCallback(
    async (data: Partial<Device>) => {
      if (!selectedDevice) return;
      // Ein Fehler bleibt im Formular (errorPath im Stammdaten-Reiter).
      const payload = devicesConfig.form.transformBeforeSubmit
        ? devicesConfig.form.transformBeforeSubmit(data)
        : data;
      const updatedDevice =
        (await service.update(selectedDevice.id, payload)) ?? selectedDevice;
      // Editing closes the api_key flash — the snapshot would otherwise
      // overlay the freshly-edited list values on the next render.
      setCreatedDevice(null);
      toastSuccess(
        `Das Gerät „${updatedDevice.name ?? updatedDevice.device_id}“ ist gespeichert.`,
      );
      await refreshDevices();
    },
    [selectedDevice, service, refreshDevices, toastSuccess],
  );

  // Gerätesperre (#2317): sofort wirksam und sofort umkehrbar, darum ohne
  // Rückfrage; der Toast nach dem Sperren bietet „Rückgängig“.
  const handleSetBlocked = useCallback(
    async function setBlocked(device: Device, blocked: boolean) {
      const title = device.name ?? device.device_id;
      setBlockPending(true);
      try {
        await setDeviceBlocked(device.device_id, blocked);
      } catch (err) {
        logger.warn("device_block_failed", {
          device_id: device.id,
          blocked,
          error: err instanceof Error ? err.message : String(err),
        });
        void showActionError(err, {
          object: blocked
            ? "das Sperren des Geräts"
            : "das Entsperren des Geräts",
          retry: () => void setBlocked(device, blocked),
        });
        return;
      } finally {
        setBlockPending(false);
      }
      if (blocked) {
        const message = `Das Gerät „${title}“ ist gesperrt. Es kann sich erst wieder anmelden, wenn du es entsperrst.`;
        // Undo restores access, so it is offered only when the device had it.
        toastSuccess(
          message,
          device.status === "active"
            ? {
                action: {
                  label: "Rückgängig",
                  tooltip: "Entsperrt das Gerät sofort wieder.",
                  onClick: () => void setBlocked(device, false),
                },
              }
            : undefined,
        );
      } else {
        toastSuccess(
          `Das Gerät „${title}“ ist entsperrt und kann sich wieder anmelden.`,
        );
      }
      await refreshDevices();
    },
    [showActionError, refreshDevices, toastSuccess],
  );

  const handleDeleteDevice = useCallback(async () => {
    if (!selectedDevice) return;
    const title = selectedDevice.name ?? selectedDevice.device_id;
    setDeletePending(true);
    deleteErrors.clear();
    try {
      const removed = await service.remove(selectedDevice.id);
      if (!removed) return;
      toastSuccess(
        `Das Gerät „${title}“ ist entfernt. Sein Platz ist wieder frei.`,
      );
    } catch (err) {
      logger.warn("device_remove_failed", {
        device_id: selectedDevice.id,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!isDeviceAlreadyRemoved(err)) {
        // Der Bestätigungsdialog bleibt offen und nennt den Grund, etwa
        // eine laufende Sitzung am Gerät.
        void deleteErrors.show(err, {
          object: "das Entfernen des Geräts",
          retry: () => latestDeleteRef.current(),
        });
        return;
      }
      // Das Gerät ist eben schon gegangen (entfernt oder an eine andere
      // Schule übertragen): die Liste lädt neu.
      toastSuccess(`Das Gerät „${title}“ ist hier nicht mehr verfügbar.`);
    } finally {
      setDeletePending(false);
    }
    handleDeleteCancel();
    setCreatedDevice(null);
    handleSelectDevice(null);
    await refreshDevices();
  }, [
    selectedDevice,
    service,
    toastSuccess,
    handleDeleteCancel,
    handleSelectDevice,
    refreshDevices,
    deleteErrors,
  ]);

  useLayoutEffect(() => {
    latestDeleteRef.current = () => void handleDeleteDevice();
  });

  const canShowDetail =
    !loading && (filteredDevices.length > 0 || selectedDevice !== null);

  return (
    <DatabasePageLayout
      loading={loading}
      sessionLoading={status === "loading"}
      error={error}
      empty={
        filteredDevices.length === 0 && selectedDevice === null
          ? {
              title: searchTerm
                ? "Keine Geräte gefunden"
                : "Keine Geräte vorhanden",
              description: searchTerm
                ? "Versuche einen anderen Suchbegriff."
                : canManage
                  ? "Registriere das erste Gerät, um Karten zu lesen."
                  : "Deine Schule hat noch kein Gerät registriert.",
              icon: (
                <MotoDuotoneIcon
                  icon={devicesConcept.icon}
                  tone={devicesConcept.tone}
                  size={48}
                />
              ),
            }
          : null
      }
      overlays={
        <>
          <DatabaseFormModal<Device>
            isOpen={showCreateModal}
            onClose={handleCloseCreateModal}
            mode="create"
            config={devicesConfig}
            onSubmit={handleCreateDevice}
            errorPath={createErrors}
            errorObject="das Gerät"
          />

          {selectedDevice && (
            <ConfirmDeleteModal
              isOpen={showDeleteConfirmModal}
              onClose={handleDeleteCancel}
              onConfirm={() => void handleDeleteDevice()}
              title="Gerät entfernen?"
              description={
                <DeviceRemovalSummary
                  title={selectedDevice.name ?? selectedDevice.device_id}
                  deviceId={selectedDevice.device_id}
                  context={selectedDevice.room_name}
                  footnote="Läuft am Gerät gerade eine Sitzung, beende sie zuerst."
                />
              }
              gate={{ mode: "twoStep", firstStepLabel: "Ja, entfernen" }}
              confirmLabel="Gerät entfernen"
              confirmTooltip="Entfernt das Gerät sofort. Bisherige Anwesenheiten bleiben."
              loadingLabel="Wird entfernt…"
              loading={deletePending}
              error={deleteErrors.error}
            />
          )}
        </>
      }
      className="flex w-full flex-col"
      intro={{
        title: "Geräte",
        info: DEVICES_INFO,
        description: (
          <>
            {statusLine}
            <DeviceSlotStatus slots={deviceSlots} />
          </>
        ),
        actions: (
          <div className="flex items-center gap-2">
            {!isMobile ? (
              <DatabaseGroupingToggle
                value={grouping}
                options={DEVICES_GROUPING_OPTIONS}
                onChange={handleGroupingChange}
              />
            ) : null}
            {canManage ? (
              <DatabaseCreateAction
                label="Gerät"
                ariaLabel="Gerät registrieren"
                onClick={() => setShowCreateModal(true)}
                tooltip="Öffnet ein leeres Formular für ein neues Gerät."
                disabled={slotsFull}
                disabledReason="Alle Geräteplätze sind belegt. Entferne ein Gerät oder melde dich beim moto-Team."
              />
            ) : null}
          </div>
        ),
      }}
      searchRow={{
        badge: {
          icon: (
            <MotoDuotoneIcon
              icon={devicesConcept.icon}
              tone={devicesConcept.tone}
              size={20}
            />
          ),
          count: filteredDevices.length,
          label: "Geräte",
        },
        search: {
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Geräte suchen…",
        },
        filters,
        activeFilters,
        onClearAllFilters: () => {
          setSearchTerm("");
        },
      }}
    >
      {canShowDetail ? (
        <div className="min-h-0 flex-1 pb-4">
          <DevicesMasterDetail
            groupDefinitions={groupDefinitions}
            selectedId={selectedId}
            selectedDevice={selectedDevice}
            onSelect={handleSelectDevice}
            onSaveDevice={handleUpdateDevice}
            onDeleteClick={handleDeleteClick}
            onSetBlocked={(blocked) => {
              if (selectedDevice)
                void handleSetBlocked(selectedDevice, blocked);
            }}
            blockPending={blockPending}
            canManage={canManage}
          />
        </div>
      ) : null}
    </DatabasePageLayout>
  );
}

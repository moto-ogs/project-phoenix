"use client";

import { roomKeys } from "~/lib/swr/rooms-keys";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { FileDown, Trash2 } from "lucide-react";
import { ButtonLink } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import type { OverflowMenuItem } from "~/components/ui/page-header/types";
import {
  TenantPage,
  TenantPageStats,
  type TenantPageTab,
} from "~/components/ui/tenant-page";
import { RoomRemovalModal } from "~/components/rooms/room-removal-modal";
import { RoomStatusBadge } from "~/components/rooms/room-status-badge";
import {
  RoomDetailContent,
  RoomDetailSkeleton,
  useRoomDetail,
} from "~/components/rooms/room-detail-content";
import { RoomStammdatenTab } from "~/components/rooms/room-stammdaten-tab";
import {
  parseRoomPlanView,
  useRoomPlanHref,
  type RoomPlanView,
} from "~/components/rooms/room-plan-navigation";
import {
  RoomPlanControls,
  RoomPlanTab,
} from "~/components/rooms/room-plan-lazy";
import { roomsConfig } from "~/components/database/configs/rooms.config";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { isReadStateRefusal } from "~/lib/api-error";
import { canReadSupervisionData, hasPermission } from "~/lib/auth-utils";
import { useSetBreadcrumb } from "~/lib/breadcrumb-context";
import { useOptionalSupervision } from "~/lib/supervision-context";
import { createCrudService } from "~/lib/database/service-factory";
import { isValidISODate } from "~/lib/date-helpers";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { exportPlan } from "~/lib/plan-export-api";
import { NO_PLAN_FILTER } from "~/lib/plan-filter";
import { roomPlanCareDay } from "~/lib/room-plan";
import {
  formatFloor,
  isSystemRoom,
  type Room,
  withStoredRoomFields,
} from "~/lib/room-helpers";
import {
  useTenantMutate,
  useTenantMutateMatching,
  useSWRSeedFrom,
} from "~/lib/swr";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { ROOM_DERIVED_CACHE_KEY_FRAGMENTS } from "~/lib/swr/room-derived-caches";
import { usePresenceMode, useWeekendFollowsFriday } from "~/lib/tenant-context";
import { resolveDetailReferrer, useTenantAwarePath } from "~/lib/tenant-path";
import { useTenantRouter } from "~/lib/tenant-router";
import { RoomDetailLoadingPage } from "./page-skeleton";
import { roomsConcept } from "~/lib/concepts/rooms";

const ROOM_INFO =
  "Hier siehst du, ob dieser Raum belegt ist. Unter „Kinder im Raum“ stehen die Kinder, die gerade dort sind. Wähle ein Kind, um seine Angaben zu öffnen.";
// Erfasst die Schule nur, ob ein Kind da ist, gibt es keine Belegung.
const ROOM_RECORD_INFO =
  "Hier stehen die Angaben zu diesem Raum. Deine Schule erfasst nicht, welche Kinder in welchem Raum sind.";

const logger = createLogger({ component: "RoomDetailPage" });

type RoomTab = "uebersicht" | "plan" | "stammdaten";

/** Parameter des Reiters „Plan“ (#4768); andere Reiter tragen sie nicht. */
const PLAN_TAB_PARAMS = ["d", "view"] as const;

/** Rückweg-Beschriftung: die Sammlung, aus der man kam (`?from=`). */
function backLabelFor(referrer: string): string {
  return referrer.startsWith("/database/rooms")
    ? "Zurück zu den Räumen der Datenverwaltung"
    : "Zurück zu den Räumen";
}

export default function RoomDetailPage({
  seed,
}: Readonly<{ seed?: ServerSeedInput }>) {
  const roomInfo =
    usePresenceMode() === "binary" ? ROOM_RECORD_INFO : ROOM_INFO;

  return (
    <Suspense fallback={<RoomDetailLoadingPage info={roomInfo} />}>
      <RoomDetailSeed seed={seed} />
    </Suspense>
  );
}

function RoomDetailSeed({ seed }: Readonly<{ seed: ServerSeedInput }>) {
  const { id } = useParams<{ id: string }>();
  const claims = useMemo(
    () => [roomKeys.detailKey(id), roomKeys.students(id)],
    [id],
  );
  return (
    <SWRServerSeed seed={seed} claims={claims} render>
      <RoomDetailPageContent />
    </SWRServerSeed>
  );
}

/**
 * Die Raumseite: die einzige Objektansicht eines Raums (BAUARTEN-SPEC
 * Bauart 2, #3115). Bis dahin gab es drei Zustände: ein Pane in der
 * Datenverwaltung, ein Slide-over auf /rooms und diese Route als tote
 * Weiterleitung. Jetzt führen Übersicht und Register beide hierher.
 *
 * „Übersicht" ist der laufende Betrieb (Belegung, Kinder im Raum,
 * Historie); „Stammdaten" ist der Datensatz (Name, Gebäude, Farbe, offener
 * Raum) für alle, die Räume bearbeiten dürfen. Erfasst die Schule nur, ob ein
 * Kind da ist (binärer Modus), gibt es keine Belegung und damit keinen
 * Reiter „Übersicht".
 *
 * „Plan" (#4768) zeigt, wann der Raum laut Betreuungsplan belegt und wann er
 * frei ist, für alle, die den Betreuungsplan lesen dürfen, auch im binären
 * Modus. URL: `tab=plan`, `d` (Tag) und `view` (`tag` | `woche`).
 */
function RoomDetailPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useTenantRouter();
  const tenantPath = useTenantAwarePath();
  const roomId = params.id as string;
  const referrer = resolveDetailReferrer(searchParams.get("from"), "/rooms", [
    "/rooms",
    "/database/rooms",
  ]);
  const backLabel = backLabelFor(referrer);
  const { data: session } = useSession();
  const presenceMode = usePresenceMode();
  const weekendOpen = useWeekendFollowsFriday();
  const { success: toastSuccess } = useToast();
  // Stammdaten speichern: Fehler im Formular, Feldfehler am Feld (#2517).
  const saveErrors = useApiFormError();
  const tenantMutate = useTenantMutate();
  const refreshRoomFamily = useTenantMutateMatching([roomKeys.family]);
  const refreshRoomConsumers = useTenantMutateMatching(
    ROOM_DERIVED_CACHE_KEY_FRAGMENTS,
  );
  const service = useMemo(() => createCrudService(roomsConfig), []);

  const {
    room,
    history,
    loading,
    error,
    historyDisabled,
    historyError,
    reload: reloadRoom,
  } = useRoomDetail(roomId);

  const seedFrom = useSWRSeedFrom();
  const preview = useMemo(
    () =>
      loading
        ? seedFrom(
            roomKeys.previewSources,
            roomKeys.detailKey(roomId),
            (data: unknown) => roomKeys.preview(data, roomId),
          )
        : undefined,
    [loading, seedFrom, roomId],
  );

  // Spiegel der Backend-Gates auf PUT/DELETE /api/rooms/{id}.
  // Ein archivierter Raum (#6845) steht nur noch für seinen Verlauf; er
  // lässt sich weder bearbeiten noch noch einmal entfernen.
  const isArchived = Boolean(room?.archivedAt);
  const canUpdate = hasPermission(session, "rooms:update") && !isArchived;
  const canDelete = hasPermission(session, "rooms:delete") && !isArchived;
  // Plan des Raums (#4768): dasselbe Recht wie die Leseansicht des
  // Betreuungsplans; der Druck braucht dazu die Namen (wie dort).
  const canReadPlan = hasPermission(session, "schedules:read");
  const canManageSchedules = hasPermission(session, "schedules:manage");
  const canExportPlan = canReadPlan && hasPermission(session, "users:read");
  // Im binären Modus führt die Schule keine Belegung; die Raumseite ist dann
  // der reine Datensatz.
  const hasOccupancy = presenceMode !== "binary";
  const roomInfo = hasOccupancy ? ROOM_INFO : ROOM_RECORD_INFO;
  // Ein offener Raum (#3065) hat seine gemeinsame Aufsichtsansicht. Sie ist
  // seit #4372 nur noch über „Räume“ erreichbar, also über diese Seite.
  // Dieselbe Regel wie der Zugang zur Aufsichtsseite.
  const { overviewEnabled, refresh: refreshSupervision } =
    useOptionalSupervision();
  const canOpenSupervision = canReadSupervisionData(session) || overviewEnabled;

  const tabItems: TenantPageTab[] = [
    ...(hasOccupancy ? [{ value: "uebersicht", label: "Übersicht" }] : []),
    ...(canReadPlan ? [{ value: "plan", label: "Plan" }] : []),
    ...(canUpdate ? [{ value: "stammdaten", label: "Stammdaten" }] : []),
  ];
  const requestedTab = searchParams.get("tab");
  const defaultTab: RoomTab =
    requestedTab === "stammdaten" && canUpdate
      ? "stammdaten"
      : requestedTab === "plan" && canReadPlan
        ? "plan"
        : hasOccupancy
          ? "uebersicht"
          : canUpdate || !canReadPlan
            ? "stammdaten"
            : "plan";
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const activeTab =
    selectedTab && tabItems.some((tab) => tab.value === selectedTab)
      ? selectedTab
      : defaultTab;

  const handleTabChange = useCallback(
    (nextTab: string) => {
      setSelectedTab(nextTab);
      const query = new URLSearchParams(searchParams.toString());
      if (nextTab === "uebersicht") {
        query.delete("tab");
      } else {
        query.set("tab", nextTab);
      }
      if (nextTab !== "plan") {
        for (const key of PLAN_TAB_PARAMS) query.delete(key);
      }
      const url = new URL(window.location.href);
      url.search = query.toString();
      window.history.replaceState(null, "", url);
    },
    [searchParams],
  );

  // Zeitraum des Reiters „Plan“: ein ungültiges `d` fällt still auf heute.
  const todayISO = useBerlinToday();
  const rawPlanDay = searchParams.get("d");
  const planAnchorISO =
    rawPlanDay !== null && isValidISODate(rawPlanDay) ? rawPlanDay : todayISO;
  // Der Reiter zeigt Wochenend-Deeplinks ohne Wochenendbetreuung ab Montag.
  // Der Druck muss dieselbe angezeigte Woche verwenden.
  const planExportDayISO = roomPlanCareDay(
    planAnchorISO,
    weekendOpen,
    todayISO,
  );
  const planView = parseRoomPlanView(searchParams.get("view"));
  const planHref = useRoomPlanHref(
    roomId,
    planView,
    planAnchorISO,
    canManageSchedules,
  );
  const setPlanParams = useCallback(
    (next: { view?: RoomPlanView; d?: string }) => {
      const query = new URLSearchParams(searchParams.toString());
      query.set("tab", "plan");
      if (next.d) query.set("d", next.d);
      if (next.view) query.set("view", next.view);
      const url = new URL(window.location.href);
      url.search = query.toString();
      window.history.replaceState(null, "", url);
    },
    [searchParams],
  );
  // „Raumplan als PDF“ (#4768): der Aushang der angezeigten Woche, mit dem
  // Raumfilter des Betreuungsplan-Exports. Bewusst ohne den Druckdialog des
  // Betreuungsplans: dessen Kalender wöge mehr als die ganze Raumseite.
  const { show: showExportError } = useApiErrorDisplay();
  const [exporting, setExporting] = useState(false);
  const exportRoomPlan = useCallback(async () => {
    setExporting(true);
    try {
      await exportPlan(
        "betreuungsplan",
        {
          from: planExportDayISO,
          to: planExportDayISO,
          template: "offerings",
          variant: "aushang",
          filter: { ...NO_PLAN_FILTER, roomId },
        },
        "pdf",
        "download",
      );
    } catch (exportError) {
      void showExportError(exportError, {
        object: "das Erstellen des Raumplans",
        retry: () => void exportRoomPlan(),
      });
    } finally {
      setExporting(false);
    }
  }, [planExportDayISO, roomId, showExportError]);

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useSetBreadcrumb({ roomName: room?.name, referrerPage: referrer });

  const refreshRoomLists = useCallback(
    () =>
      Promise.all([
        tenantMutate(roomKeys.detailKey(roomId)),
        refreshRoomFamily(),
      ]),
    [roomId, tenantMutate, refreshRoomFamily],
  );

  const roomAfterWrite = useRefreshAfterWrite("die Anzeige des Raums", () =>
    Promise.all([
      refreshRoomLists(),
      // Refetch every consumer that holds room-stamped data so badges
      // pick up the new color without a manual reload.
      refreshRoomConsumers(),
    ]),
  );

  const handleSaveRoom = useCallback(
    async (data: Partial<Room>, version: string | undefined) => {
      if (!room) throw new Error("room is not loaded");
      try {
        const payload = roomsConfig.form.transformBeforeSubmit
          ? roomsConfig.form.transformBeforeSubmit(data)
          : data;
        // The save carries the version the form was filled from.
        const saved = await service.update(room.id, {
          ...payload,
          version,
        });
        const stored = saved ? withStoredRoomFields(room, saved) : room;
        // The answer carries the new version: the next save sends it even
        // when the reload below fails (ADR 0311). Occupancy is not part of
        // the answer and stays as read.
        await tenantMutate(
          roomKeys.detailKey(roomId),
          (current?: { room: Room }) =>
            current && saved
              ? { ...current, room: withStoredRoomFields(current.room, saved) }
              : current,
          { revalidate: false },
        );
        const savedName = data.name?.trim() || room.name;
        toastSuccess(`Der Raum „${savedName}“ ist gespeichert.`);
        // A failed reload is a load error above the room, never an error
        // of the form (#6652).
        const renamed = stored.name !== room.name;
        const releaseChanged = stored.isOpenRoom !== room.isOpenRoom;
        await Promise.all([
          roomAfterWrite.refresh(),
          renamed
            ? refreshSupervision()
            : releaseChanged
              ? refreshSupervision(["released-rooms"])
              : undefined,
        ]);
        return stored;
      } catch (updateError) {
        logger.error("failed to update room", {
          room_id: room.id,
          error:
            updateError instanceof Error
              ? updateError.message
              : String(updateError),
        });
        // Someone saved the room since it was read: the form reads it again
        // (ADR 0311), the lists too.
        if (isReadStateRefusal(updateError)) void refreshRoomLists();
        throw updateError;
      }
    },
    [
      refreshRoomLists,
      refreshSupervision,
      roomAfterWrite,
      room,
      roomId,
      service,
      tenantMutate,
      toastSuccess,
    ],
  );

  const handleRoomRemoved = useCallback(
    async (outcome: "delete" | "archive") => {
      if (!room) return;
      toastSuccess(
        outcome === "archive"
          ? `Der Raum „${room.name}“ ist archiviert. Der Verlauf bleibt erhalten.`
          : `Der Raum „${room.name}“ ist gelöscht.`,
      );
      setShowDeleteModal(false);
      await Promise.all([refreshRoomFamily(), refreshSupervision()]);
      router.push(referrer);
    },
    [
      referrer,
      room,
      router,
      refreshRoomFamily,
      refreshSupervision,
      toastSuccess,
    ],
  );

  if (loading && !room) {
    return (
      <RoomDetailLoadingPage
        referrer={referrer}
        backLabel={backLabel}
        preview={preview}
        info={roomInfo}
      />
    );
  }

  if (error || !room) {
    return (
      <TenantPage
        title="Raum"
        info={roomInfo}
        back
        backHref={referrer}
        backLabel={backLabel}
        error={error ?? "Raum nicht gefunden"}
      />
    );
  }

  const showsPlan = activeTab === "plan" && canReadPlan;
  const menuItems: OverflowMenuItem[] = [
    ...(showsPlan && canExportPlan
      ? [
          {
            label: exporting ? "Raumplan wird erstellt…" : "Raumplan als PDF",
            icon: <FileDown className="size-4" aria-hidden />,
            description:
              "Speichert den Raumplan als PDF zum Aushängen auf deinem Gerät.",
            onClick: () => {
              if (!exporting) void exportRoomPlan();
            },
          },
        ]
      : []),
    ...(canDelete && !isSystemRoom(room)
      ? [
          {
            label: "Löschen",
            icon: <Trash2 className="size-4" aria-hidden />,
            description:
              "Löscht oder archiviert den Raum, moto zeigt vorher, was ihn noch hält.",
            destructive: true,
            onClick: () => setShowDeleteModal(true),
          },
        ]
      : []),
  ];

  // Statuszeile: Ort und Art des Raums, wie sie die Sammlung auch zeigt.
  // Höchstens drei Angaben: sind Gebäude, Etage, Kategorie und Plätze alle
  // da, entfällt die Etage. Sie steht unter „Rauminformationen“ im Inhalt,
  // die Plätze dort nicht.
  const floorLabel =
    room.floor === undefined ? undefined : formatFloor(room.floor);
  const statusItems: { value?: number; label: string }[] = [
    ...(room.building ? [{ label: room.building }] : []),
    ...(floorLabel === undefined ||
    (room.building && room.category && room.capacity !== undefined)
      ? []
      : [{ label: floorLabel }]),
    ...(room.category ? [{ label: room.category }] : []),
    ...(room.capacity !== undefined
      ? [{ value: room.capacity, label: "Plätze" }]
      : []),
  ];
  const singleStatus = statusItems.length === 1 ? statusItems[0] : undefined;
  const statusLine =
    statusItems.length > 1 ? (
      <TenantPageStats items={statusItems} />
    ) : singleStatus ? (
      [singleStatus.value, singleStatus.label]
        .filter((part) => part !== undefined)
        .join(" ")
    ) : null;

  return (
    <TenantPage
      title={room.name}
      info={roomInfo}
      stats={statusLine ?? undefined}
      back
      backHref={referrer}
      backLabel={backLabel}
      leading={
        <MotoDuotoneIcon
          icon={roomsConcept.icon}
          tone={roomsConcept.tone}
          size={40}
        />
      }
      actions={
        <>
          {hasOccupancy && !isArchived ? (
            <RoomStatusBadge isOccupied={room.isOccupied} />
          ) : null}
          {hasOccupancy && room.isOpenRoom && canOpenSupervision ? (
            <ButtonLink
              variant="outline"
              size="md"
              href={tenantPath(`/active-supervisions?room=${room.id}`)}
              tooltip="Öffnet die Aufsicht für diesen offenen Raum."
            >
              Zur Aufsicht
            </ButtonLink>
          ) : null}
          {menuItems.length > 0 ? (
            <OverflowMenu ariaLabel="Weitere Aktionen" items={menuItems} />
          ) : null}
        </>
      }
      tabs={
        tabItems.length > 1
          ? {
              value: activeTab,
              onChange: handleTabChange,
              inUrl: true,
              items: tabItems,
              label: "Bereiche des Raums",
            }
          : undefined
      }
      searchSlot={
        showsPlan ? (
          <RoomPlanControls
            view={planView}
            anchorISO={planAnchorISO}
            onChange={setPlanParams}
            planHref={planHref}
            planLinkLabel={
              canManageSchedules
                ? "Im Betreuungsplan bearbeiten"
                : "Im Betreuungsplan ansehen"
            }
          />
        ) : undefined
      }
      overlays={
        <>
          <RoomRemovalModal
            isOpen={showDeleteModal}
            roomId={room.id}
            roomName={room.name}
            onClose={() => setShowDeleteModal(false)}
            onRemoved={handleRoomRemoved}
          />
        </>
      }
    >
      <LoadErrorAlert error={roomAfterWrite.error} />
      {isArchived ? (
        <Alert
          type="info"
          title="Archivierter Raum"
          message="Dieser Raum steht in keiner Liste mehr. Er bleibt nur, damit vergangene Termine und Anwesenheiten ihren Raum behalten."
        />
      ) : null}
      {/* Ohne Übersicht und Stammdaten bleiben die Rauminformationen stehen;
          ein Plan steht dann darunter, ohne Reiterleiste. */}
      {!hasOccupancy && !canUpdate ? (
        <RoomDetailContent
          room={room}
          history={history}
          historyDisabled={historyDisabled}
          historyError={historyError}
          showOccupancy={false}
        />
      ) : null}
      {activeTab === "uebersicht" && hasOccupancy ? (
        loading ? (
          <RoomDetailSkeleton />
        ) : (
          <RoomDetailContent
            room={room}
            history={history}
            historyDisabled={historyDisabled}
            historyError={historyError}
          />
        )
      ) : null}
      {showsPlan ? (
        <RoomPlanTab
          roomId={room.id}
          view={planView}
          anchorISO={planAnchorISO}
        />
      ) : null}
      {activeTab === "stammdaten" && canUpdate ? (
        <RoomStammdatenTab
          room={room}
          showOccupancy={hasOccupancy}
          onSave={handleSaveRoom}
          reload={reloadRoom}
          errorPath={saveErrors}
        />
      ) : null}
    </TenantPage>
  );
}

"use client";

import { Megaphone, Pencil, Trash2, Users } from "lucide-react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import {
  OverflowMenu,
  type OverflowMenuEntry,
} from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { StaffNoticeAcknowledgementsModal } from "~/components/staff-notices/staff-notice-acknowledgements-modal";
import { StaffNoticeModal } from "~/components/staff-notices/staff-notice-modal";
import { TodayNoticeList } from "~/components/staff-notices/today-notice-list";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Loading } from "~/components/ui/loading";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { hasEffectiveAdminScope } from "~/lib/auth-utils";
import { ApiError } from "~/lib/api-error";
import { formatDate } from "~/lib/date-helpers";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import {
  createStaffNotice,
  deleteStaffNotice,
  describeAudience,
  describeRecurrence,
  fetchStaffNotice,
  fetchStaffNotices,
  fetchTodaysNotices,
  updateStaffNotice,
} from "~/lib/staff-notices-api";
import type { StaffNotice, StaffNoticeInput } from "~/lib/staff-notices-api";
import { useSWRAuth } from "~/lib/swr";
import { staffNoticeKeys } from "~/lib/swr/staff-keys";

const NOTICES_INFO =
  "Hier stehen die Hinweise der Leitung an das Team. Unter „Heute“ siehst du, was heute gilt. Verlangt ein Hinweis eine Bestätigung, wähle „Zur Kenntnis nehmen“.";
const NOTICES_ADMIN_INFO =
  "Hier schreibst du Hinweise an das Team. Unter „Heute“ steht, was heute gilt, unter „Alle Hinweise“ jeder Hinweis. Einen neuen legst du mit „Neuer Hinweis“ an.";

const logger = createLogger({ component: "TagesinformationenPage" });

/**
 * Tagesinformationen (#2180): interne Hinweise der Leitung an das Team.
 *
 * Eine Seite, zwei Rollen. Oben steht für ALLE Mitarbeitenden, was heute gilt
 * (mit Kenntnisnahme); darunter verwalten Admins den Bestand. Ein Hinweis ist
 * EINE Zeile mit einer Wiederholungsregel, keine Reihe von Tageseinträgen —
 * deshalb zeigt die Liste die Regel im Klartext ("Di · Woche B") statt einer
 * Terminliste. Die Route /api/staff-notices (Liste, Anlegen) ist im Backend
 * adminexklusiv; hier wird nur gespiegelt, was dort gilt.
 */
function TagesinformationenContent() {
  const { data: session } = useSession();
  const isAdmin = hasEffectiveAdminScope(session);
  // Kontogebundene Cache-Keys: acknowledged_at ist kontospezifisch, ein
  // Kontowechsel im selben Tenant darf keinen fremden Stand anzeigen.
  const accountId = session?.user?.id ?? "";

  const {
    data: todayData,
    error: todayError,
    isLoading: todayLoading,
    mutate: mutateToday,
  } = useSWRAuth<StaffNotice[]>(
    staffNoticeKeys.today(accountId),
    fetchTodaysNotices,
    {
      revalidateOnFocus: false,
    },
  );

  const {
    data,
    error: noticesError,
    isLoading,
    mutate,
  } = useSWRAuth<StaffNotice[]>(
    isAdmin ? staffNoticeKeys.all(accountId) : null,
    fetchStaffNotices,
    { revalidateOnFocus: false },
  );

  // Ein Eintrag in der Glocke verlinkt seinen Hinweis (#7143). Gilt er
  // heute nicht, steht er nicht unter „Heute“: die Seite lädt ihn einzeln.
  const linkedId = useSearchParams().get("hinweis");
  const {
    data: linkedNotice,
    error: linkedError,
    mutate: mutateLinked,
  } = useSWRAuth<StaffNotice>(
    linkedId ? staffNoticeKeys.linked(accountId, linkedId) : null,
    () => fetchStaffNotice(linkedId ?? ""),
    { revalidateOnFocus: false },
  );
  // Gelöscht oder ausgeschaltet ist kein Ladefehler, sondern ein Zustand.
  const linkedGone =
    linkedError instanceof ApiError && linkedError.status === 404;
  const linkedLoadError = useSwrLoadError(
    linkedGone ? undefined : linkedError,
    "den Hinweis aus deinen Benachrichtigungen",
    () => mutateLinked(),
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StaffNotice | null>(null);
  const [deleting, setDeleting] = useState<StaffNotice | null>(null);
  // Bestätigungsliste (#2208): welcher Hinweis gerade seine Namen zeigt.
  const [showingAcks, setShowingAcks] = useState<StaffNotice | null>(null);
  // Löschfehler bleiben im Bestätigungsdialog (#2517).
  const deleteErrors = useApiFormError();
  const [deletePending, setDeletePending] = useState(false);
  const toast = useToast();

  const todayLoadError = useSwrLoadError(
    todayError,
    "die Liste der Hinweise von heute",
    () => mutateToday(),
  );
  const listLoadError = useSwrLoadError(
    noticesError,
    "die Liste aller Hinweise",
    () => mutate(),
  );

  const todayNotices = todayData ?? [];
  const notices = data ?? [];
  const linkedInToday =
    linkedId !== null && todayNotices.some((notice) => notice.id === linkedId);

  const buildNoticeMenu = (notice: StaffNotice): OverflowMenuEntry[] => {
    const acknowledged = notice.acknowledged_count ?? 0;
    return [
      {
        label: "Bearbeiten",
        description: "Öffnet den Hinweis zum Ändern.",
        icon: <Pencil className="h-4 w-4" aria-hidden />,
        onClick: () => {
          setEditing(notice);
          setModalOpen(true);
        },
      },
      ...(notice.requires_acknowledgement && acknowledged > 0
        ? [
            {
              label: "Wer hat bestätigt?",
              description: "Zeigt, wer die Information schon bestätigt hat.",
              icon: <Users className="h-4 w-4" aria-hidden />,
              badge: acknowledged,
              onClick: () => setShowingAcks(notice),
            },
          ]
        : []),
      { kind: "separator" },
      {
        label: "Löschen",
        description:
          "Entfernt die Information für alle. moto fragt vorher nach.",
        icon: <Trash2 className="h-4 w-4" aria-hidden />,
        destructive: true,
        onClick: () => {
          setDeleting(notice);
          deleteErrors.clear();
        },
      },
    ];
  };

  const save = async (input: StaffNoticeInput) => {
    if (editing) {
      await updateStaffNotice(editing.id, input);
    } else {
      await createStaffNotice(input);
    }
    toast.success(
      editing
        ? `Der Hinweis „${input.title}“ ist gespeichert.`
        : `Der Hinweis „${input.title}“ ist angelegt.`,
    );
    await Promise.all([mutate(), mutateToday()]);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletePending(true);
    deleteErrors.clear();
    try {
      await deleteStaffNotice(deleting.id);
      toast.success(`Der Hinweis „${deleting.title}“ ist gelöscht.`);
      await Promise.all([mutate(), mutateToday()]);
      setDeleting(null);
    } catch (err) {
      logger.error("staff_notice_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void deleteErrors.show(err, {
        object: "das Löschen des Hinweises",
        retry: () => void confirmDelete(),
      });
    } finally {
      setDeletePending(false);
    }
  };

  // Statuszeile aus echten Zahlen: was heute gilt, für Admins zusätzlich der
  // Bestand. Der frühere Erklärsatz steht in der Hilfe, nicht im Kopf. Eine
  // Zahl steht nur für eine geladene Liste da, nie "0 heute" neben einem
  // Ladefehler (#2517).
  const statusItems = [
    ...(todayData === undefined
      ? []
      : [{ value: todayNotices.length, label: "heute" }]),
    ...(isAdmin && data !== undefined
      ? [{ value: notices.length, label: "insgesamt" }]
      : []),
  ];
  const statusLine =
    statusItems.length > 1 ? (
      <TenantPageStats items={statusItems} />
    ) : statusItems[0] ? (
      `${statusItems[0].value} ${statusItems[0].label}`
    ) : null;

  return (
    <TenantPage
      title="Hinweise der Leitung"
      info={isAdmin ? NOTICES_ADMIN_INFO : NOTICES_INFO}
      stats={statusLine}
      statsLoading={todayLoading && todayNotices.length === 0}
      actions={
        isAdmin ? (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            tooltip="Öffnet ein Fenster für einen neuen Hinweis."
          >
            Neuer Hinweis
          </Button>
        ) : undefined
      }
      overlays={
        <>
          <StaffNoticeModal
            isOpen={modalOpen}
            notice={editing}
            onClose={() => setModalOpen(false)}
            onSubmit={async (input) => {
              try {
                await save(input);
              } catch (err) {
                logger.error("staff_notice_save_failed", {
                  error: err instanceof Error ? err.message : String(err),
                });
                throw err;
              }
            }}
          />
          <StaffNoticeAcknowledgementsModal
            notice={showingAcks}
            onClose={() => setShowingAcks(null)}
          />
          <ConfirmDeleteModal
            isOpen={deleting !== null}
            title="Hinweis löschen"
            description={
              deleting
                ? `„${deleting.title}“ wird für alle entfernt. Bereits erfasste Kenntnisnahmen gehen mit verloren.`
                : ""
            }
            gate={{ mode: "twoStep", firstStepLabel: "Löschen" }}
            loading={deletePending}
            error={deleteErrors.error}
            onConfirm={confirmDelete}
            onClose={() => setDeleting(null)}
          />
        </>
      }
    >
      {/* Der Hinweis aus der Glocke (#7143), wenn er nicht unter „Heute“
          steht: etwa weil er erst nächste Woche gilt. */}
      {linkedId && !linkedInToday && (
        <SectionCard title="Aus deinen Benachrichtigungen">
          {linkedLoadError ? (
            <LoadErrorAlert error={linkedLoadError} />
          ) : linkedGone ? (
            <p className="text-sm leading-6 text-gray-600">
              Diesen Hinweis gibt es nicht mehr. Die Leitung hat ihn gelöscht
              oder abgeschaltet.
            </p>
          ) : linkedNotice ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-gray-900">
                  {linkedNotice.title}
                </h3>
                {linkedNotice.priority === "important" && (
                  <StatusBadge label="Wichtig" tone="warning" />
                )}
              </div>
              {linkedNotice.body && (
                <p className="mt-1 max-w-3xl text-sm leading-6 whitespace-pre-line text-gray-600">
                  {linkedNotice.body}
                </p>
              )}
              <p className="mt-2 text-sm text-gray-500">
                {describeRecurrence(linkedNotice)} · ab{" "}
                {formatDate(linkedNotice.valid_from)}
                {linkedNotice.valid_until
                  ? ` bis ${formatDate(linkedNotice.valid_until)}`
                  : ""}
              </p>
            </div>
          ) : (
            <Loading />
          )}
        </SectionCard>
      )}

      {/* Heute: das, was jede Mitarbeiterin braucht. Steht deshalb vor der
          Verwaltung und ist die ganze Seite für Nicht-Admins. */}
      <SectionCard title="Heute">
        {todayLoadError ? (
          // Ein Ladefehler darf nicht wie "keine Hinweise" aussehen: dann
          // verlässt sich jemand auf eine leere Tafel, die nur nicht geladen war.
          <LoadErrorAlert error={todayLoadError} />
        ) : (todayLoading && todayNotices.length === 0) || todayError ? (
          <Loading />
        ) : todayNotices.length === 0 ? (
          <p className="text-sm leading-6 text-gray-600">
            Für heute liegen keine Hinweise vor.
          </p>
        ) : (
          <TodayNoticeList
            notices={todayNotices}
            onChanged={mutateToday}
            layout="grid"
          />
        )}
      </SectionCard>

      {isAdmin && (
        <SectionCard title="Alle Hinweise">
          {listLoadError ? (
            <LoadErrorAlert error={listLoadError} />
          ) : (isLoading && notices.length === 0) || noticesError ? (
            <Loading />
          ) : notices.length === 0 ? (
            <EmptyState
              icon={<Megaphone className="h-6 w-6" />}
              title="Noch keine Hinweise"
              description="Hinweise wie „Jeden Dienstag ist die Turnhalle bis 15 Uhr belegt“ sehen damit alle Mitarbeitenden unter Team -> Hinweise der Leitung."
            />
          ) : (
            // Zeilen in EINER Karte statt einer Karte je Hinweis: die
            // Verwaltung ist eine Liste, keine Kachelwand.
            <ul className="divide-y divide-gray-100">
              {notices.map((notice) => (
                <li key={notice.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">
                          {notice.title}
                        </span>
                        {notice.priority === "important" && (
                          <StatusBadge label="Wichtig" tone="warning" />
                        )}
                        {!notice.active && (
                          <StatusBadge label="Abgeschaltet" tone="gray" />
                        )}
                      </div>
                      {notice.body && (
                        <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-gray-600">
                          {notice.body}
                        </p>
                      )}
                      <p className="mt-2 text-sm text-gray-500">
                        {describeAudience(notice.audience)} ·{" "}
                        {describeRecurrence(notice)} · ab{" "}
                        {formatDate(notice.valid_from)}
                        {notice.valid_until
                          ? ` bis ${formatDate(notice.valid_until)}`
                          : " (unbefristet)"}
                      </p>
                      {notice.requires_acknowledgement && (
                        <p className="mt-1 text-sm text-gray-500">
                          Kenntnisnahme verlangt ·{" "}
                          {notice.acknowledged_count === 1
                            ? "1 Person hat bestätigt"
                            : `${notice.acknowledged_count} Personen haben bestätigt`}
                        </p>
                      )}
                    </div>

                    {/* Zeilenaktionen nur im Kebab (BAUARTEN-SPEC Bauart 1
                        Regel 4): Bearbeiten, die Namensliste der
                        Bestätigungen und Löschen. */}
                    <OverflowMenu
                      ariaLabel={`Aktionen für ${notice.title}`}
                      items={buildNoticeMenu(notice)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </TenantPage>
  );
}

// useSearchParams braucht eine Suspense-Grenze: der Link aus der Glocke
// trägt den Hinweis in `?hinweis=` (#7143).
export default function TagesinformationenPage() {
  return (
    <Suspense
      fallback={
        <TenantPage
          title="Hinweise der Leitung"
          // Vor dem Laden ist die Rolle offen; den Lesetext sehen alle.
          info={NOTICES_INFO}
          statsLoading
          loading
        />
      }
    >
      <TagesinformationenContent />
    </Suspense>
  );
}

"use client";

// Anmeldungen nachtragen (#7760, ADR 0309): Für jeden importierten Vertrag
// einer Schule, der mit der Kinderakte verknüpft ist, legt moto die
// Anmeldung des Kindes mit der Betreuung aus dem Vertrag an und bindet den
// Vertrag daran. Ablauf: Schule wählen, Vorschau prüfen, bestätigen,
// Ergebnis. Der Lauf ist still: keine Mail, keine Einladung, die Kinderakte
// bleibt, wie sie ist. Er übernimmt nur die bestätigte Vorschau; hat sie sich
// geändert (auch über Mitternacht), lädt die Seite sie still neu.

import { CheckCircle, ClipboardCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  enrollmentContractCount,
  enrollmentCount,
  enrollmentRunSummary,
  openEnrollmentCount,
} from "~/components/traeger/care-contract-enrollment-format";
import { CareContractEnrollmentTableCard } from "~/components/traeger/care-contract-enrollment-table-card";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FramedList } from "~/components/ui/framed-list";
import { ListRowLink } from "~/components/ui/list-row-link";
import { ConfirmationModal } from "~/components/ui/modal";
import NavigationLink from "~/components/ui/navigation-link";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useStepFocus } from "~/components/ui/use-step-focus";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import {
  type EnrollmentPreview,
  type EnrollmentRun,
  previewContractEnrollments,
  runContractEnrollments,
} from "~/lib/traeger-contract-enrollments-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerContractEnrollmentPage" });

const TITLE = "Anmeldungen nachtragen";

const INFO =
  "Importierte Verträge haben an der Schule noch keine Anmeldung. Hier trägt moto sie nach: mit der Betreuung aus dem Vertrag, und bindet den Vertrag daran. Danach verhält sich der Vertrag wie jeder andere: Eine geänderte Buchung ergibt eine neue Vertragsversion.";

const VERTRAEGE = "/traeger/vertraege";
const PAGE = "/traeger/vertraege/anmeldungen";

/** Why the page shows a newer preview than the one the office confirmed. */
type Notice = "preview_changed" | "run_failed" | null;

export default function TraegerContractEnrollmentPage() {
  // `useSearchParams` braucht eine Suspense-Grenze.
  return (
    <Suspense
      fallback={
        <TenantPage
          title={TITLE}
          info={INFO}
          back
          backHref={traegerPath(VERTRAEGE)}
          backLabel="Zurück zu den Verträgen"
          loading
        />
      }
    >
      <ContractEnrollmentView />
    </Suspense>
  );
}

function ContractEnrollmentView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const schoolList = useTraegerSchools();
  const schools = schoolList.schools ?? [];
  // One school per run. A Träger with one school skips the choice.
  const asked = searchParams?.get("schule") ?? "";
  const only = schools.length === 1 ? schools[0] : undefined;
  const school =
    schools.find((candidate) => candidate.id === asked) ?? only ?? null;
  const schoolId = school?.id ?? "";

  const [done, setDone] = useState<EnrollmentRun | null>(null);
  const [confirming, setConfirming] = useState<EnrollmentPreview | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const invalidateFamily = useInvalidateFamily();
  const { show } = useApiErrorDisplay();
  const { success } = useToast();

  // The run of another school, or a new choice, starts with its own preview.
  const [shownFor, setShownFor] = useState(schoolId);
  if (shownFor !== schoolId) {
    setShownFor(schoolId);
    setDone(null);
    setNotice(null);
    setConfirming(null);
  }

  // Fresh on each opening: the read stands in the access log of the school,
  // and only a preview the office has just seen may be confirmed.
  const {
    data: preview,
    error: previewError,
    loading: previewLoading,
    reload,
  } = useFreshTraegerResource(
    schoolId && !done ? traegerContractKeys.enrollmentPreview(schoolId) : null,
    () => previewContractEnrollments(schoolId),
    "die Vorschau der Anmeldungen",
  );

  const chooseHref = (id: string) =>
    traegerPath(`${PAGE}?schule=${encodeURIComponent(id)}`);

  const run = async () => {
    const confirmed = confirming;
    if (!confirmed || running) return;
    setRunning(true);
    let result: EnrollmentRun;
    try {
      result = await runContractEnrollments(
        confirmed.schoolId,
        confirmed.fingerprint,
      );
    } catch (err) {
      setRunning(false);
      setConfirming(null);
      if (
        err instanceof ApiError &&
        err.code === wireErrorCode("care_contract.enrollment_preview_changed")
      ) {
        // Expected (ADR 0309): the contracts, the school or the day changed
        // since the preview. Nothing was written; show the current preview
        // for a new confirmation, without an error.
        setNotice("preview_changed");
        reload();
        return;
      }
      logger.error("contract_enrollment_run_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void show(err, { object: "die Anmeldungen" });
      // The school may have enrolled children before the binding failed:
      // the next preview shows them ready to bind (ADR 0309 section 4).
      setNotice("run_failed");
      reload();
      void invalidateFamily(traegerContractKeys.listFamily);
      void invalidateFamily(traegerContractKeys.detailFamily);
      return;
    }
    setRunning(false);
    setConfirming(null);
    setNotice(null);
    setDone(result);
    const summary = enrollmentRunSummary(result.rows);
    success(
      result.changed
        ? `${enrollmentContractCount(summary.enrolled + summary.bound)} an ihre Anmeldung gebunden.`
        : "Es gab nichts nachzutragen.",
    );
    // The list, every open contract and „Verträge erstellen“ follow the
    // binding.
    void invalidateFamily(traegerContractKeys.listFamily);
    void invalidateFamily(traegerContractKeys.detailFamily);
    void invalidateFamily(traegerContractKeys.candidates());
  };

  const startOver = () => {
    setDone(null);
    setNotice(null);
  };

  // A new step takes the focus to its heading (#7111); the first answer of
  // the school list is no step.
  const phase = !schoolList.schools
    ? null
    : done
      ? "done"
      : schoolId
        ? "preview"
        : "school";
  const stepFocus = useStepFocus<HTMLDivElement>(phase);

  const counts = done?.counts ?? preview?.counts;
  const open = counts ? openEnrollmentCount(counts) : 0;

  return (
    <TenantPage
      title={TITLE}
      info={INFO}
      back
      backHref={traegerPath(VERTRAEGE)}
      backLabel="Zurück zu den Verträgen"
      stats={
        counts ? (
          <TenantPageStats
            items={[
              done
                ? { value: counts.done, label: "erledigt" }
                : { value: counts.ready, label: "bereit" },
              { value: open + counts.unlinked, label: "offen" },
            ]}
          />
        ) : null
      }
      statsLoading={!!schoolId && !counts && !previewError}
      filters={
        schools.length > 1 && school
          ? [
              {
                id: "school",
                label: "Schule",
                type: "dropdown" as const,
                value: schoolId,
                onChange: (value: string | string[]) =>
                  router.replace(chooseHref(value as string), {
                    scroll: false,
                  }),
                options: schools.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.name,
                })),
              },
            ]
          : undefined
      }
      error={schoolList.error}
      loading={!schoolList.schools && !schoolList.error}
      empty={
        schoolList.schools && schools.length === 0
          ? {
              title: "Keine Schule",
              description:
                "Deinem Träger ist noch keine Schule zugeordnet. Dann gibt es nichts nachzutragen.",
            }
          : undefined
      }
      overlays={
        <ConfirmationModal
          isOpen={confirming !== null}
          title={
            confirming
              ? `${enrollmentCount(confirming.counts.ready)} nachtragen?`
              : "Anmeldungen nachtragen?"
          }
          icon={<ClipboardCheck className="h-5 w-5" aria-hidden="true" />}
          confirmText="Jetzt nachtragen"
          confirmVariant="success"
          confirmTooltip="Trägt die Anmeldungen an der Schule ein und bindet die Verträge."
          isConfirmLoading={running}
          loadingText="Wird nachgetragen …"
          onClose={() => setConfirming(null)}
          onConfirm={() => void run()}
        >
          {confirming ? (
            <ConfirmText preview={confirming} schoolName={school?.name} />
          ) : null}
        </ConfirmationModal>
      }
    >
      {!school ? (
        <div ref={stepFocus} className="flex flex-col gap-6">
          <SectionCard
            title="Schule wählen"
            description="moto trägt die Anmeldungen je Schule nach. Wähle die Schule, deren Verträge du prüfen willst."
          >
            <FramedList>
              {schools.map((candidate) => (
                <ListRowLink
                  key={candidate.id}
                  href={chooseHref(candidate.id)}
                  title={candidate.name}
                  subtitle={candidate.city || undefined}
                  chevron
                />
              ))}
            </FramedList>
          </SectionCard>
          <HowItWorks />
        </div>
      ) : done ? (
        <div ref={stepFocus} className="flex flex-col gap-6">
          <RunResult
            run={done}
            schoolName={school.name}
            onStartOver={startOver}
          />
          <CareContractEnrollmentTableCard
            title="Verträge nach dem Nachtragen"
            description={
              enrollmentRunSummary(done.rows).open > 0
                ? "Die offenen Zeilen sind deine Arbeitsliste. Bei jeder steht, was fehlt und wer es klärt."
                : "So steht jeder importierte Vertrag der Schule jetzt."
            }
            rows={done.rows}
            counts={done.counts}
            afterRun
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {notice === "preview_changed" ? (
            <Alert
              type="info"
              message="Seit deiner Vorschau hat sich etwas geändert, zum Beispiel ein Vertrag oder der Tag. moto hat nichts eingetragen. Unten steht die aktuelle Vorschau, prüfe sie bitte noch einmal."
            />
          ) : null}
          {notice === "run_failed" ? (
            <Alert
              type="warning"
              message="Das Nachtragen ist nicht ganz durchgelaufen. Manche Kinder können schon angemeldet sein, ihr Vertrag ist dann noch nicht gebunden. Prüfe die Vorschau und trag noch einmal nach. Dabei entsteht nichts doppelt."
            />
          ) : null}
          <HowItWorks />
          <div ref={stepFocus} className="flex flex-col">
            <PreviewBody
              preview={preview}
              loading={previewLoading}
              error={previewError}
              onConfirm={() => preview && setConfirming(preview)}
            />
          </div>
        </div>
      )}
    </TenantPage>
  );
}

/** Was passiert, was nicht, und die Reihenfolge der Arbeit. */
function HowItWorks() {
  return (
    <SectionCard
      title="Was beim Nachtragen passiert"
      description="Jeder verknüpfte Vertrag bekommt an der Schule eine genehmigte Anmeldung mit der Betreuung aus dem Vertrag, und moto bindet ihn daran. Eltern bekommen keine Mail und keine Einladung. Die Kinderakte bleibt, wie sie ist."
      collapsible
    >
      <SectionLabel as="h3">So gehst du vor</SectionLabel>
      <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-gray-700">
        <li>
          Falls nötig:{" "}
          <NavigationLink
            href={traegerPath("/traeger/vertraege/module-zuordnen")}
            className="font-medium text-gray-900 underline"
          >
            Module neu zuordnen
          </NavigationLink>
        </li>
        <li>
          <NavigationLink
            href={traegerPath("/traeger/vertraege/verknuepfen")}
            className="font-medium text-gray-900 underline"
          >
            Mit Kinderakten verknüpfen
          </NavigationLink>
        </li>
        <li>Hier die Anmeldungen nachtragen</li>
      </ol>
      <p className="mt-3 text-sm text-gray-600">
        Danach verhält sich der Vertrag wie jeder andere: Ändert die Schule eine
        Buchung, entsteht eine neue Vertragsversion.
      </p>
    </SectionCard>
  );
}

function PreviewBody({
  preview,
  loading,
  error,
  onConfirm,
}: Readonly<{
  preview: EnrollmentPreview | null;
  loading: boolean;
  error: ReturnType<typeof useFreshTraegerResource>["error"];
  onConfirm: () => void;
}>) {
  if (error) {
    // A failed read of the preview: the scaffold's load error, with its
    // retry, in place of the table.
    return <LoadErrorAlert error={error} />;
  }
  if (loading || !preview) {
    return <SectionCard title="Vorschau" loading />;
  }
  if (preview.rows.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          title="Keine importierten Verträge"
          description="An dieser Schule gibt es keinen importierten Vertrag. Hier ist nichts nachzutragen."
        />
      </SectionCard>
    );
  }
  const { counts } = preview;
  const open = openEnrollmentCount(counts) + counts.unlinked;
  return (
    <CareContractEnrollmentTableCard
      title="Vorschau prüfen"
      description="Vergleiche Kind im Vertrag und Kinderakte. So würde moto jede Zeile nachtragen. Gespeichert wird erst, wenn du bestätigst."
      rows={preview.rows}
      counts={counts}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600">
            {counts.ready === 0 && open === 0
              ? "Alle Verträge sind schon an ihre Anmeldung gebunden. Hier ist nichts zu tun."
              : open > 0
                ? `${open === 1 ? "1 Zeile bleibt" : `${open} Zeilen bleiben`} offen. An ihnen ändert moto nichts.`
                : "Eltern bekommen keine Nachricht."}
          </p>
          <Button
            type="button"
            variant="success"
            size="md"
            className="shrink-0"
            onClick={onConfirm}
            disabled={counts.ready === 0}
            disabledReason={
              counts.done > 0 && open === 0
                ? "Alle Verträge sind schon an ihre Anmeldung gebunden."
                : "Kein Vertrag ist bereit. Bei jeder Zeile steht, was fehlt."
            }
            tooltip="moto fragt vorher nach, dann trägt es die Anmeldungen ein."
          >
            {`${enrollmentCount(counts.ready)} nachtragen`}
          </Button>
        </div>
      }
    />
  );
}

/** Was das Bestätigen an der Schule auslöst, ohne Drama. */
function ConfirmText({
  preview,
  schoolName,
}: Readonly<{ preview: EnrollmentPreview; schoolName: string | undefined }>) {
  const enroll = preview.rows.filter(
    (row) => row.status === "ready" && row.action === "enroll",
  ).length;
  const bind = preview.counts.ready - enroll;
  const at = schoolName ? ` an der Schule ${schoolName}` : " an der Schule";
  return (
    <div className="space-y-3 text-sm text-gray-700">
      {enroll > 0 ? (
        <p>
          {`moto legt${at} ${enrollmentCount(enroll)} an, schon genehmigt. Die Kinder stehen ab ihrem Vertragsbeginn in den Gruppenlisten.`}
        </p>
      ) : null}
      {bind > 0 ? (
        <p>
          {`${enrollmentContractCount(bind)} ${bind === 1 ? "wird" : "werden"} an eine Anmeldung gebunden, die es schon gibt. Daran ändert sich nichts.`}
        </p>
      ) : null}
      <p>
        Danach folgt jeder Vertrag den Buchungen seiner Anmeldung. Eltern
        bekommen keine Nachricht. Rückgängig machen geht nur je Vertrag: über
        „Bindung an die Anmeldung lösen“. Die Anmeldung bleibt dann an der
        Schule.
      </p>
    </div>
  );
}

function RunResult({
  run,
  schoolName,
  onStartOver,
}: Readonly<{
  run: EnrollmentRun;
  schoolName: string;
  onStartOver: () => void;
}>) {
  const summary = enrollmentRunSummary(run.rows);
  const parts = [
    `${summary.enrolled} nachgetragen`,
    `${summary.bound} nur gebunden`,
    `${summary.alreadyDone} ${summary.alreadyDone === 1 ? "war" : "waren"} schon erledigt`,
    `${summary.open} offen`,
  ];
  const changedNothing = !run.changed;
  return (
    <>
      <SectionCard>
        <EmptyState
          tone="success"
          titleAs="h2"
          icon={<CheckCircle aria-hidden className="size-6" />}
          title={
            changedNothing
              ? "Nichts nachzutragen"
              : `${enrollmentContractCount(summary.enrolled + summary.bound)} gebunden`
          }
          description={`${schoolName}: ${parts.join(", ")}.`}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink
                href={traegerPath(VERTRAEGE)}
                variant="primary"
                size="md"
                tooltip="Öffnet die Liste aller Verträge."
              >
                Zu den Verträgen
              </ButtonLink>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={onStartOver}
                tooltip="Liest die Verträge der Schule neu und zeigt die Vorschau."
              >
                Neue Vorschau
              </Button>
            </div>
          }
        />
      </SectionCard>
      <SectionCard
        title="Wie es weitergeht"
        description="Das Nachtragen hat niemanden benachrichtigt."
      >
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
          {summary.open > 0 ? (
            <li>
              Kläre die offenen Zeilen unten. Danach nimmt eine neue Vorschau
              sie mit.
            </li>
          ) : null}
          <li>
            Eltern ins Elternportal einladen macht die Schule: in ihrer
            Kinderliste über „Eltern einladen“. Eine Nachricht an Eltern, die
            schon ein Konto haben, gibt es noch nicht.
          </li>
          <li>
            War eine Verknüpfung falsch? Öffne den Vertrag und wähle im Menü
            „Bindung an die Anmeldung lösen“.
          </li>
        </ol>
      </SectionCard>
    </>
  );
}

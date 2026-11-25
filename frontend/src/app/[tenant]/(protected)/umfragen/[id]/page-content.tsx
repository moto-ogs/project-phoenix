"use client";

import { Suspense, useLayoutEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

import { useParentTargetLookups } from "~/components/announcements/parent-target-picker";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { ForbiddenPage } from "~/components/ui/forbidden-page";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { SURVEY_FORM_CHECK_MESSAGE } from "~/components/surveys/survey-create-slide-over";
import { SurveyEditorFields } from "~/components/surveys/survey-editor-fields";
import {
  buildSurveyMenuItems,
  CloseSurveyDialog,
  DeleteSurveyDialog,
  PublishSurveyDialog,
  RemindSurveyDialog,
} from "~/components/surveys/survey-lifecycle-dialogs";
import {
  describeSurveyAudience,
  formatSurveyClosesAt,
  remindedMessage,
  SurveyAnonymityBadge,
  SurveyStatusBadge,
} from "~/components/surveys/survey-meta";
import {
  SurveyResultsView,
  SurveyRespondentsView,
} from "~/components/surveys/survey-results";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { useUpdateUrlParams } from "~/hooks/useUpdateUrlParams";
import { ApiError } from "~/lib/api-error";
import { hasPermission } from "~/lib/auth-utils";
import {
  readStateWaitReason,
  useReadDraftForm,
  useSwrLoadError,
} from "~/lib/hooks/use-swr-load-error";
import {
  useRefreshAfterWrite,
  type RefreshAfterWrite,
} from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import {
  SURVEY_QUESTION_KIND_LABEL,
  hasEditorErrors,
  surveyDraftFromSurvey,
  surveyInputFromDraft,
  validateSurveyDraft,
  type SurveyEditorDraft,
  type SurveyEditorErrors,
} from "~/lib/survey-editor";
import { sortedSurveyQuestions } from "~/lib/survey-form";
import {
  downloadSurveyResultsPdf,
  fetchSurvey,
  fetchSurveyRespondents,
  fetchSurveyResults,
  updateSurvey,
  type Survey,
  type SurveyRespondent,
  type SurveyResults,
} from "~/lib/surveys-api";
import { revalidateOrThrow, useSWRAuth, useTenantMutate } from "~/lib/swr";
import { useDraftOn } from "~/lib/swr/read-draft";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { useTenantRouter } from "~/lib/tenant-router";
import { pollsConcept } from "~/lib/concepts/polls";

// Info-Knopf am Seitentitel (#7578): wofür die Seite da ist.
const SURVEY_DETAIL_INFO =
  "Hier siehst du eine Umfrage mit ihren Fragen. Einen Entwurf veröffentlichst du über das Menü mit den drei Punkten. Unter „Auswertung“ siehst du die Antworten, sobald genug Personen geantwortet haben. Bei anonymen Umfragen erst nach dem Ende.";

const logger = createLogger({ component: "SurveyDetailPage" });

const BACK = {
  back: true,
  backHref: "/umfragen",
  backLabel: "Zurück zu den Umfragen",
} as const;

type Tab = "auswertung" | "fragebogen" | "personen";
type LifecycleAction = "publish" | "close" | "remind" | "delete" | null;

export default function SurveyDetailPage() {
  // useSearchParams (`?reiter=`, `?bearbeiten=`) braucht die Suspense-Grenze.
  return (
    <Suspense
      fallback={
        <TenantPage
          info={SURVEY_DETAIL_INFO}
          title="Umfrage"
          {...BACK}
          loading
        />
      }
    >
      <SurveyDetailContent />
    </Suspense>
  );
}

/**
 * Die Objektseite einer Umfrage (#4781), nur für `surveys:manage`. Reiter:
 * Auswertung (Summen und Verteilungen), Fragebogen (Angaben und Fragen; ein
 * Entwurf wird hier bearbeitet) und bei nicht anonymen Umfragen die
 * Antworten je Person.
 */
function SurveyDetailContent() {
  const { data: session, status: sessionStatus } = useSession();
  const canManage = hasPermission(session, "surveys:manage");
  const params = useParams();
  const surveyId = params.id as string;

  if (sessionStatus !== "loading" && !canManage) {
    return (
      <ForbiddenPage
        title="Umfrage"
        message="Umfragen anlegen und auswerten darf nur, wer dafür die Berechtigung hat. Bitte frage deine Leitung."
      />
    );
  }
  return <SurveyDetail surveyId={surveyId} />;
}

function SurveyDetail({ surveyId }: Readonly<{ surveyId: string }>) {
  const searchParams = useSearchParams();
  const updateUrlParams = useUpdateUrlParams();
  const router = useTenantRouter();
  const tenantMutate = useTenantMutate();
  const { success: toastSuccess } = useToast();
  const exportErrors = useApiErrorDisplay();
  const [action, setAction] = useState<LifecycleAction>(null);
  const [exporting, setExporting] = useState(false);

  const surveyRead = useSWRAuth<Survey>(
    tenantAdminKeys.survey(surveyId),
    () => fetchSurvey(surveyId),
    {
      revalidateOnFocus: false,
    },
  );
  const { data: survey, error: loadError, mutate } = surveyRead;
  const notFound = loadError instanceof ApiError && loadError.status === 404;
  // Nachladen nach dem Speichern des Entwurfs: ein Fehler dabei steht über
  // dem Fragebogen und speichert nichts erneut (#6652).
  const editAfterWrite = useRefreshAfterWrite(
    "die Anzeige der Umfrage",
    async (saved: Survey) => {
      await mutate(saved, { revalidate: false });
      await tenantMutate(tenantAdminKeys.surveys());
    },
  );
  const shownLoadError = useSwrLoadError(
    notFound ? undefined : loadError,
    "die Umfrage",
    () => void mutate(),
  );

  const published = survey !== undefined && survey.status !== "draft";
  const results = useSWRAuth<SurveyResults>(
    published ? tenantAdminKeys.surveyResults(surveyId) : null,
    () => fetchSurveyResults(surveyId),
    { revalidateOnFocus: false },
  );
  const resultsError = useSwrLoadError(
    results.error,
    "die Auswertung",
    () => void results.mutate(),
  );

  const requestedTab = searchParams.get("reiter");
  const tab: Tab = !published
    ? "fragebogen"
    : requestedTab === "fragebogen"
      ? "fragebogen"
      : requestedTab === "personen" && survey && !survey.anonymous
        ? "personen"
        : "auswertung";

  const respondents = useSWRAuth<SurveyRespondent[]>(
    published && survey && !survey.anonymous && tab === "personen"
      ? tenantAdminKeys.surveyRespondents(surveyId)
      : null,
    () => fetchSurveyRespondents(surveyId),
    { revalidateOnFocus: false },
  );
  const respondentsError = useSwrLoadError(
    respondents.error,
    "die Antworten",
    () => void respondents.mutate(),
  );

  const editing =
    survey?.status === "draft" && searchParams.get("bearbeiten") === "1";

  const refresh = async () => {
    await Promise.all([
      mutate(),
      results.mutate(),
      tenantMutate(tenantAdminKeys.surveys()),
    ]);
  };

  const awaitingErrorText = !!loadError && !notFound && !shownLoadError;
  // Before the session is known, useSWRAuth holds the key back and reports
  // no request, so a missing survey without an error is still loading.
  if ((!survey && !loadError) || awaitingErrorText) {
    return (
      <TenantPage
        info={SURVEY_DETAIL_INFO}
        title="Umfrage"
        {...BACK}
        statsLoading
        loading
      />
    );
  }
  if (loadError || !survey) {
    return (
      <TenantPage
        info={SURVEY_DETAIL_INFO}
        title="Umfrage"
        {...BACK}
        error={
          loadError && !notFound
            ? shownLoadError
            : "Diese Umfrage gibt es nicht mehr."
        }
      />
    );
  }

  const exportPdf = async () => {
    setExporting(true);
    try {
      await downloadSurveyResultsPdf(survey.id);
    } catch (err: unknown) {
      logger.error("survey_export_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void exportErrors.show(err, {
        object: "die Auswertung als PDF",
        retry: () => void exportPdf(),
      });
    } finally {
      setExporting(false);
    }
  };

  const menuItems = buildSurveyMenuItems(survey, {
    onPublish: () => setAction("publish"),
    onEdit: () => updateUrlParams({ bearbeiten: "1", reiter: null }),
    onRemind: () => setAction("remind"),
    onCloseSurvey: () => setAction("close"),
    onExport:
      results.data?.available && !exporting
        ? () => void exportPdf()
        : undefined,
    onDelete: () => setAction("delete"),
  });

  const stats = (
    <TenantPageStats
      items={[
        { label: describeSurveyAudience(survey) },
        { label: `Teilnahme bis ${formatSurveyClosesAt(survey.closes_at)}` },
        ...(survey.status === "draft"
          ? []
          : [
              {
                value: survey.participant_count,
                label:
                  survey.participant_count === 1 ? "Teilnahme" : "Teilnahmen",
              },
            ]),
      ]}
    />
  );

  const tabs = published
    ? {
        value: tab,
        onChange: (next: string) =>
          updateUrlParams({ reiter: next === "auswertung" ? null : next }),
        inUrl: true,
        items: [
          { value: "auswertung", label: "Auswertung" },
          { value: "fragebogen", label: "Fragebogen" },
          ...(survey.anonymous
            ? []
            : [{ value: "personen", label: "Antworten je Person" }]),
        ],
        label: "Bereiche der Umfrage",
      }
    : undefined;

  return (
    <TenantPage
      info={SURVEY_DETAIL_INFO}
      title={survey.title}
      stats={stats}
      {...BACK}
      leading={
        <MotoDuotoneIcon
          icon={pollsConcept.icon}
          tone={pollsConcept.tone}
          size={40}
        />
      }
      actions={
        <>
          <SurveyStatusBadge status={survey.status} />
          <SurveyAnonymityBadge anonymous={survey.anonymous} />
          {!editing && (
            <OverflowMenu ariaLabel="Weitere Aktionen" items={menuItems} />
          )}
        </>
      }
      tabs={tabs}
      overlays={
        <>
          {action === "publish" && (
            <PublishSurveyDialog
              survey={survey}
              reload={() => revalidateOrThrow(surveyRead)}
              onClose={() => setAction(null)}
              onDone={refresh}
            />
          )}
          {action === "close" && (
            <CloseSurveyDialog
              survey={survey}
              onClose={() => setAction(null)}
              onDone={refresh}
            />
          )}
          {action === "remind" && (
            <RemindSurveyDialog
              survey={survey}
              onClose={() => setAction(null)}
              onReminded={(count) => toastSuccess(remindedMessage(count))}
            />
          )}
          {action === "delete" && (
            <DeleteSurveyDialog
              survey={survey}
              reload={() => revalidateOrThrow(surveyRead)}
              onClose={() => setAction(null)}
              onDone={async () => {
                await tenantMutate(tenantAdminKeys.surveys());
                router.push("/umfragen");
              }}
            />
          )}
        </>
      }
    >
      {tab === "auswertung" &&
        (resultsError ? (
          <SectionCard>
            <FormErrorAlert message={resultsError} />
          </SectionCard>
        ) : results.data ? (
          <SurveyResultsView results={results.data} />
        ) : (
          <SectionCard title="Auswertung" loading />
        ))}

      {tab === "personen" &&
        (respondentsError ? (
          <SectionCard>
            <FormErrorAlert message={respondentsError} />
          </SectionCard>
        ) : respondents.data ? (
          <SurveyRespondentsView
            survey={survey}
            respondents={respondents.data}
          />
        ) : (
          <SectionCard title="Antworten je Person" loading />
        ))}

      {tab === "fragebogen" ? (
        <LoadErrorAlert error={editAfterWrite.error} />
      ) : null}
      {tab === "fragebogen" &&
        (editing ? (
          <SurveyEditSection
            read={surveyRead}
            onCancel={() => updateUrlParams({ bearbeiten: null })}
            onSaved={(saved) => {
              updateUrlParams({ bearbeiten: null });
              return editAfterWrite.refresh(saved);
            }}
          />
        ) : (
          <SurveyReadView survey={survey} />
        ))}
    </TenantPage>
  );
}

function SurveyReadView({ survey }: Readonly<{ survey: Survey }>) {
  const questions = sortedSurveyQuestions(survey.questions);
  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Angaben"
        description={
          survey.status === "draft"
            ? "Entwurf: Noch sieht niemand die Umfrage. Ändere sie über das Menü oben mit „Bearbeiten“."
            : "Veröffentlicht: Die Angaben lassen sich nicht mehr ändern."
        }
      >
        <DataGrid>
          <DataField label="Wer antwortet">
            {describeSurveyAudience(survey)}
          </DataField>
          <DataField label="Anonym">
            {survey.anonymous ? "Ja" : "Nein, der Name steht bei der Antwort"}
          </DataField>
          <DataField label="Teilnahme bis">
            {formatSurveyClosesAt(survey.closes_at)}
          </DataField>
          {survey.audience === "parents" && (
            <DataField label="Zusätzlich per E-Mail">
              {survey.send_email ? "Ja" : "Nein"}
            </DataField>
          )}
          <DataField label="Einleitung" fullWidth>
            <span className="whitespace-pre-line">{survey.intro || "–"}</span>
          </DataField>
        </DataGrid>
      </SectionCard>
      <SectionCard title={`Fragen (${questions.length})`}>
        <ol className="space-y-4">
          {questions.map((question, index) => (
            <li key={question.id} className="space-y-1">
              <p className="text-sm font-semibold text-gray-900">
                {index + 1}. {question.prompt}
              </p>
              <p className="text-sm text-gray-500">
                {SURVEY_QUESTION_KIND_LABEL[question.kind]}
                {question.required ? " · Pflichtfrage" : " · freiwillig"}
              </p>
              {question.options.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-gray-700">
                  {question.options.map((option) => (
                    <li key={option.id}>{option.label}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </SectionCard>
    </div>
  );
}

function SurveyEditSection({
  read,
  onCancel,
  onSaved,
}: Readonly<{
  /** The survey read of the page; the draft rests on it (ADR 0311). */
  read: ReturnType<typeof useSWRAuth<Survey>>;
  onCancel: () => void;
  /** Closes the editor and reloads; never rejects (#6652). */
  onSaved: RefreshAfterWrite<[saved: Survey]>;
}>) {
  const readRef = useRef(read);
  useLayoutEffect(() => {
    readRef.current = read;
  });
  // The draft rests on the survey as read when editing started: a newer
  // read refills it only while untouched, and saving sends that version.
  const edit = useDraftOn<Survey, SurveyEditorDraft, string, Survey>(
    {
      opening: read.data?.id ?? null,
      data: read.data,
      error: read.error,
      reload: () => revalidateOrThrow(readRef.current),
      write: (stored) => read.mutate(stored, { revalidate: false }),
    },
    {
      token: (survey) => survey.version,
      toDraft: surveyDraftFromSurvey,
      answer: (saved) => saved,
    },
  );
  const draft = edit.draft;
  const [errors, setErrors] = useState<SurveyEditorErrors | null>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formRef);
  const form = useReadDraftForm(edit, formErrors, "die Umfrage");
  // „Wiederholen“ speichert den jetzt sichtbaren Entwurf, nicht den vom
  // Fehlversuch (#6503).
  const latestSave = useRef<() => Promise<void>>(async () => undefined);
  const lookups = useParentTargetLookups(draft?.audience === "parents");

  const save = async () => {
    if (!draft) return;
    const found = validateSurveyDraft(draft);
    setErrors(found);
    if (hasEditorErrors(found)) {
      formErrors.clear();
      formErrors.invalid(SURVEY_FORM_CHECK_MESSAGE);
      return;
    }
    // Nothing goes out before the stored survey is read; a shown error stays.
    if (!form.begin()) return;
    setSaving(true);
    const result = await edit.submit((version, current) =>
      updateSurvey(read.data?.id ?? "", surveyInputFromDraft(current), version),
    );
    setSaving(false);
    if (!result.ok) {
      logger.error("survey_update_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Changed meanwhile: `reload` shows the stored survey, no retry.
      void formErrors.show(
        result.error,
        result.refused
          ? { object: "die Umfrage", reload: result.reload }
          : { object: "die Umfrage", retry: () => void latestSave.current() },
      );
      return;
    }
    await onSaved(result.saved);
  };
  useLayoutEffect(() => {
    latestSave.current = save;
  });

  return (
    <SectionCard title="Entwurf bearbeiten">
      <div ref={formRef} className="space-y-6">
        <FormErrorAlert message={formErrors.error} />
        <LoadErrorAlert error={form.loadError} />
        {draft ? (
          <SurveyEditorFields
            draft={draft}
            onChange={(next) => {
              edit.setDraft(next);
              if (errors) setErrors(validateSurveyDraft(next));
            }}
            errors={errors}
            disabled={saving}
            {...lookups}
          />
        ) : null}
        <EditActions
          onCancel={onCancel}
          onSave={() => void save()}
          saving={saving}
          disabled={!edit.canSubmit}
          disabledReason={readStateWaitReason(edit.status)}
        />
      </div>
    </SectionCard>
  );
}

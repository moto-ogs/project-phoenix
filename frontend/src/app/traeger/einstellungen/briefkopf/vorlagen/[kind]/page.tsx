"use client";

// Eine Vorlage des Trägers (#4677, ADR 0152): Betreff, Anrede, Brieftext und
// Grußformel mit Platzhaltern, bei Schreiben mit Rechnung die Darstellung der
// Rechnungstabelle (#5691), die Vorschau des ganzen Briefs mit Beispieldaten
// im Briefkopf des Trägers und die gespeicherten Versionen. Auf breiten
// Bildschirmen steht die Vorschau neben dem Formular und bleibt beim Scrollen
// sichtbar. Speichern legt eine neue Version an; unbekannte Platzhalter lehnt
// das Backend ab.

import { useParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { DocumentTemplateInvoiceFields } from "~/components/traeger/document-template-invoice-fields";
import { DocumentTemplatePlaceholdersCard } from "~/components/traeger/document-template-placeholders-card";
import { DocumentTemplatePreviewBody } from "~/components/traeger/document-template-preview-body";
import { DocumentTemplateVersionsCard } from "~/components/traeger/document-template-versions-card";
import { TraegerLetterheadPreview } from "~/components/traeger/traeger-letterhead-preview";
import { useTraegerSettingsSchema } from "~/components/traeger/use-traeger-resources";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { Textarea } from "~/components/ui/textarea";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { hasPermission } from "~/lib/auth-utils";
import { formatDate } from "~/lib/date-helpers";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import type { ResolvedSetting } from "~/lib/settings-api";
import { useInvalidateFamily } from "~/lib/swr";
import { useDraftOn } from "~/lib/swr/read-draft";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchTraegerMasterData, traegerLogoSrc } from "~/lib/traeger-api";
import { TRAEGER_BRANDING_TAB } from "~/lib/traeger-branding";
import {
  DOCUMENT_TEMPLATE_KIND_LABELS,
  DOCUMENT_TEMPLATE_KIND_USE,
  type DocumentTemplateDetail,
  type DocumentTemplateKind,
  type DocumentTemplatePlaceholder,
  type DocumentTemplatePreview,
  type DocumentTemplateText,
  type DocumentTemplateVersion,
  fetchDocumentTemplate,
  hasInvoiceTable,
  hasLegalRemedy,
  invoiceLayoutOf,
  isDocumentTemplateKind,
  previewDocumentTemplate,
  sameTemplateText,
  saveDocumentTemplate,
  templateTextOf,
} from "~/lib/traeger-document-templates";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerVorlagePage" });

/** Das Träger-Recht, das Vorlagen ändert (ADR 0084 Abschnitt 4). */
const SETTINGS_RIGHT = "traeger_settings:manage";

export default function TraegerVorlagePage() {
  const params = useParams<{ kind: string }>();
  const kind = params?.kind ?? "";
  if (!isDocumentTemplateKind(kind)) {
    return (
      <TenantPage
        title="Vorlage"
        back
        backHref={traegerPath("/traeger/einstellungen/briefkopf/vorlagen")}
        backLabel="Zurück zu den Vorlagen"
      >
        <Alert
          type="info"
          message="Diese Vorlage gibt es nicht. Wähle eine aus der Liste."
        />
      </TenantPage>
    );
  }
  return <TemplateEditorPage key={kind} kind={kind} />;
}

function TemplateEditorPage({
  kind,
}: Readonly<{ kind: DocumentTemplateKind }>) {
  const { data: session } = useSession();
  const canEdit = hasPermission(session ?? null, SETTINGS_RIGHT);
  // The preview of a draft; `null` shows the preview of the saved text.
  const [draftPreview, setDraftPreview] = useState<{
    readonly text: DocumentTemplateText;
    readonly preview: DocumentTemplatePreview;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // A save or reload makes every older draft preview obsolete.
  const previewRequest = useRef(0);
  const {
    data: schema,
    isLoading: schemaLoading,
    loadError: schemaError,
  } = useTraegerSettingsSchema();
  // Templates hold no personal data and no read is logged: the shared
  // cache shows a revisit at once. A save sends the version its draft
  // started from; the backend refuses one saved since (ADR 0311).
  const template = useTraegerResource(
    traegerKeys.documentTemplate(kind),
    () => fetchDocumentTemplate(kind),
    "die Vorlage",
  );
  const master = useTraegerResource(
    traegerKeys.masterData(),
    fetchTraegerMasterData,
    "die Vorlage",
  );
  const savedVersion = template.data?.current ?? null;
  const current = savedVersion ? templateTextOf(savedVersion) : null;
  // The preview of the previous version stays until the new one is there.
  const savedPreview = useTraegerResource(
    savedVersion && current
      ? traegerKeys.documentTemplatePreview(kind, savedVersion.version)
      : null,
    () =>
      current
        ? previewDocumentTemplate(kind, current)
        : Promise.reject(new Error("no saved template")),
    "die Vorlage",
    { keepPreviousData: true },
  );
  const invalidateFamily = useInvalidateFamily();
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Die letzte Schreibmarke im Brieftext. Ein Klick auf einen Platzhalter
  // nimmt dem Feld den Fokus; ohne Marke kommt der Platzhalter ans Ende.
  const caret = useRef<{ start: number; end: number } | null>(null);
  const formErrors = useApiFormError(formRef);
  const { success } = useToast();

  // Reads the template again and rejects when that fails.
  const { mutate: mutateTemplate, reloadOrThrow } = template;
  // Nachladen nach dem Speichern: ein Fehler dabei ist ein Ladefehler über
  // der Vorlage, der sagt, dass die Änderung gespeichert ist, kein
  // gescheitertes Speichern (#6652).
  const afterSave = useRefreshAfterWrite(
    "die Anzeige der Vorlage",
    reloadOrThrow,
  );
  // The read after a save goes through `afterSave`; every other read of
  // the editor (after a refusal) rejects for the error path.
  const saveRead = useRef(false);
  const saveReadFailed = useRef(false);
  const readTemplate = useCallback(async () => {
    if (!saveRead.current) return reloadOrThrow();
    saveRead.current = false;
    saveReadFailed.current = !(await afterSave.refresh());
    if (saveReadFailed.current) {
      throw new Error("the template could not be read after the save");
    }
    // The stored template arrives through `template.data`.
    return undefined;
  }, [afterSave, reloadOrThrow]);
  // The editor's text rests on the version it started from (ADR 0311): a
  // newer read refills it only while untouched; after a refused save the
  // draft stays only while the stored text is the one it started from,
  // otherwise the colleague's text shows, so a second „Speichern“ cannot
  // replace it unseen. Nothing is sent until a read of the stored template
  // succeeded, also after a save whose read failed.
  const editor = useDraftOn<
    DocumentTemplateDetail,
    DocumentTemplateText,
    string,
    DocumentTemplateVersion
  >(
    {
      opening: kind,
      data: template.data ?? undefined,
      reload: readTemplate,
      write: (stored) => mutateTemplate(stored, { revalidate: false }),
    },
    {
      token: (stored) => stored.version,
      toDraft: (stored) => templateTextOf(stored.current),
      same: sameTemplateText,
      rebase: (draft, from, to) =>
        sameTemplateText(
          templateTextOf(from.current),
          templateTextOf(to.current),
        )
          ? draft
          : templateTextOf(to.current),
    },
  );
  const error =
    template.error ?? master.error ?? savedPreview.error ?? schemaError;
  const draft = editor.draft ?? current;
  // Changes the draft.
  const edit = (next: (base: DocumentTemplateText) => DocumentTemplateText) =>
    editor.setDraft(next);
  const previewed = draftPreview?.text ?? current;
  const preview = draftPreview?.preview ?? savedPreview.data;
  const data =
    template.data && master.data && preview
      ? { detail: template.data, masterData: master.data, preview }
      : null;

  const showPreview = async () => {
    if (!draft || !data || saving || previewing) return;
    const request = ++previewRequest.current;
    formErrors.clear();
    setPreviewing(true);
    const shown = draft;
    try {
      const preview = await previewDocumentTemplate(kind, shown);
      if (request !== previewRequest.current) return;
      setDraftPreview({ text: shown, preview });
    } catch (err) {
      if (request !== previewRequest.current) return;
      logger.warn("traeger_document_template_preview_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void formErrors.show(err, { object: "die Vorschau" });
    } finally {
      if (request === previewRequest.current) setPreviewing(false);
    }
  };

  const save = async () => {
    if (!draft || saving || !editor.canSubmit) return;
    previewRequest.current++;
    setPreviewing(false);
    formErrors.clear();
    setSaving(true);
    saveReadFailed.current = false;
    const result = await editor.submit(async (version, submitted) => {
      const saved = await saveDocumentTemplate(kind, submitted, version);
      saveRead.current = true;
      return saved;
    });
    if (!result.ok) {
      logger.error("traeger_document_template_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Someone saved a version since: `reload` shows it (number, date,
      // text, versions) instead of the draft over it.
      void formErrors.show(result.error, {
        object: "die Vorlage",
        reload: result.reload,
      });
      if (result.refused) setDraftPreview(null);
      setSaving(false);
      return;
    }
    void invalidateFamily(traegerKeys.documentTemplatesFamily);
    success(
      `Die Vorlage ist gespeichert. Neue Schreiben nutzen Version ${result.saved.version}.`,
    );
    // The read after the save failed: the page shows the saved version and
    // its text, and saving waits for a successful read of its token.
    if (saveReadFailed.current) {
      const saved = result.saved;
      await mutateTemplate(
        (before) => (before ? { ...before, current: saved } : before),
        { revalidate: false },
      );
      editor.setDraft(templateTextOf(saved));
    }
    setDraftPreview(null);
    setSaving(false);
  };

  const changed =
    draft !== null && current !== null && !sameTemplateText(draft, current);
  const previewStale =
    draft !== null && previewed !== null && !sameTemplateText(draft, previewed);
  const standard = data?.detail.standardTemplate ?? null;
  const branding =
    schema?.tabs.find((tab) => tab.key === TRAEGER_BRANDING_TAB) ?? null;
  const brandingValue = (key: string): string => {
    const item: ResolvedSetting | undefined = branding?.categories
      .flatMap((category) => category.items)
      .find((candidate) => candidate.key === key);
    return typeof item?.value === "string" ? item.value : "";
  };
  const set = (
    part: "subject" | "salutation" | "body" | "closing" | "legalRemedy",
    value: string,
  ) => edit((base) => ({ ...base, [part]: value }));
  const rememberCaret = (field: HTMLTextAreaElement) => {
    caret.current = { start: field.selectionStart, end: field.selectionEnd };
  };
  // Setzt den Platzhalter an die letzte Schreibmarke des Brieftexts, ohne
  // Marke ans Ende, und lässt die Marke hinter ihm stehen.
  const insertPlaceholder = (placeholder: DocumentTemplatePlaceholder) => {
    if (!draft) return;
    const field = bodyRef.current;
    const token = `{{${placeholder.name}}}`;
    const length = draft.body.length;
    const end = Math.min(caret.current?.end ?? length, length);
    const start = Math.min(caret.current?.start ?? length, end);
    // Eine Tabelle druckt nur allein in ihrer Zeile.
    const before =
      placeholder.table && start > 0 && draft.body[start - 1] !== "\n"
        ? "\n"
        : "";
    const after =
      placeholder.table && end < draft.body.length && draft.body[end] !== "\n"
        ? "\n"
        : "";
    const insert = before + token + after;
    const body = draft.body.slice(0, start) + insert + draft.body.slice(end);
    set("body", body);
    const next = start + insert.length;
    caret.current = { start: next, end: next };
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next, next);
    });
  };
  const invoice = data && hasInvoiceTable(data.detail.placeholders);

  return (
    <TenantPage
      title={DOCUMENT_TEMPLATE_KIND_LABELS[kind]}
      back
      backHref={traegerPath("/traeger/einstellungen/briefkopf/vorlagen")}
      backLabel="Zurück zu den Vorlagen"
      info={DOCUMENT_TEMPLATE_KIND_USE[kind]}
      stats={
        data ? (
          <TenantPageStats
            items={
              data.detail.current.standard
                ? [{ value: "Standardvorlage", label: "gilt" }]
                : [
                    {
                      value: `Version ${data.detail.current.version}`,
                      label: data.detail.current.createdAt
                        ? `vom ${formatDate(data.detail.current.createdAt)}`
                        : "gilt",
                    },
                  ]
            }
          />
        ) : null
      }
      statsLoading={!data && !error}
      error={error}
      loading={!error && (!data || schemaLoading)}
    >
      {data && draft && schema ? (
        <>
          <LoadErrorAlert error={afterSave.error} />
          {!canEdit ? (
            <Alert
              type="info"
              message="Du kannst die Vorlage nur ansehen. Ändern kann, wer im Träger-Büro die Rolle „Verwaltung“ hat."
            />
          ) : null}
          {/* Zwei Spalten ab xl: links bearbeiten, rechts die Vorschau, die
              beim Scrollen stehen bleibt. Auf schmalen Bildschirmen folgt
              die Vorschau direkt auf das Formular. */}
          <div className="compact:gap-4 grid gap-6 max-sm:gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
            <div className="compact:gap-4 flex min-w-0 flex-col gap-6 max-sm:gap-3">
              <SectionCard
                title="Text der Vorlage"
                description="Das steht im Brief unter dem Briefkopf. Speichern legt eine neue Version an."
                action={
                  canEdit && standard && !sameTemplateText(draft, standard) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      tooltip="Setzt den Standardtext ins Formular, gespeichert wird erst mit „Speichern“."
                      disabled={saving}
                      onClick={() => {
                        edit(() => templateTextOf(standard));
                        formErrors.clear();
                      }}
                    >
                      Standardtext laden
                    </Button>
                  ) : null
                }
              >
                <form
                  ref={formRef}
                  noValidate
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                  }}
                >
                  <FormErrorAlert message={formErrors.error} />
                  <Input
                    controlSize="compact"
                    id="template-subject"
                    label="Betreff"
                    name="subject"
                    required
                    value={draft.subject}
                    onChange={(e) => set("subject", e.target.value)}
                    error={formErrors.fieldError("subject")}
                    maxLength={200}
                    disabled={!canEdit || saving}
                  />
                  <Input
                    controlSize="compact"
                    id="template-salutation"
                    label="Anrede"
                    name="salutation"
                    value={draft.salutation}
                    onChange={(e) => set("salutation", e.target.value)}
                    error={formErrors.fieldError("salutation")}
                    maxLength={200}
                    disabled={!canEdit || saving}
                  />
                  <Textarea
                    id="template-body"
                    label="Brieftext"
                    name="body"
                    required
                    rows={14}
                    ref={bodyRef}
                    onBlur={(e) => rememberCaret(e.currentTarget)}
                    value={draft.body}
                    onChange={(e) => set("body", e.target.value)}
                    error={formErrors.fieldError("body")}
                    maxLength={10000}
                    disabled={!canEdit || saving}
                    // The whole letter in view, no box cut mid-line: the
                    // field grows with its text, at least 14 lines high.
                    className="[field-sizing:content] min-h-72 font-mono"
                  />
                  <Textarea
                    id="template-closing"
                    label="Grußformel"
                    name="closing"
                    rows={3}
                    value={draft.closing}
                    onChange={(e) => set("closing", e.target.value)}
                    error={formErrors.fieldError("closing")}
                    maxLength={500}
                    disabled={!canEdit || saving}
                  />
                  {hasLegalRemedy(kind) ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        id="template-legal-remedy"
                        label="Rechtsbehelfsbelehrung"
                        name="legal_remedy"
                        hint="Steht auf jedem Gebührenbescheid nach dem Brieftext. Nenne Frist, Stelle und Form des Widerspruchs."
                        rows={6}
                        value={draft.legalRemedy ?? ""}
                        onChange={(event) =>
                          set("legalRemedy", event.target.value)
                        }
                        error={formErrors.fieldError("legal_remedy")}
                        maxLength={5000}
                        disabled={!canEdit || saving}
                      />
                      {(draft.legalRemedy ?? "").trim() === "" ? (
                        <Alert
                          type="warning"
                          size="compact"
                          message="Ohne Rechtsbehelfsbelehrung gibt moto keinen Gebührenbescheid frei."
                        />
                      ) : null}
                    </div>
                  ) : null}
                  {invoice ? (
                    <DocumentTemplateInvoiceFields
                      layout={invoiceLayoutOf(draft)}
                      onChange={(layout) =>
                        edit((base) =>
                          templateTextOf({ ...base, invoice: layout }),
                        )
                      }
                      disabled={!canEdit || saving}
                      error={formErrors.fieldError("invoice")}
                    />
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4">
                    {/* The note stands right beside the button it explains. */}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        tooltip="Zeigt, wie der Brief mit dem aktuellen Text aussieht."
                        disabled={saving || previewing || !previewStale}
                        isLoading={previewing}
                        loadingText="Vorschau lädt…"
                        onClick={() => void showPreview()}
                      >
                        Vorschau zeigen
                      </Button>
                      {!previewStale && !previewing ? (
                        <span className="text-sm text-gray-600">
                          Die Vorschau ist aktuell.
                        </span>
                      ) : null}
                    </div>
                    {canEdit && changed ? (
                      <EditActions
                        onCancel={() => {
                          editor.discard();
                          formErrors.clear();
                        }}
                        saving={saving}
                        saveType="submit"
                        disabled={!editor.canSubmit}
                        disabledReason={
                          editor.status === "loadFailed"
                            ? "Lade zuerst die gespeicherte Vorlage neu."
                            : undefined
                        }
                      />
                    ) : null}
                  </div>
                </form>
              </SectionCard>
            </div>
            {/* Below xl the preview follows the form directly: checking the
                letter after an edit is the frequent step. */}
            <div className="min-w-0 xl:sticky xl:top-6 xl:row-span-3">
              <SectionCard
                title="Vorschau"
                description="So sieht der ganze Brief aus. Kopf, Infoblock und Fußzeile kommen aus dem Briefkopf. Im Brieftext ist alles ein Beispiel: Familie, Kinder, Beträge, Schulen und Ansprechperson."
              >
                {previewStale ? (
                  <Alert
                    type="info"
                    message="Die Vorschau zeigt noch den Text vor deinen Änderungen. Tippe auf „Vorschau zeigen“."
                  />
                ) : null}
                <div className={previewStale ? "mt-4" : undefined}>
                  <TraegerLetterheadPreview
                    label="Vorschau des Briefs"
                    logoSrc={
                      data.masterData.logo
                        ? traegerLogoSrc(data.masterData.logo)
                        : null
                    }
                    letterheadText={brandingValue("branding.letterhead_text")}
                    footerText={brandingValue("branding.footer_text")}
                    color={brandingValue("branding.primary_color")}
                    contact={data.masterData.contact}
                    defaultAccount={
                      data.masterData.bankAccounts.find(
                        (account) => account.isDefault,
                      ) ?? null
                    }
                    recipient={data.preview.recipient}
                    facts={data.preview.facts}
                    body={
                      <DocumentTemplatePreviewBody preview={data.preview} />
                    }
                  />
                </div>
              </SectionCard>
            </div>
            <div className="compact:gap-4 flex min-w-0 flex-col gap-6 max-sm:gap-3">
              <DocumentTemplatePlaceholdersCard
                placeholders={data.detail.placeholders}
                onInsert={canEdit ? insertPlaceholder : undefined}
                disabled={saving}
              />

              <DocumentTemplateVersionsCard
                versions={data.detail.versions}
                canEdit={canEdit}
                disabled={saving}
                onLoad={(version) => {
                  edit(() => templateTextOf(version));
                  formErrors.clear();
                  formRef.current?.scrollIntoView?.({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
              />
            </div>
          </div>
        </>
      ) : null}
    </TenantPage>
  );
}

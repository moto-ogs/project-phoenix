"use client";

// Anmeldeformular eines Ferienzeitraums bauen (#5198): dieselben Bausteine
// wie der Baukasten der Online-Anmeldung, beschränkt auf einfache Feldtypen
// und Bedingungen auf andere Fragen. Jede Frage gilt je Familie oder je Kind
// und kann eine Gesundheitsangabe sein. Eine Frage ohne Gesundheitsangabe kann
// die ausrichtende OGS sehen (#5202). Der feste Baustein „Anschrift“ fragt
// die Anschrift ab (#5625), der feste Baustein „Gesundheit“ macht Allergien
// und Medikamente zur Pflicht (#6686). Speichern legt eine neue Version an.

import { Plus } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FieldEditorRow,
  FieldErrorContext,
} from "~/components/enrollment/form-field-builder";
import {
  FormPreviewFrame as FormPreview,
  FormPreviewHeading,
  PreviewFieldsSection,
  PreviewSection,
} from "~/components/enrollment/form-preview";
import { LegalBlocksSection } from "~/components/enrollment/legal-blocks-section";
import {
  DraftDocumentContext,
  useDraftDocuments,
  type DraftDocumentSave,
} from "~/components/enrollment/draft-documents";
import { ActionHint } from "~/components/ui/action-hint";
import { Alert } from "~/components/ui/alert";
import { Button, buttonClassName } from "~/components/ui/button";
import { EditActions } from "~/components/ui/edit-actions";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { EmptyState } from "~/components/ui/empty-state";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
// Die Vorschau nennt die Abschnitte wie das Elternformular (#5467).
import germanMessages from "~/i18n/messages/de/holidayRegistration.json";
import {
  blankField,
  blankInfoField,
  type ConditionSource,
  type FormField,
  type FormLegalBlock,
} from "~/lib/enrollment-form-schema-api";
import { draftDocumentURLsInLegalBlocks } from "~/lib/enrollment-legal-blocks";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  HOLIDAY_FORM_FIELD_TYPES,
  type HolidayForm,
  type HolidayFormField,
  saveHolidayForm,
  uploadHolidayDocument,
  deleteHolidayDocument,
} from "~/lib/traeger-holiday-form-api";
import {
  copyStableObjectKey,
  getStableObjectKey,
} from "~/lib/stable-object-key";
import {
  HOLIDAY_ADDRESS_CHOICES,
  holidayAddressPreviewFields,
} from "./holiday-form-address";
import {
  HOLIDAY_HEALTH_CHOICES,
  holidayHealthPreviewFields,
  questionsRepeatingHealthFields,
} from "./holiday-form-health";
import {
  holidayFieldsSignature,
  insertTemplateFields,
  prepareHolidayFieldsForSave,
  templateFieldsMissing,
  validateHolidayForm,
} from "./holiday-form-model";

const logger = createLogger({ component: "HolidayFormEditor" });

const HOLIDAY_CONDITION_SOURCES: readonly ConditionSource[] = ["field"];

const HOLIDAY_FREE_QUESTION_NOTE = {
  text: "Die Antworten siehst du in der Anmeldung. Ohne Gesundheitsangabe stehen sie auch im Export.",
} as const;

/** Marks a health question and a question the hosting OGS sees in the preview. */
function questionBadge(field: FormField) {
  const question = field as HolidayFormField;
  const shared = question.share_with_host ? (
    <StatusBadge tone="blue" label="OGS sieht es" />
  ) : null;
  if (!question.health) return shared;
  return (
    <span className="inline-flex flex-wrap gap-1">
      <StatusBadge tone="orange" label="Gesundheit" />
      {shared}
    </span>
  );
}

/** What the editor changes of a form version. */
interface FormDraft {
  readonly fields: HolidayFormField[];
  readonly legalBlocks: FormLegalBlock[];
  readonly address: HolidayForm["addressRequirement"];
  readonly health: HolidayForm["healthRequirement"];
}

/** New row identities: a refill also discards row-local input drafts. */
function formDraftOf(form: HolidayForm): FormDraft {
  return {
    fields: form.fields.map((field) => ({ ...field })),
    legalBlocks: [...(form.legalBlocks ?? [])],
    address: form.addressRequirement,
    health: form.healthRequirement,
  };
}

function sameFormDraft(a: FormDraft, b: FormDraft): boolean {
  return (
    holidayFieldsSignature(a.fields) === holidayFieldsSignature(b.fields) &&
    JSON.stringify(a.legalBlocks) === JSON.stringify(b.legalBlocks) &&
    a.address === b.address &&
    a.health === b.health
  );
}

export function HolidayFormEditor({
  periodId,
  form,
  onSaved,
  reload,
}: Readonly<{
  periodId: string;
  /**
   * The newest read of the form. The draft rests on the version read when
   * editing starts; a newer version refills it only while untouched
   * (ADR 0311).
   */
  form: HolidayForm;
  onSaved: (form: HolidayForm) => void;
  /**
   * Reads the current form again and rejects when that fails: after a
   * refused save the stored version replaces the draft.
   */
  reload: () => Promise<HolidayForm | undefined>;
}>) {
  const formRef = useRef<HTMLDivElement>(null);
  const healthHeadingId = useId();
  const addressHeadingId = useId();
  const errorPath = useApiFormError(formRef);
  const { success } = useToast();
  const editor = useDraftOn<HolidayForm, FormDraft, number, HolidayForm>(
    { opening: periodId, data: form, reload },
    {
      token: (stored) => stored.version,
      toDraft: formDraftOf,
      same: sameFormDraft,
      answer: (saved) => saved,
    },
  );
  const formErrors = useReadDraftForm(editor, errorPath, "das Anmeldeformular");
  const draft = editor.draft ?? formDraftOf(form);
  const { fields, legalBlocks, address, health } = draft;
  const setFields = (
    next: (current: HolidayFormField[]) => HolidayFormField[],
  ) =>
    editor.setDraft((current) => ({
      ...current,
      fields: next(current.fields),
    }));
  const setLegalBlocks: Dispatch<SetStateAction<FormLegalBlock[]>> = (next) =>
    editor.setDraft((current) => ({
      ...current,
      legalBlocks:
        typeof next === "function" ? next(current.legalBlocks) : next,
    }));
  const setAddress = (next: HolidayForm["addressRequirement"]) =>
    editor.setDraft((current) => ({ ...current, address: next }));
  const setHealth = (next: HolidayForm["healthRequirement"]) =>
    editor.setDraft((current) => ({ ...current, health: next }));
  const adapter = useMemo(
    () => ({
      upload: (file: File) => uploadHolidayDocument(periodId, file),
      remove: (id: string, options?: { keepalive?: boolean }) =>
        deleteHolidayDocument(periodId, id, options),
    }),
    [periodId],
  );
  const draftDocuments = useDraftDocuments(adapter.remove);
  const uploading = draftDocuments.uploading;
  const [saving, setSaving] = useState(false);
  const { fieldError: readFieldError } = errorPath;
  const fieldError = useCallback(
    (name: string) => readFieldError(name) ?? undefined,
    [readFieldError],
  );
  const dirty = editor.touched;
  const template = (editor.base ?? form).template;
  const missingTemplateFields = templateFieldsMissing(fields, template);
  // On a phone a question folds to its head, so the long form stays
  // walkable; from tablet width on every question starts open, all fields
  // in view. A new question opens, and so does one the check marks.
  const isPhone = useMediaQuery(BELOW_SM);
  const foldByDefault = isPhone;
  const [foldChoice, setFoldChoice] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const fieldKey = (field: HolidayFormField) =>
    getStableObjectKey(field, "holiday-field");
  const isOpen = (key: string) => foldChoice.get(key) ?? !foldByDefault;
  const setOpen = (keys: readonly string[], open: boolean) =>
    setFoldChoice((current) => {
      const next = new Map(current);
      for (const key of keys) next.set(key, open);
      return next;
    });
  const addField = (field: HolidayFormField) => {
    setOpen([fieldKey(field)], true);
    setFields((current) => [...current, field]);
  };
  // With required health fields an own question about allergies or
  // medication asks parents a second time (#6686).
  const repeatedHealthQuestions =
    health === "required" ? questionsRepeatingHealthFields(fields) : [];

  const update = (index: number, patch: Partial<HolidayFormField>) =>
    setFields((current) =>
      current.map((field, i) =>
        i === index
          ? copyStableObjectKey(field, { ...field, ...patch })
          : field,
      ),
    );
  const move = (index: number, delta: number) =>
    setFields((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(target, 0, moved);
      return next;
    });
  const remove = (index: number) =>
    setFields((current) => current.filter((_, i) => i !== index));

  const save = async () => {
    // Nothing goes out before the stored form is read; the shown error
    // stays.
    if (!formErrors.begin()) return;
    const errors = validateHolidayForm(fields);
    if (Object.keys(errors).length > 0) {
      const marked = new Set(
        Object.keys(errors).map((name) => /^fields\.(\d+)\./.exec(name)?.[1]),
      );
      setOpen(
        fields.filter((_, index) => marked.has(String(index))).map(fieldKey),
        true,
      );
      errorPath.invalid("Bitte prüfe die markierten Fragen.", errors);
      return;
    }
    setSaving(true);
    let draftSave: DraftDocumentSave | null = null;
    try {
      const result = await editor.submit(async (version, edited) => {
        draftSave = await draftDocuments.startSave(
          draftDocumentURLsInLegalBlocks(
            edited.legalBlocks,
            draftDocuments.drafts(),
          ),
        );
        return saveHolidayForm(
          periodId,
          version,
          prepareHolidayFieldsForSave(edited.fields),
          edited.legalBlocks,
          edited.address,
          edited.health,
        );
      });
      if (result.ok) {
        (draftSave as DraftDocumentSave | null)?.commit();
        success(
          `Das Anmeldeformular ist als Version ${result.saved.version} gespeichert.`,
        );
        onSaved(result.saved);
        return;
      }
      (draftSave as DraftDocumentSave | null)?.fail();
      logger.error("traeger_holiday_form_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Another version was saved since this one was read: the stored
      // version replaces the draft once it is read, without offering the
      // same save again. A failed read shows with a retry of the read alone.
      void errorPath.show(result.error, {
        object: "das Anmeldeformular",
        ...(result.refused ? { reload: result.reload } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  const familyFields = fields.filter((field) => !field.applies_to_child);
  const childFields = fields.filter((field) => field.applies_to_child);

  const editActions = (
    <EditActions
      onCancel={() => {
        errorPath.clear();
        void draftDocuments.cleanup();
        // The draft of the stored version: new row identities also discard
        // row-local input drafts.
        editor.discard();
      }}
      onSave={() => void save()}
      saving={saving}
      cancelDisabled={uploading}
      disabled={!dirty || uploading || !editor.canSubmit}
      {...(!editor.canSubmit &&
      editor.status !== "saving" &&
      dirty &&
      !uploading
        ? {
            disabledReason:
              editor.status === "loadFailed"
                ? "Lade zuerst das gespeicherte Formular neu."
                : "Das gespeicherte Formular wird geladen.",
          }
        : {})}
      // A phone keeps both buttons on one line under the long list: two
      // lines would cover a quarter of the screen with the sticky footer.
      cancelLabel={isPhone ? "Verwerfen" : "Änderungen verwerfen"}
      saveLabel={
        isPhone ? "Neue Version speichern" : "Als neue Version speichern"
      }
    />
  );

  return (
    <DraftDocumentContext.Provider value={draftDocuments.lifecycle}>
      <FieldErrorContext.Provider value={fieldError}>
        {/* Built like the OGS form editor (#7412): one card with the editor
            and a dotted preview column, no cards inside it. */}
        <SectionCard
          padding="none"
          // The save stays in the card and in view while the long list of
          // questions scrolls.
          stickyFooter
          footer={editActions}
        >
          <div
            ref={formRef}
            className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_430px]"
          >
            <div className="compact:p-4 min-w-0 space-y-6 p-5 max-sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Fragen
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm text-gray-600">
                    {`Diese Fragen stehen in der Ferienanmeldung zusätzlich zu den festen Angaben. ${HOLIDAY_FREE_QUESTION_NOTE.text}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    disabled={
                      saving || uploading || missingTemplateFields === 0
                    }
                    disabledReason={
                      missingTemplateFields === 0 && !saving && !uploading
                        ? template.length === 0
                          ? "Für dieses Formular gibt es keine Standardvorlage."
                          : "Alle Fragen der Standardvorlage sind schon im Formular."
                        : undefined
                    }
                    tooltip="Fügt die fehlenden Fragen der Standardvorlage unten im Formular an."
                    onClick={() =>
                      setFields((current) =>
                        insertTemplateFields(current, template),
                      )
                    }
                  >
                    Standardvorlage einfügen
                  </Button>
                  {/* Below lg the preview stands after all questions: the
                      way there is one tap, not a long scroll. */}
                  <ActionHint text="Springt nach unten zur Vorschau des Formulars.">
                    <a
                      href="#holiday-form-preview"
                      className={buttonClassName({
                        variant: "ghost",
                        size: "md",
                        className: "lg:hidden",
                      })}
                    >
                      Zur Vorschau
                    </a>
                  </ActionHint>
                </div>
              </div>

              <div className="space-y-4">
                <FormErrorAlert message={errorPath.error} />
                <LoadErrorAlert error={formErrors.loadError} />
                {missingTemplateFields === 0 && template.length > 0 ? (
                  <p className="text-sm text-gray-600">
                    Alle Fragen der Standardvorlage sind im Formular.
                  </p>
                ) : null}
                {fields.length === 0 ? (
                  <EmptyState
                    variant="compact"
                    title="Noch keine Fragen"
                    description="Eltern sehen nur die festen Angaben. Füge eine Frage oder die Standardvorlage hinzu."
                  />
                ) : (
                  <div className="space-y-3">
                    {fields.map((field, index) => (
                      <FieldEditorRow
                        key={fieldKey(field)}
                        fold={{
                          open: isOpen(fieldKey(field)),
                          onToggle: () =>
                            setOpen(
                              [fieldKey(field)],
                              !isOpen(fieldKey(field)),
                            ),
                        }}
                        field={field}
                        index={index}
                        total={fields.length}
                        allFields={fields}
                        onChange={(patch) => update(index, patch)}
                        onRemove={() => remove(index)}
                        onMoveUp={() => move(index, -1)}
                        onMoveDown={() => move(index, 1)}
                        disabled={saving || uploading}
                        fieldTypes={HOLIDAY_FORM_FIELD_TYPES}
                        conditionSources={HOLIDAY_CONDITION_SOURCES}
                        allowAttachments={false}
                        // Said once under the heading, not on every
                        // question.
                        freeQuestionNote={null}
                        healthToggle={
                          field.type === "information"
                            ? undefined
                            : {
                                checked: Boolean(field.health),
                                onChange: (health) => update(index, { health }),
                              }
                        }
                        hostShareToggle={
                          field.type === "information"
                            ? undefined
                            : {
                                checked: Boolean(field.share_with_host),
                                onChange: (share_with_host) =>
                                  update(index, { share_with_host }),
                              }
                        }
                      />
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    disabled={saving || uploading}
                    className="inline-flex items-center gap-2"
                    tooltip="Fügt eine leere Frage an, die Eltern beantworten."
                    onClick={() =>
                      addField({
                        ...blankField(fields.length),
                        share_with_host: true,
                      })
                    }
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Frage hinzufügen
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    disabled={saving || uploading}
                    className="inline-flex items-center gap-2"
                    tooltip="Fügt einen Text an, den Eltern nur lesen."
                    onClick={() => addField(blankInfoField(fields.length))}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Infotext hinzufügen
                  </Button>
                </div>
              </div>

              <section
                aria-labelledby={healthHeadingId}
                className="space-y-3 border-t border-gray-100 pt-5"
              >
                <div>
                  <SectionLabel id={healthHeadingId}>Gesundheit</SectionLabel>
                  <p className="mt-1 max-w-2xl text-sm text-gray-600">
                    {health === "required"
                      ? "Eltern beantworten für jedes Kind Allergien und Medikamente. Hat das Kind keine, wählen sie „Nein, keine“. Weitere Hinweise bleiben freiwillig."
                      : "Eltern können Allergien, Medikamente und weitere Hinweise angeben. Sie dürfen die Felder leer lassen."}
                  </p>
                </div>
                <SegmentedControl
                  ariaLabel="Allergien und Medikamente abfragen"
                  items={HOLIDAY_HEALTH_CHOICES.map((item) => ({
                    ...item,
                    disabled: saving || uploading,
                  }))}
                  value={health}
                  onChange={setHealth}
                />
                {repeatedHealthQuestions.length > 0 ? (
                  <Alert
                    type="warning"
                    size="compact"
                    message={`Allergien und Medikamente fragt das Formular schon ab. Diese eigenen Fragen fragen es noch einmal: ${repeatedHealthQuestions
                      .map((field) => `„${field.label}“`)
                      .join(
                        ", ",
                      )}. Entferne sie, sonst antworten Eltern doppelt.`}
                  />
                ) : null}
              </section>

              <section
                aria-labelledby={addressHeadingId}
                className="space-y-3 border-t border-gray-100 pt-5"
              >
                <div>
                  <SectionLabel id={addressHeadingId}>Anschrift</SectionLabel>
                  <p className="mt-1 max-w-2xl text-sm text-gray-600">
                    Eltern geben Straße, PLZ und Ort an. Rechnung und
                    Bestätigungsschreiben übernehmen die Anschrift.
                  </p>
                </div>
                {/* Unter sm untereinander: drei Segmente nebeneinander sind
                    breiter als ein 320-px-Telefon abzüglich der Kartenränder. */}
                <SegmentedControl
                  className="max-sm:grid max-sm:w-full max-sm:grid-flow-row"
                  ariaLabel="Anschrift abfragen"
                  items={HOLIDAY_ADDRESS_CHOICES.map((item) => ({
                    ...item,
                    disabled: saving || uploading,
                  }))}
                  value={address}
                  onChange={setAddress}
                />
              </section>

              <LegalBlocksSection
                blocks={legalBlocks}
                standardBlocks={[]}
                customOnly
                uploadAdapter={adapter}
                onChange={setLegalBlocks}
                disabled={saving || uploading}
              />
            </div>

            <aside
              id="holiday-form-preview"
              aria-label="Vorschau für Eltern"
              className="moto-dotted-background moto-dotted-background--split compact:p-4 scroll-mt-24 border-t border-gray-100 p-5 max-sm:p-4 lg:border-t-0 lg:border-l"
            >
              <FormPreview
                title="Ferienanmeldung"
                header={
                  <FormPreviewHeading
                    title="Vorschau für Eltern"
                    hint={
                      dirty
                        ? "Noch nicht gespeichert. Eltern sehen weiter die gespeicherte Version."
                        : "So sehen Eltern das Formular."
                    }
                  />
                }
              >
                <PreviewSection
                  title="Kind"
                  fields={[
                    "Vorname *",
                    "Nachname *",
                    "Geburtsdatum *",
                    "Schule *",
                    "Wochen und Zeitmodell *",
                    ...holidayHealthPreviewFields(health),
                  ]}
                />
                <PreviewFieldsSection
                  title={germanMessages.childQuestionsTitle}
                  fields={childFields}
                  emptyTitle="Keine Fragen oder Infos zum Kind"
                  emptyText="Bei jedem Kind stehen nur die festen Angaben."
                  fieldBadge={questionBadge}
                />
                <PreviewSection
                  title="Elternteil"
                  fields={["Vorname *", "Nachname *", "E-Mail *", "Telefon *"]}
                />
                {address === "off" ? null : (
                  <PreviewSection
                    title={
                      address === "optional"
                        ? germanMessages.addressTitleOptional
                        : germanMessages.addressTitle
                    }
                    fields={holidayAddressPreviewFields(address)}
                  />
                )}
                <PreviewFieldsSection
                  title={germanMessages.familyQuestionsTitle}
                  fields={familyFields}
                  emptyTitle="Keine allgemeinen Fragen oder Infos"
                  emptyText="Beim Elternteil stehen nur die festen Angaben."
                  fieldBadge={questionBadge}
                />
                <PreviewSection
                  title="Kontakte"
                  fields={["Personen: Notfallkontakt und/oder Abholung"]}
                />
                <PreviewSection
                  title="Hinweise und Einwilligungen"
                  fields={legalBlocks
                    .filter((b) => b.enabled)
                    .map((b) => `${b.title}${b.required ? " *" : ""}`)}
                />
                <PreviewSection
                  title="Zustimmungen"
                  fields={[
                    "Datenschutz *",
                    health === "required"
                      ? "Gesundheitsangaben *"
                      : "Gesundheitsangaben (wenn angegeben) *",
                    "Verbindliche Anmeldung (wenn verbindlich) *",
                  ]}
                />
              </FormPreview>
            </aside>
          </div>
        </SectionCard>
      </FieldErrorContext.Provider>
    </DraftDocumentContext.Provider>
  );
}

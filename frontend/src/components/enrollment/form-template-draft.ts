/**
 * The draft of an enrollment form template in the editor: the shape it is
 * saved in, the checks that block a save, and the comparisons behind the
 * unsaved-changes prompt.
 */
import {
  RESERVED_TARGETS,
  type CoreRequirements,
  type FormField,
  type FormFieldTarget,
  type FormLegalBlock,
  type FormSchema,
} from "~/lib/enrollment-form-schema-api";
import {
  isStructuredFieldType,
  savedFieldKey,
} from "~/lib/enrollment-form-field-rules";
import {
  LEGAL_BLOCK_DISPLAY_MODE_PDF,
  prepareLegalBlocksForSave,
} from "~/lib/enrollment-legal-blocks";
import {
  applyFileFieldRules,
  fileFieldDraftProblem,
} from "~/components/enrollment/file-field-editor";

export type ReservedTarget = Exclude<FormFieldTarget, "">;

/**
 * True when newName is a non-empty rename of schema's current name; the
 * builder's name field and the rename dialog share this test.
 */
export function isRenameOf(
  schema: FormSchema | null | undefined,
  newName: string,
): boolean {
  const trimmed = newName.trim();
  return Boolean(schema) && trimmed.length > 0 && trimmed !== schema?.name;
}

/** A suggested field: type and scope come from the target's spec. */
export function createTargetField(
  target: ReservedTarget,
  sortOrder: number,
  required = false,
): FormField {
  const spec = RESERVED_TARGETS[target];
  return {
    key: target.replace(/\./g, "_"),
    label: spec.label,
    type: spec.type,
    required,
    help_text: "",
    options: [],
    sort_order: sortOrder,
    applies_to_child: spec.appliesToChild,
    target,
  };
}

export function prepareFieldsForSave(fields: FormField[]): FormField[] {
  return fields.map((field, index) => {
    if (field.target) {
      // Suggested field: type/options/scope are fixed by the spec, but
      // the admin-edited label + help text + required flag + visibility
      // ride along.
      const base = createTargetField(
        field.target,
        index,
        Boolean(field.required),
      );
      return {
        ...base,
        label: field.label.trim() || base.label,
        help_text: field.help_text?.trim() ?? "",
        visible_when: field.visible_when ?? undefined,
        translations: field.translations,
        // Only the pickup-times field may carry fixed times (arrival stays
        // free-entry); the backend rejects allowed_times on any other
        // target, so anything else is omitted on serialize.
        allowed_times:
          field.target === "schedule.pickup" ? field.allowed_times : undefined,
        // Heimweg-Beschränkung (#2381): only the allowed-departure-modes
        // field may carry grade restrictions; the backend rejects the key
        // on any other target.
        single_mode_grades:
          field.target === "student.allowed_departure_modes" &&
          (field.single_mode_grades?.length ?? 0) > 0
            ? field.single_mode_grades
            : undefined,
      };
    }
    if (field.type === "information") {
      return {
        key: savedFieldKey(field, index),
        label: field.label.trim(),
        type: "information",
        content: field.content?.trim() ?? "",
        sort_order: index,
        applies_to_child: Boolean(field.applies_to_child),
        visible_when: field.visible_when ?? undefined,
        translations: field.translations,
        attachments: field.attachments,
      };
    }
    return applyFileFieldRules({
      ...field,
      key: savedFieldKey(field, index),
      label: field.label.trim(),
      help_text: field.help_text?.trim() ?? "",
      sort_order: index,
      visible_when: field.visible_when ?? undefined,
    });
  });
}

export function coreRequirementsSignature(value: CoreRequirements): string {
  const enabled = Object.entries(value)
    .filter(([, required]) => required)
    .map(([key]) => key)
    .sort((a, b) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(enabled.map((key) => [key, true])));
}

/** A check before saving: the sentence for the alert and the control to mark. */
export interface SchemaDraftProblem {
  readonly message: string;
  readonly field?: string;
  readonly hint?: string;
}

const FILL_IN_HINT = "Bitte fülle dieses Feld aus.";

export function getSchemaDraftValidationMessage({
  fields,
  legalBlocks,
  name,
}: Readonly<{
  fields: FormField[];
  legalBlocks: FormLegalBlock[];
  name: string;
}>): SchemaDraftProblem | null {
  if (name.trim() === "") {
    return {
      message: "Bitte gib zuerst einen Namen für die Vorlage ein.",
      field: "name",
      hint: FILL_IN_HINT,
    };
  }

  for (const [prefix, entries] of [
    ["fields", fields],
    ["legal_blocks", legalBlocks],
  ] as const) {
    for (const [index, entry] of entries.entries()) {
      const attachmentIndex =
        entry.attachments?.findIndex((a) => a.label.trim() === "") ?? -1;
      if (attachmentIndex >= 0)
        return {
          message: "Bitte gib jeder PDF-Datei eine Bezeichnung.",
          field: `${prefix}.${index}.attachments.${attachmentIndex}.label`,
          hint: FILL_IN_HINT,
        };
    }
  }

  const seenKeys = new Set<string>();
  for (const [index, field] of fields.entries()) {
    const position = index + 1;
    const key = savedFieldKey(field, index);

    if (field.type === "information") {
      if ((field.content ?? "").trim() === "") {
        return {
          message: `Bitte gib für den Infotext ${position} einen Text ein.`,
          field: `fields.${index}.content`,
          hint: FILL_IN_HINT,
        };
      }
      if (seenKeys.has(key)) {
        return {
          message: `Bitte ändere den Titel von Infotext ${position}. Ein anderer Eintrag hat schon denselben Titel.`,
          field: `fields.${index}.label`,
          hint: "Bitte wähle einen anderen Titel.",
        };
      }
      seenKeys.add(key);
      continue;
    }

    if (field.label.trim() === "") {
      return {
        message: `Bitte gib für Frage ${position} einen Fragetext ein.`,
        field: `fields.${index}.label`,
        hint: FILL_IN_HINT,
      };
    }

    if (key === "") {
      return {
        message: `Bitte ändere den Fragetext von Frage ${position}. Er braucht mindestens einen Buchstaben oder eine Zahl.`,
        field: `fields.${index}.label`,
        hint: "Bitte verwende Buchstaben oder Zahlen.",
      };
    }
    if (seenKeys.has(key)) {
      return {
        message: `Bitte ändere den Fragetext von Frage ${position}. Eine andere Zusatzfrage hat denselben oder einen sehr ähnlichen Text.`,
        field: `fields.${index}.label`,
        hint: "Bitte wähle einen anderen Fragetext.",
      };
    }
    seenKeys.add(key);

    if (!field.target && isStructuredFieldType(field.type)) {
      return {
        message: `Bitte wähle für Frage ${position} einen einfachen Typ. Telefonlisten, Wochenzeiten und Kontaktlisten gibt es nur als feste Vorschläge.`,
      };
    }

    const fileProblem = fileFieldDraftProblem(field, index);
    if (fileProblem) return fileProblem;

    if (field.type === "select" && (field.options ?? []).length === 0) {
      return {
        message: `Bitte ergänze für Frage ${position} mindestens eine Auswahloption.`,
        field: `fields.${index}.options`,
        hint: "Bitte trage mindestens eine Option ein.",
      };
    }
  }

  const seenLegalKeys = new Set<string>();
  for (const [index, block] of prepareLegalBlocksForSave(
    legalBlocks,
  ).entries()) {
    const position = index + 1;
    if (seenLegalKeys.has(block.key)) {
      // The key is never shown; only removing the duplicate helps.
      return {
        message: `Bitte entferne Zustimmung ${position} und lege sie neu an. Sie ist doppelt vorhanden.`,
      };
    }
    seenLegalKeys.add(block.key);
    if (!block.enabled) continue;
    if (block.title === "") {
      return {
        message: `Bitte gib für Zustimmung ${position} einen Titel ein.`,
        field: `legal_blocks.${index}.title`,
        hint: FILL_IN_HINT,
      };
    }
    if (block.label === "") {
      return {
        message: `Bitte gib für Zustimmung ${position} einen Text neben der Checkbox ein.`,
        field: `legal_blocks.${index}.label`,
        hint: FILL_IN_HINT,
      };
    }
    if (
      block.key === "agb" &&
      block.display_mode === LEGAL_BLOCK_DISPLAY_MODE_PDF &&
      (block.document_url ?? "").trim() === ""
    ) {
      return {
        message:
          "Bitte lade für die AGB eine PDF-Datei hoch. Oder wähle wieder „Text eingeben“.",
      };
    }
  }

  return null;
}

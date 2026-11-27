"use client";

import { useMemo } from "react";
import { Modal } from "~/components/ui/modal";
import {
  DatabaseForm,
  type DatabaseFormErrorPath,
} from "~/components/database/database-form";
import {
  configToFormSection,
  type EntityFormConfig,
} from "@/lib/database/types";

interface DatabaseFormModalProps<T> {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly config: EntityFormConfig<T>;
  readonly onSubmit: (data: Partial<T>) => Promise<void>;
  /** Nachgeladene Felder dürfen einen offenen Entwurf nicht ersetzen. */
  readonly preserveDraftOnSectionsChange?: boolean;
  /** Shared API error path and its `{object}`, see `DatabaseForm`. */
  readonly errorPath: DatabaseFormErrorPath;
  readonly errorObject?: string;
}

export function DatabaseFormModal<T>({
  isOpen,
  onClose,
  config,
  onSubmit,
  preserveDraftOnSectionsChange,
  errorPath,
  errorObject,
}: DatabaseFormModalProps<T>) {
  // Stable identity: DatabaseForm resets its form state whenever the sections
  // array identity changes, which would wipe in-progress edits on every
  // parent re-render (e.g. a loading toggle after a failed save).
  const sections = useMemo(
    () => config.form.sections.map(configToFormSection),
    [config.form.sections],
  );

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={config.createTitle}>
      <DatabaseForm<Partial<T>>
        // Modal rendert seinen Titel als h3.
        sectionLevel={4}
        sections={sections}
        initialData={config.form.defaultValues}
        onSubmit={onSubmit}
        onCancel={onClose}
        submitLabel="Erstellen"
        preserveDraftOnSectionsChange={preserveDraftOnSectionsChange}
        errorPath={errorPath}
        errorObject={errorObject}
      />
    </Modal>
  );
}

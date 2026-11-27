"use client";

import type * as activitiesContract from "~/lib/contract/activities.generated";
import { useState, useEffect, useCallback } from "react";
import type { FormError } from "~/components/ui/form-error";
import { getCategories, type ActivityCategory } from "~/lib/activity-api";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";

const logger = createLogger({ component: "useActivityForm" });
const NO_CATEGORIES: ActivityCategory[] = [];

/**
 * Activity form state shape.
 * Used by both create and edit modals.
 */
export type ActivityFormState = Required<
  Pick<activitiesContract.ActivityRequest, "name" | "category_id">
> & {
  /** The text of the limit field; parseParticipantLimit reads it. */
  max_participants: string;
};

/** A check that failed before sending: the hint and the field it marks. */
interface ActivityFormProblem {
  readonly message: string;
  readonly field: keyof ActivityFormState;
}

/** The first problem of an activity form, or null: checked before sending. */
export function activityFormProblem(
  form: ActivityFormState,
): ActivityFormProblem | null {
  if (!form.name.trim()) {
    return {
      message: "Bitte gib einen Namen für die Aktivität ein.",
      field: "name",
    };
  }
  if (!form.category_id) {
    return {
      message: "Bitte wähle eine Kategorie.",
      field: "category_id",
    };
  }
  if (!form.max_participants) {
    return null;
  }
  const maxParticipants = Number.parseInt(form.max_participants, 10);
  if (Number.isNaN(maxParticipants) || maxParticipants < 1) {
    return {
      message: "Die Teilnehmerzahl muss mindestens 1 sein.",
      field: "max_participants",
    };
  }
  return null;
}

export function parseParticipantLimit(value: string): number | null {
  return value ? Number.parseInt(value, 10) : null;
}

/**
 * Return type for the useActivityForm hook.
 */
interface UseActivityFormReturn {
  /** Current form state */
  form: ActivityFormState;
  /** Update form state */
  setForm: React.Dispatch<React.SetStateAction<ActivityFormState>>;
  /** Available categories */
  categories: ActivityCategory[];
  /** Whether categories are loading */
  loading: boolean;
  /** Failed category load, with retry, for `LoadErrorAlert` */
  loadError: FormError | null;
  /** Handle input change events */
  handleInputChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => void;
  /** Validate form and return the first problem or null */
  validateForm: () => ActivityFormProblem | null;
}

/**
 * Custom hook for managing activity form state and validation.
 *
 * Centralizes form logic shared between ActivityManagementModal
 * and QuickCreateActivityModal to eliminate code duplication.
 *
 * @param initialForm - Initial form values
 * @param isOpen - Whether the modal is open (triggers category loading)
 *
 * @example
 * ```tsx
 * const {
 *   form, setForm, categories, loading, loadError,
 *   handleInputChange, validateForm
 * } = useActivityForm(initialValues, isOpen);
 * ```
 */
export function useActivityForm(
  initialForm: ActivityFormState,
  isOpen: boolean,
): UseActivityFormReturn {
  const [form, setForm] = useState<ActivityFormState>(initialForm);
  // Each opening reads afresh so it includes categories created elsewhere.
  const { data, error, isValidating, mutate } = useSWRAuth(
    tenantDailyKeys.activityCategories(),
    getCategories,
    {
      revalidateOnMount: false,
      revalidateOnFocus: false,
    },
  );
  const categories = data ?? NO_CATEGORIES;
  const loading = isValidating && data === undefined;
  const { error: loadError } = useSwrResourceLoadError(
    [{ data, error }],
    "die Liste der Kategorien",
    () => mutate(),
  );
  useEffect(() => {
    if (error === undefined) return;
    logger.error("failed to load categories", {
      error: error instanceof Error ? error.message : String(error),
    });
  }, [error]);

  useEffect(() => {
    if (isOpen) void mutate();
  }, [isOpen, mutate]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value } = e.target;
      setForm((prev) => ({
        ...prev,
        [name]: value,
      }));
    },
    [],
  );

  const validateForm = useCallback(
    (): ActivityFormProblem | null => activityFormProblem(form),
    [form],
  );

  return {
    form,
    setForm,
    categories,
    loading,
    loadError,
    handleInputChange,
    validateForm,
  };
}

"use client";

import { activitiesConfig } from "@/components/database/configs/activities.config";
import { configToFormSection } from "@/lib/database/types";
import { isSystemActivity, type Activity } from "@/lib/activity-helpers";
import type {
  FormField,
  FormSection,
} from "~/components/database/database-form";

/**
 * moto provisions a system activity with its name and category; the backend
 * refuses to change either, so the form shows both locked. Its category is a
 * system category the category list leaves out, so the field offers the
 * activity's own category as its only option instead of an empty choice.
 */
function lockSystemField(field: FormField, activity: Activity): FormField {
  if (field.name === "name") {
    return {
      ...field,
      disabled: true,
      helperText: "Systemaktivität: Name kann nicht geändert werden",
    };
  }
  if (field.name === "ag_category_id") {
    return {
      ...field,
      disabled: true,
      helperText: "Systemaktivität: Kategorie kann nicht geändert werden",
      options: activity.category_name
        ? [{ value: activity.ag_category_id, label: activity.category_name }]
        : field.options,
    };
  }
  return field;
}

export function buildActivityFormSections(
  activity: Activity | null | undefined,
): FormSection[] {
  const sections = activitiesConfig.form.sections.map(configToFormSection);

  if (!activity || !isSystemActivity(activity)) return sections;

  return sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => lockSystemField(field, activity)),
  }));
}

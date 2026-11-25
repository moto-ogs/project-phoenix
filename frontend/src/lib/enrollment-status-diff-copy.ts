import type { useTranslations } from "next-intl";
import type { EnrollmentChangeRequestDiffCopy } from "~/lib/enrollment-change-request-diff";

export function enrollmentStatusDiffCopy(
  t: ReturnType<typeof useTranslations<"enrollmentStatus">>,
): EnrollmentChangeRequestDiffCopy {
  return {
    snapshotLabels: {
      additional_guardians: t("diff.snapshot.additional_guardians"),
      children: t("diff.snapshot.children"),
      consent_flags: t("diff.snapshot.consent_flags"),
      custom_data: t("diff.snapshot.custom_data"),
      guardian_email: t("diff.snapshot.guardian_email"),
      guardian_first_name: t("diff.snapshot.guardian_first_name"),
      guardian_last_name: t("diff.snapshot.guardian_last_name"),
      guardian_phone: t("diff.snapshot.guardian_phone"),
      phase_id: t("diff.snapshot.phase_id"),
    },
    consentLabels: {
      agb: t("diff.consent.agb"),
      data_processing: t("diff.consent.data_processing"),
      email_contact: t("diff.consent.email_contact"),
      photo: t("diff.consent.photo"),
    },
    childSnapshotLabels: {
      custom_data: t("diff.child.custom_data"),
      date_of_birth: t("diff.child.date_of_birth"),
      first_name: t("diff.child.first_name"),
      holiday_care_wish: t("diff.child.holiday_care_wish"),
      last_name: t("diff.child.last_name"),
      offering_days: t("diff.child.offering_days"),
      offering_ids: t("diff.child.offering_ids"),
      target_grade_level: t("diff.child.target_grade_level"),
      target_school_class: t("diff.child.target_school_class"),
    },
    guardianSnapshotLabels: {
      email: t("diff.guardian.email"),
      first_name: t("diff.guardian.first_name"),
      last_name: t("diff.guardian.last_name"),
      phone: t("diff.guardian.phone"),
    },
    recordValueLabels: {
      automatic_selected_days: t("diff.record.automatic_selected_days"),
      available_days: t("diff.record.available_days"),
      days_of_week_mode: t("diff.record.days_of_week_mode"),
      email: t("diff.record.email"),
      first_name: t("diff.record.first_name"),
      last_name: t("diff.record.last_name"),
      manual_selected_days: t("diff.record.manual_selected_days"),
      offering_id: t("diff.record.offering_id"),
      offering_ids: t("diff.record.offering_ids"),
      phone: t("diff.record.phone"),
      selected_days: t("diff.record.selected_days"),
    },
    weekdayLabels: {
      mon: t("diff.weekday.mon"),
      tue: t("diff.weekday.tue"),
      wed: t("diff.weekday.wed"),
      thu: t("diff.weekday.thu"),
      fri: t("diff.weekday.fri"),
      sat: t("diff.weekday.sat"),
      sun: t("diff.weekday.sun"),
    },
    childEntryLabel: t("diff.childEntry"),
    additionalGuardianEntryLabel: t("diff.additionalGuardianEntry"),
    emptyLabel: t("notProvided"),
    yesLabel: t("diff.yes"),
    noLabel: t("diff.no"),
  };
}

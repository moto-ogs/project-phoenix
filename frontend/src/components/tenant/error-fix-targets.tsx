"use client";

import { useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { useCallback, type ReactNode } from "react";

import {
  ErrorFixProvider,
  type ErrorFixTarget,
} from "~/components/ui/error-fix-slot";
import {
  hasEffectiveAdminScope,
  hasPermission,
  leadsSchool,
} from "~/lib/auth-utils";
import { ENROLLMENT_PRIVACY_NOTICE_SETTINGS_PATH } from "~/lib/enrollment-privacy-notice";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { useTenantAwarePath } from "~/lib/tenant-path";

interface FixTarget {
  /** School path; the provider makes it tenant-aware. */
  readonly path: string;
  readonly label: string;
  readonly tooltip: string;
  /** The viewer's right for the target; without it no link shows. */
  readonly permitted: (session: Session | null) => boolean;
}

/** Operational settings (`config:update`), like the enrollment form. */
const updatesSettings = holds("config:update");

/** A viewer who holds `permission` (or the admin scope). */
function holds(permission: string): (session: Session | null) => boolean {
  return (session) =>
    hasEffectiveAdminScope(session) || hasPermission(session, permission);
}

/** The grade question of the enrollment form, which both codes need. */
const GRADE_COLLECTION: FixTarget = {
  path: "/settings?tab=enrollment&highlight=enrollment.collect_grade_level",
  label: "Abfrage einschalten",
  tooltip: "Öffnet die Einstellungen bei der Abfrage der Klassenstufe.",
  permitted: updatesSettings,
};

/** The Regeltermine of the care plan; the error names the one meant. */
const TEMPLATES: FixTarget = {
  path: "/betreuungsplan?view=serien",
  label: "Zu den Regelterminen",
  tooltip: "Öffnet die Regeltermine im Betreuungsplan.",
  permitted: holds("schedules:manage"),
};

/**
 * Where the school fixes a refusal with a known code (#7092). One table, not
 * a link per page: every `LoadErrorAlert` and `FormErrorAlert` of the staff
 * portal shows the link. The catalog text names who acts, so a viewer
 * without the right still knows whom to ask.
 */
const ERROR_FIX_TARGETS: Partial<Record<ErrorCode, FixTarget>> = {
  // A school without a federal state knows no holidays (#7174).
  "calendar.federal_state_missing": {
    path: "/settings?tab=operations&highlight=operations.federal_state",
    label: "Bundesland eintragen",
    tooltip: "Öffnet die Einstellungen beim Bundesland deiner Schule.",
    permitted: leadsSchool,
  },
  "enrollment.form_grade_collection_required": GRADE_COLLECTION,
  "enrollment.phase_eligibility_setting_required": GRADE_COLLECTION,
  // The online enrollment needs a privacy notice first (#7176); only who
  // may write the legal texts (`config:manage`) gets the link.
  "settings.enrollment_privacy_notice_missing": {
    path: ENROLLMENT_PRIVACY_NOTICE_SETTINGS_PATH,
    label: "Zur Datenschutzinformation",
    tooltip: "Öffnet die Datenschutzinformation unter „Rechtstexte“.",
    permitted: holds("config:manage"),
  },
  "students.day_log_disabled": {
    path: "/settings?tab=gdpr&highlight=gdpr.attendance_log_enabled",
    label: "Protokoll einschalten",
    tooltip: "Öffnet die Einstellungen beim Anwesenheitsprotokoll.",
    permitted: leadsSchool,
  },
  // The payroll file needs the school's entries on the page Abrechnung.
  "workforce.payroll_config_incomplete": {
    path: "/payroll",
    label: "Abrechnung öffnen",
    tooltip: "Öffnet die Seite Abrechnung mit den fehlenden Angaben.",
    permitted: leadsSchool,
  },
  // A Regeltermin and its „Angebote als Quelle“ change only in the plan.
  "timetable.activity_template_protected": TEMPLATES,
  "enrollment.care_offering_template_mixed_phases": TEMPLATES,
  "enrollment.care_offering_template_no_active_source": TEMPLATES,
  "enrollment.care_offering_template_outside_period": TEMPLATES,
  "enrollment.care_offering_template_source_invalid": TEMPLATES,
};

/** Gives the kit's error alerts the link to where a refusal is fixed. */
export function ErrorFixTargetsProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { data: session } = useSession();
  const tenantPath = useTenantAwarePath();
  const resolve = useCallback(
    (code: string): ErrorFixTarget | null => {
      const target = ERROR_FIX_TARGETS[code as ErrorCode];
      if (!target?.permitted(session)) return null;
      return {
        href: tenantPath(target.path),
        label: target.label,
        tooltip: target.tooltip,
      };
    },
    [session, tenantPath],
  );
  return <ErrorFixProvider resolve={resolve}>{children}</ErrorFixProvider>;
}

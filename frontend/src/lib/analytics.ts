/**
 * Product analytics wrapper around PostHog.
 *
 * All custom event capture goes through trackEvent — never import
 * posthog.capture directly in components. Events must not contain
 * PII; student IDs are forbidden entirely (GDPR).
 */

import type { Properties } from "posthog-js";
import { analyticsDeployment } from "~/lib/analytics-deployment";
import type {
  AnalyticsRole,
  AnalyticsSurface,
  OnboardingChecklist,
  OnboardingChecklistStep,
  OnboardingSurface,
} from "~/lib/analytics-policy";
import type { DemoVisit } from "~/lib/demo-access";
import {
  capturePostHog,
  clearPostHogContext,
  resetAndCapturePostHog,
  setAnalyticsContext,
  setPostHogContext,
} from "~/lib/posthog-client";

export type AnalyticsEvent =
  | "login_failed"
  | "tenant_switched"
  | "pwa_install_prompt_shown"
  | "pwa_install_prompt_accepted"
  | "pwa_install_prompt_dismissed"
  | "pwa_installed"
  // Glocke im Staff-Portal (#7148): ohne Inhalte und ohne IDs, beim Klick
  // nur der Typ des Eintrags (notification_type, allowlisted).
  | "notification_bell_opened"
  | "notification_feed_entry_clicked"
  | "notification_feed_all_read"
  // Reiterwechsel auf „Alle Kinder“ (#5046): child_scope = all, groups oder
  // room, ohne Raum oder Gruppe.
  | "child_scope_tab_selected"
  // Selbstöffnende Flächen des Einstiegs (#7541), nur über
  // trackOnboardingSurface mit einer festen Fläche.
  | "onboarding_surface_shown"
  | "onboarding_surface_accepted"
  | "onboarding_surface_dismissed"
  // Checklisten mit Zustand nur im Browser (#7557), nur über
  // trackOnboardingChecklist mit festen Werten.
  | "onboarding_checklist_step_done"
  | "onboarding_checklist_dismissed"
  | "onboarding_checklist_completed";

function captureEvent(event: AnalyticsEvent, props?: Properties): void {
  capturePostHog(event, props);
}

export function trackEvent(
  event: AnalyticsEvent,
  props?: Record<string, string | number | boolean>,
): void {
  captureEvent(event, props);
}

/**
 * Eine selbstöffnende Fläche des Einstiegs (#7541) wurde angezeigt, von der
 * Person angenommen oder geschlossen. Nur die feste Fläche geht mit; das
 * Portal setzt der Filter als `surface` aus dem Kontext.
 */
export function trackOnboardingSurface(
  action: "shown" | "accepted" | "dismissed",
  surface: OnboardingSurface,
): void {
  captureEvent(`onboarding_surface_${action}`, {
    onboarding_surface: surface,
  });
}

/**
 * Eine Checkliste des Einstiegs, deren Zustand nur im Browser liegt (#7557):
 * ein Schritt erledigt, die Checkliste ausgeblendet oder abgeschlossen. Nur
 * die feste Checkliste und beim Schritt sein fester Schlüssel gehen mit.
 */
export function trackOnboardingChecklist(
  checklist: OnboardingChecklist,
  event:
    | { readonly action: "step_done"; readonly step: OnboardingChecklistStep }
    | { readonly action: "dismissed" | "completed" },
): void {
  captureEvent(`onboarding_checklist_${event.action}`, {
    checklist,
    ...(event.action === "step_done" ? { checklist_step: event.step } : {}),
  });
}

export function trackTenantEvent(
  event: AnalyticsEvent,
  schoolId: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (!/^\d+$/.test(schoolId)) return;

  const eventProperties = {
    ...props,
    deployment: analyticsDeployment(),
    school_id: schoolId,
  };

  // A completed tenant switch belongs to the target school and must not share
  // the previous school's anonymous runtime identity.
  if (event === "tenant_switched") {
    resetAndCapturePostHog(event, eventProperties);
    return;
  }

  captureEvent(event, eventProperties);
}

export interface PortalAnalyticsSession {
  readonly surface: AnalyticsSurface;
  /** The school of the session; null where the token has none (parents). */
  readonly schoolId: string | null;
  readonly role: AnalyticsRole;
  /**
   * The school's Analyse-Freigabe (#3603) with its recording share and the
   * pseudonymous ID of the account. The analytics policy honours them on the
   * OGS portal only; every other portal leaves them out.
   */
  readonly enabled?: boolean;
  readonly analyseFreigabe?: boolean;
  readonly recordingSamplePercent?: number;
  readonly person?: string | null;
}

/**
 * Registers the signed-in portal session as analytics context: the surface
 * for the filter, `school_id` and `role` for every later event. Page views,
 * clicks, and heatmaps come from the SDK itself. An account is named only by
 * its pseudonymous ID, and only on the OGS portal of a school with
 * Analyse-Freigabe.
 */
export function registerPortalSession(
  session: PortalAnalyticsSession,
  resetFirst: boolean,
): void {
  setAnalyticsContext(
    {
      enabled: session.enabled === true,
      surface: session.surface,
      role: session.role,
      analyseFreigabe: session.analyseFreigabe === true,
      recordingSamplePercent: session.recordingSamplePercent ?? 0,
      person: session.person ?? null,
    },
    {
      properties: {
        ...(session.schoolId && /^\d+$/.test(session.schoolId)
          ? { school_id: session.schoolId }
          : {}),
        role: session.role,
      },
      resetFirst,
    },
  );
}

/** Logout or school change: back to an anonymous visit of the host. */
export function clearPortalSession(): void {
  clearPostHogContext();
}

/**
 * The OGS portal's role property. Role names are school data (a school can
 * create its own roles), so only the admin flag reaches the analytics. The
 * read-only staff preview (#2893) is an admin at work, not the staff member.
 */
export function ogsAnalyticsRole(user: {
  readonly isAdmin?: boolean;
  readonly isPreview?: boolean;
}): AnalyticsRole {
  return user.isAdmin === true || user.isPreview === true ? "admin" : "staff";
}

export type DemoAnalyticsEvent =
  | "demo_entered"
  | "demo_role_switched"
  | "demo_restarted"
  | "demo_start_clicked";

// The visitor of the public demo is the demo access (#3467): its ID is the
// distinct_id, so the team can follow one visit without a name or address.
// An unknown visit (no storage) still counts, as the demo without identity.
function demoProperties(visit: DemoVisit | null): Properties {
  if (!visit) return { deployment: "demo" };
  return {
    ...(visit.accessId ? { distinct_id: visit.accessId } : {}),
    deployment: "demo",
    demo_role: visit.role,
    ...(visit.src ? { src: visit.src } : {}),
  };
}

/** Makes every later event of this page belong to the demo visit. */
export function registerDemoVisit(visit: DemoVisit): void {
  setPostHogContext(demoProperties(visit), false);
}

export function trackDemoEvent(
  event: DemoAnalyticsEvent,
  visit: DemoVisit | null,
): void {
  capturePostHog(event, demoProperties(visit));
}

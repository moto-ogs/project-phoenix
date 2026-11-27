#!/usr/bin/env node
// Dashboards of the usage analytics (Nutzungsanalyse, #3598 / #3604) in
// PostHog, created and updated through the PostHog EU API.
//
//   node scripts/posthog-dashboards.mjs            create or update everything
//   node scripts/posthog-dashboards.mjs --dry-run  show the plan, write nothing
//   node scripts/posthog-dashboards.mjs --check    run every insight query once
//
// .github/workflows/posthog-dashboards.yml runs the sync on every merge into
// development, and --check and --dry-run on pull requests; a local run uses
// only the two read-only modes. Needs POSTHOG_PERSONAL_API_KEY (a GitHub
// secret in CI, the local environment otherwise, never the repository),
// scoped to the project with query:read, insight:read/write, and
// dashboard:read/write. POSTHOG_PROJECT_ID picks the project when the key sees
// more than one. Only the EU API is ever called.
//
// Idempotent: dashboards and insights are found by their exact name and
// updated in place; a run changes nothing that is already current. A renamed
// definition creates a new object; delete the old one in PostHog by hand.
//
// Every insight filters on one deployment, production (`moto-app.de`) or the
// public demo (`demo`); staging and local development never count. No
// insight looks at a single person: the smallest unit is the role or the
// school (`posthog-dashboards.test.mjs` enforces both).
//
// Adding a dashboard or an insight: add it to `dashboards()` below, build its
// query with `hogql()`, `trends()`, or `funnel()` (they add the deployment
// filter), run the tests (`node --test scripts/posthog-dashboards.test.mjs`)
// and open a pull request. Details: .claude/rules/usage-analytics.md.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const POSTHOG_HOST = 'https://eu.posthog.com';

/** `deployment` values (analytics-policy.ts, backend/analytics/analytics.go). */
export const DEPLOYMENTS = Object.freeze({ production: 'moto-app.de', demo: 'demo' });

/** Portals of real schools; `public` covers login, start, and demo pages. */
const PORTALS = ['ogs', 'parents', 'school'];

/**
 * The caterer portal (ADR 0077). Its browser sends nothing (caterer accounts
 * are not asked for consent, PortalAnalyticsSession), and a caterer session
 * names no school: only its writes arrive, as core actions of the school in
 * their route (backend/analytics/core_actions.go).
 */
const CATERER = 'caterer';

/**
 * HogQL aggregation: distinct school and day. Confirming an order is
 * idempotent (a repeated confirmation answers 2xx again and is captured
 * again), so the caterer charts count days per school instead of events.
 */
const SCHOOL_DAYS = 'uniq(concat(toString(properties.school_id), toString(toDate(timestamp))))';

/** Core actions of a school's caterer link (Belieferung), from the OGS and the caterer portal. */
const CATERER_LINK_EVENTS = [
  ['caterer_invited', 'Caterer eingeladen'],
  ['caterer_invite_accepted', 'Einladung angenommen'],
  ['caterer_supply_ended', 'Belieferung beendet'],
];

const ROUTE_LISTS = {
  ogs: ['TRACKED_TENANT_ROUTE_TEMPLATES', 'TRACKED_TENANT_PUBLIC_ROUTE_TEMPLATES'],
  parents: ['TRACKED_PARENT_ROUTE_TEMPLATES'],
  school: ['TRACKED_SCHOOL_ROUTE_TEMPLATES'],
};

const repositoryRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

/**
 * The route templates of every portal, read from analytics-routes.ts, so the
 * page list also names pages nobody opened.
 */
export function readRouteTemplates(
  source = readFileSync(resolve(repositoryRoot, 'frontend/src/lib/analytics-routes.ts'), 'utf8'),
) {
  const routes = [];
  for (const [surface, lists] of Object.entries(ROUTE_LISTS)) {
    for (const list of lists) {
      const body = new RegExp(`export const ${list} = \\[([\\s\\S]*?)\\] as const;`).exec(source)?.[1];
      if (!body) throw new Error(`analytics-routes.ts has no list ${list}`);
      for (const [, template] of body.matchAll(/^\s*"([^"]+)",/gm)) {
        routes.push([surface, template]);
      }
    }
  }
  return routes;
}

/**
 * Events the browser sends itself (`CUSTOM_EVENTS` in analytics-policy.ts).
 * Every other event without `$` is a core action from the backend.
 */
export function readBrowserEvents(
  source = readFileSync(resolve(repositoryRoot, 'frontend/src/lib/analytics-policy.ts'), 'utf8'),
) {
  const body = /const CUSTOM_EVENTS[^=]*= new Set\(\[([\s\S]*?)\]\);/.exec(source)?.[1];
  const events = body ? [...body.matchAll(/^\s*"([a-z_]+)",/gm)].map(([, event]) => event) : [];
  if (events.length === 0) throw new Error('analytics-policy.ts has no CUSTOM_EVENTS');
  return events;
}

/** The values of a `const NAME = [...] as const` list in analytics-policy.ts. */
function readPolicyList(name, source) {
  const body = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(source)?.[1];
  const values = body ? [...body.matchAll(/^\s*"([a-z_]+)",/gm)].map(([, value]) => value) : [];
  if (values.length === 0) throw new Error(`analytics-policy.ts has no ${name}`);
  return values;
}

/** The allowed surfaces of the entry (ONBOARDING_SURFACES in analytics-policy.ts). */
export function readOnboardingSurfaces(
  source = readFileSync(resolve(repositoryRoot, 'frontend/src/lib/analytics-policy.ts'), 'utf8'),
) {
  return readPolicyList('ONBOARDING_SURFACES', source);
}

/** The allowed steps of the parents' first steps (ONBOARDING_CHECKLIST_STEPS in analytics-policy.ts). */
export function readOnboardingChecklistSteps(
  source = readFileSync(resolve(repositoryRoot, 'frontend/src/lib/analytics-policy.ts'), 'utf8'),
) {
  return readPolicyList('ONBOARDING_CHECKLIST_STEPS', source);
}

// --- query builders ----------------------------------------------------------

const sqlString = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const sqlList = (values) => `(${values.map(sqlString).join(', ')})`;

/** Easter Sunday of a year (Gregorian, anonymous algorithm), as UTC date. */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - Math.floor(b / 4) - g + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** First and last year whose public holidays the school charts leave out. */
const HOLIDAY_YEARS = [2026, 2035];

/**
 * Statutory public holidays of North Rhine-Westphalia (YYYY-MM-DD), the state
 * of every moto school (the backend's DE-NW calendar). School holidays and
 * closing days are per school and unknown to PostHog.
 */
export function publicHolidays([from, to] = HOLIDAY_YEARS) {
  const dates = [];
  for (let year = from; year <= to; year++) {
    const easter = easterSunday(year);
    const fromEaster = (days) => new Date(easter.getTime() + days * 86_400_000);
    const fixed = (month, day) => new Date(Date.UTC(year, month - 1, day));
    dates.push(
      fixed(1, 1), fromEaster(-2), fromEaster(1), fixed(5, 1), fromEaster(39), fromEaster(50), fromEaster(60),
      fixed(10, 3), fixed(11, 1), fixed(12, 25), fixed(12, 26),
    );
  }
  return dates.map((date) => date.toISOString().slice(0, 10)).sort();
}

/**
 * HogQL condition: the event fell on a school day, Monday to Friday and no
 * public holiday (project time zone Europe/Berlin). The OGS is closed on the
 * other days, so every school chart leaves them out.
 */
export const ON_WORKDAY = `toDayOfWeek(toDate(timestamp)) <= 5 and toString(toDate(timestamp)) not in ${sqlList(publicHolidays())}`;

/** Note on every dashboard with school data. */
const WORKDAYS_NOTE = 'Gezählt werden nur Werktage: Montag bis Freitag ohne gesetzliche Feiertage in NRW.';

/**
 * Production counts school days only (ON_WORKDAY): the OGS is closed on the
 * other days. `everyDay` lifts that for an outside party that also works on
 * weekends (the caterer); the demo is open every day.
 */
const workdaysOnly = (deployment, everyDay) => deployment === 'production' && !everyDay;

/** HogQL condition on the deployment; every HogQL insight uses it. */
const onDeployment = (deployment, everyDay = false) => workdaysOnly(deployment, everyDay)
  ? `properties.deployment = ${sqlString(DEPLOYMENTS[deployment])} and ${ON_WORKDAY}`
  : `properties.deployment = ${sqlString(DEPLOYMENTS[deployment])}`;

function deploymentOf(deployment) {
  if (!Object.hasOwn(DEPLOYMENTS, deployment)) throw new Error(`unknown deployment ${deployment}`);
  return deployment;
}

/**
 * A HogQL table (or number). `sql` receives the deployment condition and
 * must use it in every `from events`.
 */
function hogql(deployment, sql, display = 'ActionsTable', chartSettings, { everyDay = false } = {}) {
  const query = sql(onDeployment(deploymentOf(deployment), everyDay)).trim();
  return {
    deployment,
    ...(everyDay ? { everyDay } : {}),
    query: {
      kind: 'DataVisualizationNode',
      source: { kind: 'HogQLQuery', query },
      display,
      ...(chartSettings ? { chartSettings } : {}),
    },
  };
}

function deploymentFilter(deployment, everyDay = false) {
  return {
    type: 'AND',
    values: [{
      type: 'AND',
      values: [{ key: 'deployment', type: 'event', operator: 'exact', value: [DEPLOYMENTS[deploymentOf(deployment)]] }],
    }, ...(workdaysOnly(deployment, everyDay) ? [{ type: 'AND', values: [{ key: ON_WORKDAY, type: 'hogql' }] }] : [])],
  };
}

const series = (event, name, extra = {}) => ({
  kind: 'EventsNode', event, name: event ?? 'All events', custom_name: name, math: 'total', ...extra,
});

/**
 * HogQL expression: the name of the event's school. The backend publishes
 * every school as a group of type `school` (index 0) with the key
 * `<deployment>:<school_id>` and the property `name`; a school without one
 * reads „Schule 6“.
 */
export function schoolLabel(deployment) {
  const prefix = `${DEPLOYMENTS[deploymentOf(deployment)]}:`;
  const groups = `from groups where index = 0 and startsWith(key, ${sqlString(prefix)}) and notEmpty(toString(properties.name))`;
  return `transform(toString(properties.school_id), (select groupArray(replaceOne(key, ${sqlString(prefix)}, '')) ${groups}), (select groupArray(toString(properties.name)) ${groups}), concat('Schule ', toString(properties.school_id)))`;
}

/** Breakdown by school name (`schoolLabel`) for charts of real schools. */
export const SCHOOL_BREAKDOWN = schoolLabel('production');

function trends(deployment, { series: steps, interval = 'week', dateFrom = '-90d', breakdown, breakdownType = 'event', display = 'ActionsLineGraph', compare = false, everyDay = false }) {
  return {
    deployment,
    ...(everyDay ? { everyDay } : {}),
    query: {
      kind: 'InsightVizNode',
      source: {
        kind: 'TrendsQuery',
        series: steps,
        interval,
        dateRange: { date_from: dateFrom },
        properties: deploymentFilter(deployment, everyDay),
        filterTestAccounts: false,
        ...(breakdown ? { breakdownFilter: { breakdown, breakdown_type: breakdownType } } : {}),
        ...(compare ? { compareFilter: { compare: true } } : {}),
        trendsFilter: { display },
      },
    },
  };
}

function funnel(deployment, { series: steps, dateFrom = '-30d', windowDays = 14 }) {
  return {
    deployment,
    query: {
      kind: 'InsightVizNode',
      source: {
        kind: 'FunnelsQuery',
        series: steps,
        dateRange: { date_from: dateFrom },
        properties: deploymentFilter(deployment),
        filterTestAccounts: false,
        funnelsFilter: { funnelVizType: 'steps', funnelWindowInterval: windowDays, funnelWindowIntervalUnit: 'day' },
      },
    },
  };
}

/** Heatmap of a route template (PostHog's own link format, `urls.heatmapNew`). */
function heatmapLink(projectId, deployment, pathExpression) {
  const url = `concat(${sqlString(`https://${DEPLOYMENTS[deployment]}`)}, ${pathExpression})`;
  return `concat(${sqlString(`${POSTHOG_HOST}/project/${projectId}/heatmaps/new?pageURL=`)}, encodeURLComponent(${url}), '&dataURL=', encodeURLComponent(${url}))`;
}

// --- feature areas -----------------------------------------------------------

/**
 * Feature areas (Funktionsbereiche): which pages and which events belong to
 * one thing a school does with moto. A page ending in `/**` covers itself and
 * every page below it. The first matching area wins; the test makes sure
 * every route template of analytics-routes.ts lands in exactly one area or in
 * NO_FEATURE_PAGES, so a new page needs a decision here.
 */
export const FEATURES = Object.freeze([
  { name: 'Ein- und Auschecken', events: ['student_checked_in', 'student_checked_out'] },
  { name: 'Startseite', pages: { ogs: ['/home', '/dashboard'], parents: ['/'], school: ['/'] } },
  {
    name: 'Kinder und Kindakte',
    pages: { ogs: ['/students/**'], parents: ['/children/**'], school: ['/klasse', '/klasse/kind'] },
    events: ['student_note_created', 'photo_consent_changed', 'room_history_stop_changed', 'day_hint_changed', 'accident_report_recorded', 'accident_report_signed'],
  },
  { name: 'Gruppen', pages: { ogs: ['/ogs-groups', '/ogs-groups/overview'] }, events: ['group_created', 'group_updated'] },
  {
    name: 'Aufsichten und Räume',
    pages: { ogs: ['/active-supervisions', '/rooms/**', '/activities'], school: ['/aufsichten'] },
    events: ['supervision_started', 'supervision_completed', 'supervision_attendance_recorded', 'room_closed', 'room_reopened'],
  },
  {
    name: 'Abwesenheiten',
    pages: { ogs: ['/absences'], school: ['/fehlzeiten'] },
    events: ['absence_reported', 'absence_request_submitted', 'arrival_exception_changed', 'class_trip_reported'],
  },
  {
    name: 'Elternanfragen',
    pages: { ogs: ['/anfragen', '/admin/change-requests', '/admin/guardian-approvals'] },
    events: ['pickup_change_requested', 'pickup_change_decided', 'offering_change_requested', 'offering_change_decided', 'master_data_change_submitted'],
  },
  {
    name: 'Nachrichten und Elternbriefe',
    pages: {
      ogs: ['/messages/**', '/parent-attention/:studentId', '/team-chat/**', '/parent-announcements/**', '/umfragen/**'],
      parents: ['/messages/**', '/news/**'],
      school: ['/nachrichten/**', '/elternbriefe/**'],
    },
    events: [
      'parent_message_sent', 'staff_message_sent', 'parent_message_marked_unread', 'parent_message_confirmed_for_team', 'parent_messages_marked_all_read',
      'parent_message_count_scope_changed', 'parent_declaration_submitted', 'staff_notice_acknowledged',
      'class_parent_letter_sent', 'staff_group_created',
    ],
  },
  {
    name: 'Tagesplan und Tagesinfos',
    pages: { ogs: ['/tagesplan', '/tagesinformationen', '/day-log', '/betreuungsplan', '/planung', '/timetables', '/wochenprotokolle', '/wochenprotokolle/:protocolId'], school: ['/tagesinformationen'] },
  },
  {
    name: 'Kalender und Speiseplan',
    pages: { ogs: ['/calendar', '/calendar-periods', '/meal-plan', '/meal-plan/freigabe'], parents: ['/calendar', '/meal-plan'], school: ['/kalender', '/elternsprechtag'] },
  },
  {
    name: 'Personal und Dienstplan',
    pages: { ogs: ['/staff/**', '/dienstplan', '/dienstplan/springer', '/mein-dienstplan', '/payroll', '/invitations'] },
    events: ['staff_invited', 'user_invited', 'springer_blocked'],
  },
  { name: 'Zeiterfassung', pages: { ogs: ['/time-tracking'] } },
  { name: 'Vertretung', pages: { ogs: ['/substitutions', '/vertretung', '/vertretungsplan'] }, events: ['substitution_assigned', 'substitution_ended'] },
  {
    name: 'Anmeldung neuer Kinder',
    pages: {
      ogs: ['/admin/enrollments/**', '/enrollment-form', '/enrollment-phases/**', '/care-offerings', '/anmeldung/**', '/ferienwochen', '/ferienwochen/**'],
      parents: ['/anmeldung/**', '/ferienanmeldung/**', '/ferienanmeldungen'],
    },
    events: ['enrollment_submitted'],
  },
  // The school's own link actions; its caterer page is part of /meal-plan. What
  // the caterer itself saves is no use by the school (NO_FEATURE_EVENTS).
  { name: 'Caterer-Anbindung', events: ['caterer_invited', 'caterer_supply_ended'] },
  { name: 'Stammdaten und Export', pages: { ogs: ['/database/**', '/eltern/bankverbindungen'] }, events: ['data_exported'] },
  { name: 'Einstellungen', pages: { ogs: ['/settings', '/profile'], parents: ['/settings'], school: ['/einstellungen'] }, events: ['settings_changed'] },
  { name: 'Weitere Werkzeuge', pages: { ogs: ['/lists', '/reminders', '/emergency', '/info-displays', '/dateien', '/statistics'], parents: ['/documents', '/documents/**', '/vertrag-unterschreiben/**'] } },
]);

/** Login, invitation, and demo entry pages: getting in, not using a feature. */
export const NO_FEATURE_PAGES = Object.freeze({
  ogs: ['/', '/demo', '/display', '/invite', '/reset-password', '/traeger-uebergabe'],
  parents: ['/login', '/invite', '/reset-password', '/demo', '/accept-guardian-invite/:token', '/ferienanmeldung/:token', '/ferienkonto/:token'],
  school: ['/login', '/invite', '/reset-password'],
});

/** Backend events of the announcement (#7555): seen, closed (core_actions.go). */
const ANNOUNCEMENT_EVENTS = ['announcement_seen', 'announcement_dismissed'];

/** Server events of the care worker's first steps (#7553, core_actions.go). */
export const STAFF_FIRST_STEPS_EVENTS = Object.freeze(['staff_first_step_changed', 'staff_first_steps_completed', 'staff_first_steps_dismissed']);

/**
 * German names of the first steps' steps, one per STAFF_ONBOARDING_STEP_KEYS
 * in staff-onboarding-api.ts (the test compares both), as the checklist
 * titles them.
 */
export const STAFF_FIRST_STEP_LABELS = Object.freeze({
  groups: 'Meine Gruppe ansehen',
  students: 'Ein Kind finden und Angaben ansehen',
  attendance: 'Ein Kind an- und abmelden',
  calendar: 'Meine Termine ansehen',
  supervision: 'Eine Aufsicht starten',
  work_time: 'Arbeitszeit erfassen',
});

/**
 * Events that are no feature use: sessions, devices, the demo funnel, and
 * what the school's caterer saves (an outside party; the caterer dashboard
 * counts it).
 */
const NO_FEATURE_EVENTS = [
  'login_success', 'login_failed', 'tenant_switched', 'guardian_invite_accepted', 'page_viewed',
  // The install hint and its browser dialog: getting in, not using a feature.
  'pwa_installed', 'pwa_install_prompt_shown', 'pwa_install_prompt_accepted', 'pwa_install_prompt_dismissed',
  // The care worker's first steps (#7553): getting in, not using a feature.
  ...STAFF_FIRST_STEPS_EVENTS,
  'caterer_invite_accepted', 'meal_order_confirmed',
  // The announcement of the entry (#7555): backend events of its routes.
  ...ANNOUNCEMENT_EVENTS,
  // Clicks inside a page the browser reports (tab, bell): the page view
  // already counts the feature, a click is no action of its own.
  'child_scope_tab_selected', 'notification_bell_opened', 'notification_feed_entry_clicked', 'notification_feed_all_read',
  // „Heute anders“ on the start page (#7659): clicks inside the page.
  'day_changes_entry_clicked', 'day_changes_show_all', 'day_changes_done_expanded',
];

/**
 * German names of the self-opening surfaces of the entry (#7541), one per
 * value of ONBOARDING_SURFACES in analytics-policy.ts (the test compares both).
 */
export const ONBOARDING_SURFACE_LABELS = Object.freeze({
  announcement: 'Ankündigung',
  setup_checklist: 'Einrichtungs-Checkliste',
  staff_first_steps: 'Erste Schritte der Betreuung',
  parent_first_steps: 'Erste Schritte der Eltern',
  notification_setup: 'Benachrichtigungs-Einrichtung',
  install_hint: 'Installations-Hinweis',
  samsung_hint: 'Samsung-Hinweis',
});

/**
 * German names of the steps of the parents' first steps (#7557), one per value
 * of ONBOARDING_CHECKLIST_STEPS in analytics-policy.ts (the test compares both).
 * `messages_news` is „Nachrichten finden“ where the school sends no letters.
 */
export const PARENT_FIRST_STEP_LABELS = Object.freeze({
  start: 'Startseite kennenlernen',
  child_data: 'Angaben zum Kind ändern',
  messages_news: 'Nachrichten und Elternbriefe finden',
  install_app: 'moto als App hinzufügen',
  notifications: 'Benachrichtigungen einschalten',
});

/** Area unmatched pages and events fall into; growing means FEATURES lacks an entry. */
const OTHER_FEATURE = 'Sonstiges';

/** Demo roles a visitor picks; transient pages before the pick carry none. */
const DEMO_ROLES = ['caregiver', 'lead', 'parent', 'all'];

const matchesPage = (pattern, template) => pattern.endsWith('/**')
  ? template === pattern.slice(0, -3) || template.startsWith(pattern.slice(0, -2))
  : template === pattern;

const matchesPages = (pages, surface, template) => (pages?.[surface] ?? []).some((pattern) => matchesPage(pattern, template));

/** The feature area of a page, `null` for NO_FEATURE_PAGES, OTHER_FEATURE if unmapped. */
export function featureOfPage(surface, template) {
  if (matchesPages(NO_FEATURE_PAGES, surface, template)) return null;
  return FEATURES.find((feature) => matchesPages(feature.pages, surface, template))?.name ?? OTHER_FEATURE;
}

function pagesCondition(pages) {
  const bySurface = Object.entries(pages).map(([surface, patterns]) => {
    const exact = patterns.map((pattern) => pattern.replace(/\/\*\*$/, ''));
    const prefixes = patterns.filter((pattern) => pattern.endsWith('/**')).map((pattern) => pattern.slice(0, -2));
    const path = [`properties.$pathname in ${sqlList(exact)}`, ...prefixes.map((prefix) => `startsWith(properties.$pathname, ${sqlString(prefix)})`)];
    return `(properties.surface = ${sqlString(surface)} and (${path.join(' or ')}))`;
  });
  return `event = '$pageview' and (${bySurface.join(' or ')})`;
}

/**
 * HogQL expression: the feature area of an event, '' for anything that is no
 * feature use (other `$` events, logins, the demo funnel's own events).
 */
export function featureExpression() {
  const branches = [[pagesCondition(NO_FEATURE_PAGES), "''"]];
  for (const feature of FEATURES) {
    const conditions = [];
    if (feature.pages) conditions.push(pagesCondition(feature.pages));
    if (feature.events) conditions.push(`event in ${sqlList(feature.events)}`);
    branches.push([conditions.map((condition) => `(${condition})`).join(' or '), sqlString(feature.name)]);
  }
  branches.push([
    // `onboarding_`: the entry's self-opening surfaces (#7541), no feature use.
    `event = '$pageview' or not (startsWith(event, '$') or startsWith(event, 'demo_') or startsWith(event, 'onboarding_') or event in ${sqlList(NO_FEATURE_EVENTS)})`,
    sqlString(OTHER_FEATURE),
  ]);
  return `multiIf(${branches.map(([condition, value]) => `${condition}, ${value}`).join(', ')}, '')`;
}

const quoted = (name) => `\`${name}\``;

/** Browser events of the entry's self-opening surfaces (analytics-policy.ts). */
const ONBOARDING_SURFACE_EVENTS = ['onboarding_surface_shown', 'onboarding_surface_accepted', 'onboarding_surface_dismissed'];

/** Browser events of the parents' first steps (analytics-policy.ts, #7557). */
const PARENT_CHECKLIST_EVENTS = ['onboarding_checklist_step_done', 'onboarding_checklist_dismissed', 'onboarding_checklist_completed'];

/** HogQL: the German name of an event's surface; an unknown value shows as itself. */
const sqlArray = (values) => `[${values.map(sqlString).join(', ')}]`;
const staffStepLabel = `transform(toString(properties.step), ${sqlArray(Object.keys(STAFF_FIRST_STEP_LABELS))}, ${sqlArray(Object.values(STAFF_FIRST_STEP_LABELS))}, toString(properties.step))`;
const parentStepLabel = `transform(toString(properties.checklist_step), ${sqlArray(Object.keys(PARENT_FIRST_STEP_LABELS))}, ${sqlArray(Object.values(PARENT_FIRST_STEP_LABELS))}, toString(properties.checklist_step))`;
const surfaceLabel = `transform(toString(properties.onboarding_surface), ${sqlArray(Object.keys(ONBOARDING_SURFACE_LABELS))}, ${sqlArray(Object.values(ONBOARDING_SURFACE_LABELS))}, toString(properties.onboarding_surface))`;

/**
 * Core actions of the leadership's setup checklist (#7554), sent by the
 * server for every school that allows the usage analytics, with or without
 * the person's consent. A done step has no event: the server derives it.
 */
const SETUP_CHECKLIST_EVENTS = {
  completed: 'onboarding_setup_checklist_completed',
  dismissed: 'onboarding_setup_checklist_dismissed',
  stepSkipped: 'onboarding_setup_checklist_step_skipped',
};

/**
 * German names of the setup checklist's steps (schoolsetup.StepKeys), short
 * forms of the checklist's titles (a query naming a person fails the guard).
 */
export const SETUP_CHECKLIST_STEP_LABELS = Object.freeze({
  team: 'Team einladen',
  rooms: 'Raum anlegen',
  groups: 'Gruppe anlegen',
  students: 'Kind anlegen',
  guardians: 'Eltern einladen',
  worktime: 'Arbeitszeitmodelle eintragen',
});
const setupStepLabel = `transform(toString(properties.step), ${sqlArray(Object.keys(SETUP_CHECKLIST_STEP_LABELS))}, ${sqlArray(Object.values(SETUP_CHECKLIST_STEP_LABELS))}, toString(properties.step))`;

/** HogQL: the product name of a school portal (`surface`). */
const portalLabel = (surface) => `multiIf(${surface} = 'ogs', 'OGS-App', ${surface} = 'school', 'Schul-App', ${surface} = 'parents', 'Eltern-App', 'unbekannt')`;

// --- definitions -------------------------------------------------------------

const portalCondition = `properties.surface in ${sqlList(PORTALS)}`;

/**
 * HogQL condition: the event comes from the school's own people or devices.
 * The school's caterer carries its school_id as well (an order confirmed for
 * it), but is an outside party: its actions count on the caterer dashboard,
 * never as the school using moto.
 */
const NOT_CATERER = `coalesce(properties.surface, '') != ${sqlString(CATERER)}`;

/** HogQL condition: an event of the school itself (NOT_CATERER). */
const SCHOOL_EVENT = `isNotNull(properties.school_id) and ${NOT_CATERER}`;

/**
 * HogQL condition: the event shows that a school worked with moto. Page
 * views, core actions, and kiosk bookings count; other `$` events (dead
 * clicks, page leaves), the caterer's actions, and a failed login do not.
 */
const ACTIVE_USE = `(event = '$pageview' or not startsWith(event, '$')) and ${NOT_CATERER} and event != 'login_failed'`;

/** Host every heatmap URL of a deployment starts with (`analyticsHost`). */
const heatmapOrigin = (deployment) => `https://${DEPLOYMENTS[deploymentOf(deployment)]}`;

/**
 * Navigation names of the OGS portal's pages, read from section-navigation.ts
 * so the page tables say „Alle Kinder“ instead of `/students/search`.
 */
export function readPageNames(
  source = readFileSync(resolve(repositoryRoot, 'frontend/src/lib/section-navigation.ts'), 'utf8'),
) {
  const names = new Map();
  for (const [, href, label] of source.matchAll(/href: "([^"]+)",\s*label: "([^"]+)"/g)) {
    if (!names.has(href)) names.set(href, label);
  }
  if (names.size === 0) throw new Error('section-navigation.ts has no href/label pairs');
  for (const [href, label] of OGS_EXTRA_PAGE_NAMES) if (!names.has(href)) names.set(href, label);
  return names;
}

/**
 * OGS pages the navigation file does not name as `href`/`label` pair: detail
 * pages, pages with a computed label, and the login.
 */
const OGS_EXTRA_PAGE_NAMES = new Map([
  ['/', 'Anmeldung'], ['/students/:id', 'Kindakte'], ['/ogs-groups', 'Gruppen'],
  ['/active-supervisions', 'Aktuelle Aufsicht'], ['/messages/:threadId', 'Nachrichtenverlauf'],
]);

/** Names of the parents portal's main pages; the portal has no navigation file of that shape. */
const PARENT_PAGE_NAMES = new Map([
  ['/', 'Start'], ['/login', 'Anmeldung'], ['/children', 'Kinder'], ['/children/:id', 'Kind (Details)'],
  ['/messages', 'Nachrichten'], ['/messages/:studentId', 'Nachrichtenverlauf'], ['/calendar', 'Kalender'],
  ['/meal-plan', 'Speiseplan'], ['/news', 'Neuigkeiten'], ['/settings', 'Einstellungen'],
]);

/** Names of the school portal's pages (Schul-App for teachers). */
const SCHOOL_PAGE_NAMES = new Map([
  ['/', 'Start'], ['/login', 'Anmeldung'], ['/klasse', 'Klasse'], ['/aufsichten', 'Aufsichten'],
  ['/tagesinformationen', 'Tagesinformationen'], ['/kalender', 'Kalender'], ['/einstellungen', 'Einstellungen'],
  ['/fehlzeiten', 'Fehlzeiten'],
]);

/** HogQL expression: the page's name, '' when it has none. */
function pageName(names, column) {
  const entries = [...names];
  return `transform(${column}, ${`[${entries.map(([href]) => sqlString(href)).join(', ')}]`}, ${`[${entries.map(([, label]) => sqlString(label)).join(', ')}]`}, '')`;
}

/**
 * Pages of one portal ranked by use per day with use: views per day, schools,
 * sessions, and the median time on the page (`$prev_pageview_duration`, sent
 * with the next page view or the page leave). Days without any use in the portal (weekends,
 * holidays, school holidays with no one at work) do not dilute the average.
 */
function pagesPerDay(deployment, surface, names, days = 30) {
  const schools = surface === 'parents' ? '' : `\n  p.Schulen as Schulen,`;
  return hogql(deployment, (where) => `
select
  p.Seite as Seite,
  ${pageName(names, 'p.Seite')} as Name,
  p.Bereich as Bereich,
  round(p.Aufrufe / greatest(t.Tage, 1), 1) as ${quoted('Aufrufe pro Tag')},${schools}
  p.Sitzungen as Sitzungen,
  d.Sekunden as ${quoted('Verweildauer (Median, s)')}
from (
  select properties.$pathname as Seite, any(${featureExpression()}) as Bereich, count() as Aufrufe,
    uniq(toString(properties.school_id)) as Schulen, uniq(properties.$session_id) as Sitzungen
  from events
  where ${where} and event = '$pageview' and properties.surface = ${sqlString(surface)}
    and timestamp > now() - interval ${days} day
  group by Seite
) as p
cross join (
  select uniq(toDate(timestamp)) as Tage
  from events
  where ${where} and event = '$pageview' and properties.surface = ${sqlString(surface)}
    and timestamp > now() - interval ${days} day
) as t
left join (
  select properties.$prev_pageview_pathname as Seite, round(median(toFloat(properties.$prev_pageview_duration))) as Sekunden
  from events
  where ${where} and event in ('$pageview', '$pageleave') and properties.surface = ${sqlString(surface)}
    and isNotNull(properties.$prev_pageview_duration) and timestamp > now() - interval ${days} day
  group by Seite
) as d on p.Seite = d.Seite
order by p.Aufrufe desc
limit 25`);
}

/** Every route template of one portal, least used first; 0 means never opened. */
function rarePages(deployment, surface, routes, days = 30) {
  const rows = routes.filter(([s]) => s === surface).map(([, template]) => sqlString(template)).join(', ');
  return hogql(deployment, (where) => `
select Seite, coalesce(Aufrufe, 0) as Aufrufe, coalesce(Schulen, 0) as Schulen
from (select arrayJoin([${rows}]) as Seite) as pages
left join (
  select properties.$pathname as path, count() as Aufrufe, uniq(toString(properties.school_id)) as Schulen
  from events
  where ${where} and event = '$pageview' and properties.surface = ${sqlString(surface)}
    and timestamp > now() - interval ${days} day
  group by path
) as seen on pages.Seite = seen.path
order by Aufrufe asc, Seite
limit 300`);
}

/** Successful writes of one portal by role and action; logins and other non-feature events stay out. */
function actionsByRole(deployment, surface, coreAction, days = 30) {
  return hogql(deployment, (where) => `
select
  coalesce(properties.role, 'ohne Anmeldung') as Rolle,
  ${featureExpression()} as Bereich,
  event as Aktion,
  count() as Anzahl${surface === 'parents' ? '' : ',\n  uniq(toString(properties.school_id)) as Schulen'}
from events
where ${where}
  and properties.surface = ${sqlString(surface)}
  and ${coreAction}
  and timestamp > now() - interval ${days} day
group by Rolle, Bereich, Aktion
having Bereich != ''
order by Anzahl desc
limit 100`);
}

/**
 * Where users go from one page: the next page view's page, counted from
 * `$prev_pageview_pathname` on that view. Counts page changes, never people
 * or sessions.
 */
function nextPages(deployment, surface, fromPage, names, days = 30) {
  return hogql(deployment, (where) => `
select
  properties.$pathname as ${quoted('Nächste Seite')},
  ${pageName(names, 'properties.$pathname')} as Name,
  count() as Wechsel,
  round(100 * count() / sum(count()) over (), 1) as ${quoted('Anteil in Prozent')}
from events
where ${where}
  and event = '$pageview'
  and properties.surface = ${sqlString(surface)}
  and properties.$prev_pageview_pathname = ${sqlString(fromPage)}
  and properties.$pathname != ${sqlString(fromPage)}
  and timestamp > now() - interval ${days} day
group by ${quoted('Nächste Seite')}, Name
order by Wechsel desc
limit 15`);
}

/**
 * Dead clicks (events) and rage clicks (PostHog's heatmap data; autocapture
 * is off in the project, so there is no `$rageclick` event) per page of the
 * given portals, with the heatmap link. The heatmap rows carry no surface,
 * so they are matched to the portal through their browser session: a session
 * belongs to a portal once it opened one of its pages. Reading only page
 * views keeps that lookup cheap; across all events of the parents portal it
 * hit PostHog's execution time limit. The heatmap behind the link is per
 * route template and mixes portals that share one (`/`, `/messages`).
 */
function frictionTable(projectId, deployment, surfaces, days = 30) {
  const origin = heatmapOrigin(deployment);
  return hogql(deployment, (where) => `
select
  e.Seite as Seite,
  e.Aufrufe as Aufrufe,
  e.Dead as ${quoted('Dead Clicks')},
  coalesce(r.Rage, 0) as ${quoted('Rage Clicks')},
  round(100 * (e.Dead + coalesce(r.Rage, 0)) / greatest(e.Aufrufe, 1), 1) as ${quoted('Reibung je 100 Aufrufe')},
  ${heatmapLink(projectId, deployment, 'e.Seite')} as Heatmap
from (
  select properties.$pathname as Seite, countIf(event = '$pageview') as Aufrufe, countIf(event = '$dead_click') as Dead
  from events
  where event in ('$pageview', '$dead_click')
    and timestamp > now() - interval ${days} day
    and ${where}
    and properties.surface in ${sqlList(surfaces)}
  group by Seite
) as e
left join (
  select replaceOne(current_url, ${sqlString(origin)}, '') as Seite, count() as Rage
  from heatmaps
  where type = 'rageclick'
    and timestamp > now() - interval ${days} day
    and startsWith(current_url, ${sqlString(`${origin}/`)})${deployment === 'production' ? ` and ${ON_WORKDAY}` : ''}
    and session_id in (
      select $session_id from events
      where event = '$pageview' and timestamp > now() - interval ${days} day
        and ${where} and properties.surface in ${sqlList(surfaces)}
    )
  group by Seite
) as r on e.Seite = r.Seite
where e.Dead + coalesce(r.Rage, 0) > 0
order by e.Dead + coalesce(r.Rage, 0) desc
limit 30`);
}

/** Page views of one portal per week. */
function viewsPerWeek(deployment, surface, name) {
  return trends(deployment, {
    series: [series('$pageview', name, {
      properties: [{ key: 'surface', type: 'event', operator: 'exact', value: [surface] }],
    })],
    dateFrom: '-180d',
  });
}

/**
 * The dashboards: one per product surface (OGS-App, Eltern-App, Schul-App, Caterer-Portal, Demo),
 * two across schools (Nutzung je Standort, Schule im Verlauf), and the entry
 * (Einstieg, #7541). `projectId`
 * feeds the heatmap links.
 */
export function dashboards({ projectId, routes = readRouteTemplates(), browserEvents = readBrowserEvents(), pageNames = readPageNames() }) {
  const coreAction = `not startsWith(event, '$') and event not in ${sqlList(browserEvents)}`;
  const feature = featureExpression();

  return [
    {
      name: 'Nutzungsanalyse: Nutzung je Standort',
      description: `Start hier. Wie viele Schulen moto nutzen, an welchen Tagen und wofür, je Schule (Schul-ID und Name), in echten Schulen (deployment = moto-app.de). Als aktiv zählen Seitenaufrufe, Kernaktionen und Kiosk-Buchungen, nicht aber, was der Caterer der Schule speichert. ${WORKDAYS_NOTE} Ferien und Schließtage kennt PostHog nicht, sie sind nicht abgezogen. Ein- und Auschecken wird erst seit dem 25.09.2026 erfasst. Das Elternportal kennt keine Schule und fehlt hier; es hat ein eigenes Dashboard.`,
      insights: [
        {
          name: 'Aktive Schulen pro Woche',
          ...trends('production', {
            series: [series(null, 'Aktive Schulen', {
              math: 'hogql',
              math_hogql: "uniqIf(toString(properties.school_id), isNotNull(properties.school_id))",
              properties: [{ key: ACTIVE_USE, type: 'hogql' }],
            })],
            dateFrom: '-180d',
            display: 'ActionsBar',
          }),
        },
        {
          name: 'Standorte: mit Anwesenheit in den letzten 7 Tagen',
          description: 'Schulen mit mindestens einer Ein- oder Auscheck-Buchung.',
          ...hogql('production', (where) => `
select uniqIf(Schule, Anwesenheit) as Standorte
from (${schoolDays(where, 7)})`, 'BoldNumber'),
        },
        {
          name: 'Standorte: mit Nutzung in den letzten 7 Tagen',
          description: 'Schulen mit mindestens einem Ereignis: Seitenaufruf, Kernaktion oder Kiosk.',
          ...hogql('production', (where) => `
select uniqIf(Schule, Nutzung) as Standorte
from (${schoolDays(where, 7)})`, 'BoldNumber'),
        },
        {
          name: 'Standorte: Ein- und Auscheck-Buchungen in den letzten 7 Tagen',
          description: 'Alle Schulen zusammen. Buchungen sind keine Kinder: ein Kind kann mehrmals am Tag buchen.',
          ...hogql('production', (where) => `
select countIf(Anwesenheit) as Buchungen
from (${schoolDays(where, 7)})`, 'BoldNumber'),
        },
        {
          name: 'Standorte: Anwesenheitsquote (60 Tage)',
          description: 'Anteil der Werktage (Montag bis Freitag ohne Feiertage) mit Ein- oder Auscheck-Buchung, gezählt ab der ersten Buchung bis gestern. Ferien und Schließtage sind nicht abgezogen, eine Quote unter 100 % kann also Ferien sein. Schulen ohne Buchung fehlen.',
          ...hogql('production', (where) => `
select Standort, round(Mit / greatest(Seit, 1), 2) as Anwesenheitsquote
from (
  select
    any(Standort) as Standort,
    uniqIf(Tag, Anwesenheit and Tag < today()) as Mit,
    ${workdaysSinceFirstAttendance} as Seit
  from (${schoolDays(where, 60)})
  group by Schule
  having countIf(Anwesenheit) > 0
)
order by Anwesenheitsquote desc, Standort`, 'ActionsBarValue', {
            xAxis: { column: 'Standort' },
            yAxis: [{ column: 'Anwesenheitsquote', settings: { formatting: { style: 'percent', decimalPlaces: 0 } } }],
          }),
        },
        {
          name: 'Standorte: Anwesenheit pro Tag',
          description: 'Ein- und Auscheck-Buchungen je Schule und Tag, letzte 60 Tage. Je dunkler, desto mehr Buchungen; Wochenenden und Feiertage bleiben immer leer, weitere leere Felder sind Tage ohne Anwesenheit (Ferien, Pause). Erfasst seit dem 25.09.2026.',
          ...trends('production', {
            series: [series(null, 'Ein- und Auscheck-Buchungen', {
              properties: [{ key: `event in ${sqlList(ATTENDANCE_EVENTS)}`, type: 'hogql' }],
            })],
            interval: 'day',
            dateFrom: '-60d',
            breakdown: SCHOOL_BREAKDOWN,
            breakdownType: 'hogql',
            display: 'TwoDimensionalHeatmap',
          }),
        },
        {
          name: 'Standorte: Nutzung pro Tag',
          description: 'Seitenaufrufe, Kernaktionen und Kiosk-Buchungen je Schule und Tag, letzte 60 Tage. Zeigt auch Schulen, die moto ohne Anwesenheitserfassung nutzen.',
          ...trends('production', {
            series: [series(null, 'Seitenaufrufe und Aktionen', {
              properties: [{ key: `isNotNull(properties.school_id) and ${ACTIVE_USE}`, type: 'hogql' }],
            })],
            interval: 'day',
            dateFrom: '-60d',
            breakdown: SCHOOL_BREAKDOWN,
            breakdownType: 'hogql',
            display: 'TwoDimensionalHeatmap',
          }),
        },
        {
          name: 'Standorte: Nutzung im Vergleich zum eigenen Schnitt',
          description: 'Jede Schule an sich selbst gemessen: Seitenaufrufe und Aktionen einer Woche gegenüber ihrem eigenen Wochenschnitt der letzten 12 abgeschlossenen Wochen (100 %). Über 100 % heißt mehr Nutzung als sonst, unter 100 % weniger, etwa in den Ferien. Eine Woche ohne jede Nutzung fehlt als Punkt. In der Legende lassen sich Schulen ein- und ausblenden.',
          ...hogql('production', (where) => `
select Woche, Standort, round(Anzahl / greatest(avg(Anzahl) over (partition by Schule), 1), 2) as ${quoted('Anteil am eigenen Schnitt')}
from (
  select toStartOfWeek(Tag, 1) as Woche, Schule, any(Standort) as Standort, countIf(Nutzung) as Anzahl
  from (${schoolDays(where, 91)})
  where Tag >= addDays(toStartOfWeek(today(), 1), -84) and Tag < toStartOfWeek(today(), 1)
  group by Woche, Schule
)
order by Woche, Standort`, 'ActionsLineGraph', {
            xAxis: { column: 'Woche' },
            yAxis: [{ column: 'Anteil am eigenen Schnitt', settings: { formatting: { style: 'percent', decimalPlaces: 0 } } }],
            seriesBreakdownColumn: 'Standort',
            goalLines: [{ label: 'eigener Schnitt', value: 1 }],
          }),
        },
        {
          name: 'Standorte: genutzte Abläufe (60 Tage)',
          description: `Je Schule ein Balken, je Ablauf ein Abschnitt: seine Länge ist die Zahl der Tage, an denen die Schule den Ablauf genutzt hat. Ein hoher Balken heißt also breite und regelmäßige Nutzung. „Weitere“ fasst die übrigen Funktionsbereiche zusammen (FEATURES in scripts/posthog-dashboards.mjs).`,
          ...hogql('production', (where) => `
select Standort, Ablauf, uniq(Tag) as Tage
from (
  select Standort, Tag, multiIf(Funktion in ${sqlList(KEY_FLOWS)}, Funktion, Funktion in ('', 'Startseite'), '', 'Weitere') as Ablauf
  from (${schoolDays(where, 60)})
)
where Ablauf != ''
group by Standort, Ablauf
order by Standort, Ablauf`, 'ActionsStackedBar', {
            xAxis: { column: 'Standort' },
            yAxis: [{ column: 'Tage' }],
            seriesBreakdownColumn: 'Ablauf',
          }),
        },
        {
          name: 'Standorte: Überblick (60 Tage)',
          description: 'Die Zahlen hinter den Grafiken. Anwesenheit heißt: mindestens eine Ein- oder Auscheck-Buchung an dem Tag. Der heutige Tag zählt nicht mit, er ist noch unvollständig. Buchungen sind keine Kinder: ein Kind kann mehrmals am Tag buchen.',
          ...hogql('production', (where) => `
select
  any(Standort) as Standort,
  Schule as ${quoted('Schul-ID')},
  uniqIf(Tag, Anwesenheit and Tag < today()) as ${quoted('Werktage mit Anwesenheit')},
  ${workdaysSinceFirstAttendance} as ${quoted('Werktage seit erster Anwesenheit')},
  if(countIf(Anwesenheit) = 0, null, minIf(Tag, Anwesenheit)) as ${quoted('Erste Anwesenheit')},
  if(countIf(Anwesenheit) = 0, null, maxIf(Tag, Anwesenheit)) as ${quoted('Letzte Anwesenheit')},
  uniqIf(Tag, Nutzung and Tag < today()) as ${quoted('Werktage mit Nutzung')},
  uniqIf(Tag, event = 'login_success') as ${quoted('Tage mit Login')},
  countIf(Anwesenheit) as ${quoted('Ein- und Auscheck-Buchungen')},
  countIf(${coreAction}) as Kernaktionen,
  countIf(event = '$pageview') as Seitenaufrufe
from (${schoolDays(where, 60)})
group by Schule
order by ${quoted('Werktage mit Anwesenheit')} desc, ${quoted('Werktage mit Nutzung')} desc`),
        },
        {
          name: 'Standorte: Tage je Funktionsbereich (60 Tage)',
          description: 'An wie vielen Tagen eine Schule einen Funktionsbereich genutzt hat, mit Seitenaufruf oder Aktion. Die Zuordnung steht in FEATURES in scripts/posthog-dashboards.mjs.',
          ...hogql('production', (where) => `
select
  any(Standort) as Standort,
  Schule as ${quoted('Schul-ID')},
  uniqIf(Tag, Nutzung) as ${quoted('Tage mit Nutzung')},
  uniqIf(Tag, event = 'login_success') as Logins,
  ${FEATURES.map((f) => `uniqIf(Tag, Funktion = ${sqlString(f.name)}) as ${quoted(f.name)}`).join(',\n  ')}
from (${schoolDays(where, 60)})
group by Schule
order by ${quoted('Tage mit Nutzung')} desc`),
        },
      ],
    },
    {
      name: 'Nutzungsanalyse: OGS-App',
      description: `Was Betreuung und Leitung in der OGS-App tun (surface = ogs), in echten Schulen (deployment = moto-app.de). Seiten erscheinen als Routenmuster mit ihrem Namen aus der Navigation, Bereiche wie in FEATURES (scripts/posthog-dashboards.mjs). ${WORKDAYS_NOTE}`,
      insights: [
        {
          name: 'OGS-App: Welche Seiten werden am meisten genutzt?',
          description: 'Letzte 30 Tage. Aufrufe pro Tag mit Nutzung, Schulen, Sitzungen und die mittlere Verweildauer. Tage ohne Nutzung (Ferien) zählen nicht mit.',
          ...pagesPerDay('production', 'ogs', pageNames),
        },
        {
          name: 'OGS-App: Was tun Betreuung und Leitung?',
          description: 'Letzte 30 Tage. Erfolgreiche Speichervorgänge aus dem Backend je Rolle (staff = Betreuung, admin = Leitung/Verwaltung).',
          ...actionsByRole('production', 'ogs', coreAction),
        },
        {
          name: 'OGS-App: Wohin geht es von der Startseite?',
          description: 'Letzte 30 Tage. Welche Seite nach der Startseite (/home) als nächste geöffnet wird, als Anteil aller Wechsel von dort.',
          ...nextPages('production', 'ogs', '/home', pageNames),
        },
        {
          name: 'OGS-App: Welcher Reiter auf „Alle Kinder“?',
          description: 'Letzte 30 Tage, nur wenn die Schule Kinder nur über „Alle Kinder“ finden lässt. Jeder Wechsel auf einen anderen Reiter, per Klick oder Pfeiltaste (dann zählen auch übersprungene Reiter); der Reiter beim Öffnen zählt nicht. „Meine Gruppe“ umfasst „Meine Gruppen“, „Meine Aufsicht“ auch „Aufsicht <Raum>“. Seitenaufrufe: „OGS-App: Welche Seiten werden am meisten genutzt?“',
          ...hogql('production', (where) => `
select
  multiIf(properties.child_scope = 'all', 'Alle', properties.child_scope = 'groups', 'Meine Gruppe', properties.child_scope = 'room', 'Meine Aufsicht', 'unbekannt') as Reiter,
  count() as Wechsel,
  round(100 * count() / sum(count()) over (), 1) as ${quoted('Anteil in Prozent')},
  uniq(toString(properties.school_id)) as Schulen,
  uniq($session_id) as Sitzungen
from events
where ${where}
  and event = 'child_scope_tab_selected'
  and ${SCHOOL_EVENT}
  and properties.surface = 'ogs'
  and timestamp > now() - interval 30 day
group by Reiter
order by Wechsel desc`),
        },
        {
          name: 'Funktionen: Reichweite in Schulen (30 Tage)',
          description: 'Je Funktionsbereich: wie viele Schulen ihn genutzt haben und welcher Anteil der aktiven Schulen das ist. Aktionen sind erfolgreiche Schreibvorgänge und Kiosk-Buchungen.',
          ...hogql('production', (where) => `
select
  Funktion,
  uniq(Schule) as Schulen,
  round(100 * uniq(Schule) / greatest(any(t.Aktiv), 1)) as ${quoted('Anteil aktiver Schulen in Prozent')},
  countIf(event = '$pageview') as Seitenaufrufe,
  countIf(event != '$pageview') as Aktionen,
  uniqIf(Sitzung, event = '$pageview') as Sitzungen
from (${schoolFeatureEvents(where, 30)}) as e
cross join (
  select uniq(toString(properties.school_id)) as Aktiv
  from events
  where ${where}
    and isNotNull(properties.school_id)
    and ${ACTIVE_USE}
    and timestamp > now() - interval 30 day
) as t
where Funktion != ''
group by Funktion
order by Schulen desc, Seitenaufrufe + Aktionen desc`),
        },
        {
          name: 'Funktionen: Schulen pro Woche',
          description: 'Wie viele Schulen jeden Funktionsbereich in einer Woche genutzt haben, letzte 12 Wochen. Zeigt, ob eine Funktion sich ausbreitet oder einschläft.',
          ...hogql('production', (where) => `
select
  toStartOfWeek(timestamp, 1) as Woche,
  uniq(Schule) as ${quoted('Aktive Schulen')},
  ${FEATURES.map((f) => `uniqIf(Schule, Funktion = ${sqlString(f.name)}) as ${quoted(f.name)}`).join(',\n  ')}
from (
  select ${feature} as Funktion, toString(properties.school_id) as Schule, timestamp
  from events
  where ${where}
    and ${SCHOOL_EVENT}
    and timestamp > now() - interval 12 week
)
where Funktion != ''
group by Woche
order by Woche desc`),
        },
        {
          name: 'OGS-App: Welche Seiten öffnet kaum jemand?',
          description: 'Jede Seite der OGS-App aus analytics-routes.ts, letzte 30 Tage, aufsteigend nach Aufrufen; 0 heißt nie geöffnet. Kandidaten zum Vereinfachen, Verstecken oder Streichen.',
          ...rarePages('production', 'ogs', routes),
        },
        {
          name: 'OGS-App: Wo klicken Nutzer ins Leere?',
          description: 'Letzte 30 Tage. Dead Clicks (Klick ohne Wirkung) und Rage Clicks (schnelle Mehrfachklicks) je Seite, mit Link zur Heatmap. Seiten mit gleichem Muster in zwei Portalen (/, /messages) teilen sich eine Heatmap.',
          ...frictionTable(projectId, 'production', ['ogs']),
        },
        {
          name: 'Seiten: Aufrufe ohne Routenmuster',
          description: 'Wartung, alle Portale (auch Eltern- und Schul-App): Seiten ohne Muster kommen als /unknown an. Steigt die Zahl, fehlt in analytics-routes.ts ein Eintrag.',
          ...trends('production', {
            series: [series('$pageview', 'Seiten ohne Muster', {
              properties: [{ key: '$pathname', type: 'event', operator: 'exact', value: ['/unknown'] }],
            })],
            breakdown: 'surface',
          }),
        },
      ],
    },
    {
      name: 'Nutzungsanalyse: Eltern-App',
      description: `Was Eltern in der Eltern-App tun (surface = parents), in echten Schulen (deployment = moto-app.de). Eltern haben keine Schule, deshalb gibt es hier keine Aufteilung nach Schule. ${WORKDAYS_NOTE} Eltern nutzen die App auch am Wochenende; diese Tage fehlen hier.`,
      insights: [
        {
          name: 'Eltern-App: Welche Seiten werden am meisten genutzt?',
          description: 'Letzte 30 Tage. Aufrufe pro Tag mit Nutzung, Sitzungen und die mittlere Verweildauer.',
          ...pagesPerDay('production', 'parents', PARENT_PAGE_NAMES),
        },
        {
          name: 'Eltern-App: Was schicken Eltern ab?',
          description: 'Letzte 30 Tage. Erfolgreiche Speichervorgänge aus dem Backend, etwa Abwesenheit gemeldet oder Abholung geändert.',
          ...actionsByRole('production', 'parents', coreAction),
        },
        {
          name: 'Eltern-App: Seitenaufrufe pro Woche',
          ...viewsPerWeek('production', 'parents', 'Seitenaufrufe'),
        },
        {
          name: 'Eltern-App: Wohin geht es von der Startseite?',
          description: 'Letzte 30 Tage. Welche Seite nach der Startseite als nächste geöffnet wird, als Anteil aller Wechsel von dort.',
          ...nextPages('production', 'parents', '/', PARENT_PAGE_NAMES),
        },
        {
          name: 'Eltern-App: Welche Seiten öffnet kaum jemand?',
          description: 'Jede Seite der Eltern-App aus analytics-routes.ts, letzte 30 Tage, aufsteigend nach Aufrufen; 0 heißt nie geöffnet.',
          ...rarePages('production', 'parents', routes),
        },
        {
          name: 'Eltern-App: Wo klicken Eltern ins Leere?',
          description: 'Letzte 30 Tage. Dead Clicks und Rage Clicks je Seite, mit Link zur Heatmap.',
          ...frictionTable(projectId, 'production', ['parents']),
        },
      ],
    },
    {
      name: 'Nutzungsanalyse: Schul-App',
      description: `Was Lehrkräfte in der Schul-App tun (surface = school), in echten Schulen (deployment = moto-app.de). Die Schul-App wird bisher wenig genutzt; kleine Zahlen sind Einzelfälle. ${WORKDAYS_NOTE}`,
      insights: [
        {
          name: 'Schul-App: Welche Seiten werden am meisten genutzt?',
          description: 'Letzte 30 Tage. Aufrufe pro Tag mit Nutzung, Schulen, Sitzungen und die mittlere Verweildauer.',
          ...pagesPerDay('production', 'school', SCHOOL_PAGE_NAMES),
        },
        {
          name: 'Schul-App: Was tun Lehrkräfte?',
          description: 'Letzte 30 Tage. Erfolgreiche Speichervorgänge aus dem Backend, etwa Anwesenheit in einer Aufsicht erfasst.',
          ...actionsByRole('production', 'school', coreAction),
        },
        {
          name: 'Schul-App: Welche Seiten öffnet kaum jemand?',
          description: 'Jede Seite der Schul-App aus analytics-routes.ts, letzte 30 Tage, aufsteigend nach Aufrufen; 0 heißt nie geöffnet.',
          ...rarePages('production', 'school', routes),
        },
        {
          name: 'Schul-App: Wo klicken Lehrkräfte ins Leere?',
          description: 'Letzte 30 Tage. Dead Clicks und Rage Clicks je Seite, mit Link zur Heatmap.',
          ...frictionTable(projectId, 'production', ['school']),
        },
      ],
    },
    {
      name: 'Nutzungsanalyse: Caterer-Portal',
      description: `Was Caterer im Caterer-Portal tun (surface = caterer) und wie Schulen ihren Caterer anbinden, in echten Schulen (deployment = moto-app.de). Das Caterer-Portal sendet keine Seitenaufrufe: Caterer-Konten werden nicht nach einer Einwilligung gefragt, ihr Browser erfasst deshalb nichts. Gezählt werden nur die Speichervorgänge aus dem Backend, je Schule der Bestellung oder Einladung; ein Login des Caterers nennt keine Schule und fehlt. Gezählt werden alle Tage, auch Wochenenden und Feiertage: Caterer planen auch dann.`,
      insights: [
        {
          name: 'Caterer-Portal: Was tun Caterer?',
          description: 'Letzte 30 Tage. Erfolgreiche Speichervorgänge im Caterer-Portal je Aktion, etwa Bestellung bestätigt, gezählt als Tage je Schule, auch am Wochenende: dieselbe Aktion für eine Schule am selben Tag zählt einmal.',
          ...hogql('production', (where) => `
select
  event as Aktion,
  ${SCHOOL_DAYS} as ${quoted('Tage je Schule')},
  uniq(toString(properties.school_id)) as Schulen
from events
where ${where}
  and properties.surface = ${sqlString(CATERER)}
  and ${coreAction}
  and timestamp > now() - interval 30 day
group by Aktion
order by ${quoted('Tage je Schule')} desc`, 'ActionsTable', undefined, { everyDay: true }),
        },
        {
          name: 'Caterer-Portal: Tage mit bestätigter Bestellung je Schule (30 Tage)',
          description: 'Je Schule: an wie vielen Tagen ihr Caterer mindestens eine Bestellung bestätigt hat, und wann zuletzt. Mehrere Bestätigungen am selben Tag zählen einmal. Eine Schule ohne Bestätigung fehlt.',
          ...hogql('production', (where) => `
select
  any(Standort) as Standort,
  Schule as ${quoted('Schul-ID')},
  uniq(Tag) as ${quoted('Tage mit Bestätigung')},
  max(Tag) as ${quoted('Letzte Bestätigung')}
from (
  select ${SCHOOL_BREAKDOWN} as Standort, toString(properties.school_id) as Schule, toDate(timestamp) as Tag
  from events
  where ${where}
    and event = 'meal_order_confirmed'
    and properties.surface = ${sqlString(CATERER)}
    and isNotNull(properties.school_id)
    and timestamp > now() - interval 30 day
)
group by Schule
order by ${quoted('Tage mit Bestätigung')} desc, Schule`, 'ActionsTable', undefined, { everyDay: true }),
        },
        {
          name: 'Caterer-Portal: Tage mit bestätigter Bestellung pro Woche',
          description: 'Alle Schulen zusammen: Tage je Schule einer Woche, an denen ihr Caterer mindestens eine Bestellung bestätigt hat. Zwei Schulen mit je fünf Tagen ergeben 10. Die Aufteilung je Schule zeigt die Tabelle „Tage mit bestätigter Bestellung je Schule (30 Tage)“.',
          ...trends('production', {
            series: [series('meal_order_confirmed', 'Tage je Schule mit Bestätigung', { math: 'hogql', math_hogql: SCHOOL_DAYS })],
            dateFrom: '-180d',
            display: 'ActionsBar',
            everyDay: true,
          }),
        },
        {
          name: 'Caterer-Anbindung: Einladungen, Annahmen und Enden pro Woche',
          description: 'Schulen laden ihren Caterer in der OGS-App ein und beenden die Belieferung dort; der Caterer nimmt die Einladung im Caterer-Portal an. Gezählt werden Tage je Schule, auch Wochenenden und Feiertage: mehrere gleiche Vorgänge einer Schule am selben Tag zählen einmal. Die OGS-Dashboards zählen Einladen und Beenden nur an Werktagen.',
          ...trends('production', {
            series: CATERER_LINK_EVENTS.map(([event, name]) => series(event, name, { math: 'hogql', math_hogql: SCHOOL_DAYS })),
            dateFrom: '-180d',
            display: 'ActionsBar',
            everyDay: true,
          }),
        },
      ],
    },
    {
      name: 'Nutzungsanalyse: Schule im Verlauf',
      description: `Eine Schule über die Zeit, verglichen mit ihr selbst statt mit anderen Schulen. Oben unter „Filter“ die Ereigniseigenschaft school_id auf eine Schul-ID setzen (die IDs stehen im Dashboard „Nutzung je Standort“, Tabelle Überblick). Ohne Filter zeigen die Grafiken alle Schulen zusammen. Die gestrichelte Linie ist der Zeitraum davor. Nur echte Schulen (deployment = moto-app.de). ${WORKDAYS_NOTE}`,
      insights: [
        {
          name: 'Verlauf: Tage mit Nutzung pro Woche',
          description: 'An wie vielen Tagen der Woche die Schule moto genutzt hat (Seitenaufruf, Kernaktion oder Kiosk). 5 heißt jeden Werktag.',
          ...trends('production', {
            series: [series(null, 'Tage mit Nutzung', {
              math: 'hogql',
              math_hogql: 'uniq(toDate(timestamp))',
              properties: [{ key: `isNotNull(properties.school_id) and ${ACTIVE_USE}`, type: 'hogql' }],
            })],
            dateFrom: '-180d',
            display: 'ActionsBar',
          }),
        },
        {
          name: 'Verlauf: Ein- und Auscheck-Buchungen pro Tag',
          description: 'Buchungen pro Tag, letzte 60 Tage, gestrichelt die 60 Tage davor. Buchungen sind keine Kinder. Erfasst seit dem 25.09.2026.',
          ...trends('production', {
            series: [series(null, 'Ein- und Auscheck-Buchungen', {
              properties: [{ key: `event in ${sqlList(ATTENDANCE_EVENTS)}`, type: 'hogql' }],
            })],
            interval: 'day',
            dateFrom: '-60d',
            compare: true,
          }),
        },
        {
          name: 'Verlauf: Seitenaufrufe und Aktionen pro Woche',
          description: 'Wie viel die Schule mit moto arbeitet, gestrichelt die 90 Tage davor.',
          ...trends('production', {
            series: [series(null, 'Seitenaufrufe und Aktionen', {
              properties: [{ key: `isNotNull(properties.school_id) and ${ACTIVE_USE}`, type: 'hogql' }],
            })],
            compare: true,
          }),
        },
        {
          name: 'Verlauf: Abläufe pro Woche',
          description: 'Seitenaufrufe und Aktionen je Ablauf. Zeigt, welche Abläufe die Schule neu aufnimmt oder liegen lässt.',
          ...trends('production', {
            series: KEY_FLOWS.map((flow) => series(null, flow, {
              properties: [{ key: `${SCHOOL_EVENT} and ${featureExpression()} = ${sqlString(flow)}`, type: 'hogql' }],
            })),
            display: 'ActionsBar',
          }),
        },
        {
          name: 'Verlauf: Logins pro Woche',
          description: 'Erfolgreiche Anmeldungen im OGS- und Schulportal, gestrichelt die 90 Tage davor.',
          ...trends('production', {
            series: [series('login_success', 'Logins', {
              properties: [{ key: 'isNotNull(properties.school_id)', type: 'hogql' }],
            })],
            compare: true,
          }),
        },
      ],
    },
    {
      name: 'Nutzungsanalyse: Einstieg',
      description: 'Was beim Einstieg in moto von selbst aufgeht und was Personen damit tun, in echten Schulen (deployment = moto-app.de). Die Flächen meldet der Browser, also nur mit Einwilligung: Personen ohne Einwilligung und die allererste Sitzung vor der Einwilligung fehlen. Die Werte sind deshalb verzerrt und kein Gesamtwert. Kacheln „vom Server“ zählen dagegen jede Schule, die die Nutzungsanalyse zulässt, auch ohne Einwilligung der Person. ' + WORKDAYS_NOTE,
      insights: [
        {
          name: 'Einstieg: Erste Schritte der Betreuung abgeschlossen oder ausgeblendet (vom Server)',
          description: 'Vom Server, also auch ohne Einwilligung, letzte 30 Tage. Wie oft Betreuungskräfte ihre Ersten Schritte mit „Abschließen“ beendet oder vorher mit „Ausblenden“ geschlossen haben, und der Anteil an beiden zusammen. Personen werden nicht gezählt.',
          ...hogql('production', (where) => `
select
  countIf(event = 'staff_first_steps_completed') as Abgeschlossen,
  countIf(event = 'staff_first_steps_dismissed') as Ausgeblendet,
  round(100 * countIf(event = 'staff_first_steps_completed') / greatest(count(), 1), 1) as ${quoted('Abschlussquote in Prozent')},
  round(100 * countIf(event = 'staff_first_steps_dismissed') / greatest(count(), 1), 1) as ${quoted('Schließquote in Prozent')},
  uniq(properties.school_id) as Schulen
from events
where ${where}
  and event in ${sqlList(['staff_first_steps_completed', 'staff_first_steps_dismissed'])}
  and properties.surface = 'ogs'
  and timestamp > now() - interval 30 day`),
        },
        {
          name: 'Einstieg: Erste Schritte der Betreuung je Schritt (vom Server)',
          description: 'Vom Server, also auch ohne Einwilligung, letzte 30 Tage. Je Schritt: wie oft er erledigt, übersprungen oder wieder geöffnet wurde. Viele Übersprünge zeigen einen Schritt, den Betreuungskräfte nicht brauchen.',
          ...hogql('production', (where) => `
select
  ${staffStepLabel} as Schritt,
  countIf(properties.action = 'done') as Erledigt,
  countIf(properties.action = 'skipped') as ${quoted('Übersprungen')},
  countIf(properties.action = 'reopened') as ${quoted('Wieder geöffnet')},
  uniq(properties.school_id) as Schulen
from events
where ${where}
  and event = 'staff_first_step_changed'
  and properties.surface = 'ogs'
  and timestamp > now() - interval 30 day
group by Schritt
order by ${quoted('Übersprungen')} desc`),
        },
        {
          name: 'Einstieg: Ankündigung gesehen und geschlossen',
          description: 'Letzte 30 Tage, auch ohne Einwilligung, je Schule gezählt, ohne Person oder Sitzung. Gesehen: eine Ankündigung erschien im OGS-Portal. Geschlossen: per „Verstanden“ oder X; das X schließt alle wartenden auf einmal. Daher gibt es keinen Prozentwert. Zählt Anzeigen, nicht Personen: eine nicht geschlossene erscheint beim nächsten Laden wieder.',
          ...hogql('production', (where) => `
select
  coalesce(properties.role, 'unbekannt') as Rolle,
  countIf(event = 'announcement_seen') as Gesehen,
  countIf(event = 'announcement_dismissed') as Geschlossen,
  uniq(toString(properties.school_id)) as Schulen
from events
where ${where}
  and event in ${sqlList(ANNOUNCEMENT_EVENTS)}
  and ${SCHOOL_EVENT}
  and timestamp > now() - interval 30 day
group by Rolle
order by Gesehen desc`),
        },
        {
          name: 'Einstieg: je Fläche angezeigt, angenommen, geschlossen (nur mit Einwilligung)',
          description: 'Nur mit Einwilligung, letzte 30 Tage. Je Fläche und Portal: wie oft sie erschien, wie oft die Person ihr Angebot annahm und wie oft sie sie schloss. Die Antwort im Installations-Dialog des Browsers steht nicht hier.',
          ...hogql('production', (where) => `
select
  ${surfaceLabel} as ${quoted('Fläche')},
  ${portalLabel('properties.surface')} as Portal,
  countIf(event = 'onboarding_surface_shown') as Angezeigt,
  countIf(event = 'onboarding_surface_accepted') as Angenommen,
  countIf(event = 'onboarding_surface_dismissed') as Geschlossen,
  round(100 * countIf(event = 'onboarding_surface_accepted') / greatest(countIf(event = 'onboarding_surface_shown'), 1), 1) as ${quoted('Angenommen in Prozent')},
  round(100 * countIf(event = 'onboarding_surface_dismissed') / greatest(countIf(event = 'onboarding_surface_shown'), 1), 1) as ${quoted('Geschlossen in Prozent')},
  uniq(properties.$session_id) as Sitzungen
from events
where ${where}
  and event in ${sqlList(ONBOARDING_SURFACE_EVENTS)}
  and ${portalCondition}
  and timestamp > now() - interval 30 day
group by ${quoted('Fläche')}, Portal
order by Angezeigt desc`),
        },
        {
          name: 'Einstieg: Flächen pro erfasster Sitzung (nur mit Einwilligung)',
          description: 'Nur mit Einwilligung, letzte 30 Tage, nur Sitzungen mit mindestens einer Fläche. Wie viele verschiedene Flächen in einer Sitzung erschienen. Die allererste Sitzung vor der Einwilligung fehlt immer.',
          ...hogql('production', (where) => `
select
  Portal,
  Flaechen as ${quoted('Flächen in der Sitzung')},
  count() as Sitzungen,
  round(100 * count() / sum(count()) over (partition by Portal), 1) as ${quoted('Anteil in Prozent')}
from (
  select
    properties.$session_id as Sitzung,
    ${portalLabel('any(properties.surface)')} as Portal,
    uniq(toString(properties.onboarding_surface)) as Flaechen
  from events
  where ${where}
    and event = 'onboarding_surface_shown'
    and isNotNull(properties.$session_id)
    and isNotNull(properties.onboarding_surface)
    and ${portalCondition}
    and timestamp > now() - interval 30 day
  group by Sitzung
)
group by Portal, Flaechen
order by Portal, Flaechen`),
        },
        {
          name: 'Einstieg: Erste Schritte der Eltern (nur mit Einwilligung)',
          description: 'Nur mit Einwilligung, letzte 30 Tage, Eltern-App. Wie oft die Liste von selbst aufging, welche Schritte erledigt wurden und wie oft Eltern die Liste ausblendeten oder mit „Erste Schritte abschließen“ abschlossen; der Anteil bezieht sich auf „von selbst geöffnet“. Der Fortschritt liegt nur im Browser; ein neues Gerät beginnt von vorn. Die allererste Sitzung vor der Einwilligung fehlt immer.',
          ...hogql('production', (where) => `
select
  multiIf(
    event = 'onboarding_surface_shown', '1 Von selbst geöffnet',
    event = 'onboarding_checklist_step_done', '2 Schritt erledigt',
    event = 'onboarding_checklist_dismissed', '3 Ausgeblendet',
    '4 Abgeschlossen') as Ereignis,
  if(event = 'onboarding_checklist_step_done', ${parentStepLabel}, '–') as Schritt,
  count() as Anzahl,
  round(100 * count() / greatest(sum(countIf(event = 'onboarding_surface_shown')) over (), 1), 1) as ${quoted('Anteil an „von selbst geöffnet“ in Prozent')},
  uniq(properties.$session_id) as Sitzungen
from events
where ${where}
  and properties.surface = 'parents'
  and (
    (event = 'onboarding_surface_shown' and properties.onboarding_surface = 'parent_first_steps')
    or (event in ${sqlList(PARENT_CHECKLIST_EVENTS)} and properties.checklist = 'parent_first_steps')
  )
  and timestamp > now() - interval 30 day
group by Ereignis, Schritt
order by Ereignis, Anzahl desc`),
        },
        {
          name: 'Einrichtungs-Checkliste: abgeschlossen und ausgeblendet',
          description: 'Vom Server, auch ohne Einwilligung, letzte 30 Tage. Schulen, deren Leitung in der Checkliste etwas tat: abschließen, Schritt überspringen oder ausblenden. Abschließen gilt für die Schule, Ausblenden für eine Person; die Schule zählt als ausgeblendet, sobald jemand ausblendet. Nur angesehene Checklisten fehlen; sie stehen in der Kachel je Fläche.',
          ...hogql('production', (where) => `
select
  count() as ${quoted('Schulen mit Checkliste')},
  countIf(HatAbgeschlossen = 1) as ${quoted('Abgeschlossen')},
  countIf(HatAusgeblendet = 1 and HatAbgeschlossen = 0) as ${quoted('Ausgeblendet ohne Abschluss')},
  round(100 * countIf(HatAbgeschlossen = 1) / greatest(count(), 1), 1) as ${quoted('Abgeschlossen in Prozent')},
  round(100 * countIf(HatAusgeblendet = 1 and HatAbgeschlossen = 0) / greatest(count(), 1), 1) as ${quoted('Ausgeblendet in Prozent')}
from (
  select
    toString(properties.school_id) as Schule_ID,
    countIf(event = ${sqlString(SETUP_CHECKLIST_EVENTS.completed)}) > 0 as HatAbgeschlossen,
    countIf(event = ${sqlString(SETUP_CHECKLIST_EVENTS.dismissed)}) > 0 as HatAusgeblendet
  from events
  where ${where}
    and event in ${sqlList(Object.values(SETUP_CHECKLIST_EVENTS))}
    and ${SCHOOL_EVENT}
    and timestamp > now() - interval 30 day
  group by Schule_ID
)`),
        },
        {
          name: 'Einrichtungs-Checkliste: übersprungene Schritte',
          description: 'Vom Server, auch ohne Einwilligung, letzte 30 Tage. Welche Schritte die Leitung überspringt, und in wie vielen Schulen. Wer einen Sprung zurücknimmt und neu überspringt, zählt bei „Übersprungen“ doppelt, bei „Schulen“ nicht.',
          ...hogql('production', (where) => `
select
  ${setupStepLabel} as Schritt,
  count() as ${quoted('Übersprungen')},
  uniq(toString(properties.school_id)) as Schulen
from events
where ${where}
  and event = ${sqlString(SETUP_CHECKLIST_EVENTS.stepSkipped)}
  and ${SCHOOL_EVENT}
  and timestamp > now() - interval 30 day
group by Schritt
order by Schulen desc`),
        },
        {
          name: 'Einstieg: Benachrichtigungs-Einrichtung je Portal (nur mit Einwilligung)',
          description: 'Nur mit Einwilligung, letzte 30 Tage. Der Benachrichtigungs-Dialog, der sich nach dem Login von selbst öffnet, je Portal: wie oft er erschien, eingeschaltet wurde (fertig) und auf später geschoben (Später erinnern, Verstanden, Anleitung schließen, X). Ein Neustart aus den Einstellungen zählt nicht. Vorher-Wert für #7542.',
          ...hogql('production', (where) => `
select
  ${portalLabel('properties.surface')} as Portal,
  countIf(event = 'onboarding_surface_shown') as Angezeigt,
  countIf(event = 'onboarding_surface_accepted') as Eingeschaltet,
  countIf(event = 'onboarding_surface_dismissed') as ${quoted('Auf später')},
  round(100 * countIf(event = 'onboarding_surface_accepted') / greatest(countIf(event = 'onboarding_surface_shown'), 1), 1) as ${quoted('Eingeschaltet in Prozent')},
  round(100 * countIf(event = 'onboarding_surface_dismissed') / greatest(countIf(event = 'onboarding_surface_shown'), 1), 1) as ${quoted('Auf später in Prozent')}
from events
where ${where}
  and event in ${sqlList(ONBOARDING_SURFACE_EVENTS)}
  and properties.onboarding_surface = 'notification_setup'
  and ${portalCondition}
  and timestamp > now() - interval 30 day
group by Portal
order by Angezeigt desc`),
        },
      ],
    },
    {
      name: 'Nutzungsanalyse: Demo',
      description: 'Was Interessenten in der öffentlichen Demo ansehen, ausprobieren und wo sie aussteigen, bis zum Klick auf „Termin buchen“. Nur deployment = demo, Demo-Zugänge statt Personen. Eine Sitzung endet auch beim Neuladen oder in einem neuen Tab. „Termin buchen“ öffnet den Terminkalender in HubSpot; gebuchte Termine stehen dort, nicht in PostHog. Ältere Klicks desselben Ereignisses kamen vom früheren Knopf „Kostenlos starten“.',
      insights: [
        {
          name: 'Demo-Funnel: Einstieg bis Termin buchen',
          description: 'Folgt einem Demo-Zugang vom Einstieg über den Rollenwechsel bis „Termin buchen“, letzte 30 Tage. Das ist die Konversion der Demo.',
          ...funnel('demo', {
            series: [
              series('demo_entered', 'Eingestiegen'),
              series('demo_role_switched', 'Rolle gewechselt'),
              series('demo_start_clicked', 'Termin buchen'),
            ],
          }),
        },
        {
          name: 'Demo: Wie lange bleiben Besucher?',
          description: 'Letzte 30 Tage, Sitzungen nach der Rollenwahl. Dauer vom ersten bis zum letzten Seitenaufruf der Sitzung; eine Sitzung mit nur einer Seite zählt als „unter 1 Minute“.',
          ...hogql('demo', (where) => `
select
  multiIf(Sekunden < 60, 'unter 1 Minute', Sekunden < 180, '1 bis 3 Minuten', Sekunden < 600, '3 bis 10 Minuten', Sekunden < 1800, '10 bis 30 Minuten', 'über 30 Minuten') as ${quoted('Dauer in der Demo')},
  count() as Sitzungen,
  round(100 * count() / sum(count()) over (), 1) as ${quoted('Anteil in Prozent')},
  round(avg(Seiten), 1) as ${quoted('Seiten (Mittel)')},
  countIf(Gestartet = 1) as ${quoted('davon „Termin buchen“ geklickt')}
from (
  select
    properties.$session_id as Sitzung,
    dateDiff('second', minIf(timestamp, event = '$pageview'), maxIf(timestamp, event = '$pageview')) as Sekunden,
    countIf(event = '$pageview') as Seiten,
    max(event = 'demo_start_clicked') as Gestartet
  from events
  where ${where}
    and isNotNull(properties.$session_id)
    and (event = 'demo_start_clicked' or (event = '$pageview' and coalesce(properties.demo_role, properties.role) in ${sqlList(DEMO_ROLES)}))
    and timestamp > now() - interval 30 day
  group by Sitzung
  having Seiten > 0
)
group by ${quoted('Dauer in der Demo')}
order by min(Sekunden)`),
        },
        {
          name: 'Demo-Verhalten: angesehene Funktionen nach Rolle',
          description: 'Letzte 30 Tage. Welcher Anteil der Sitzungen einer Demo-Rolle einen Funktionsbereich geöffnet hat.',
          ...hogql('demo', (where) => `
select
  f.Rolle as Rolle,
  f.Funktion as Funktion,
  f.Sitzungen as Sitzungen,
  round(100 * f.Sitzungen / greatest(r.Gesamt, 1)) as ${quoted('Anteil der Sitzungen in Prozent')},
  f.Aufrufe as Seitenaufrufe
from (
  select Rolle, Funktion, uniq(Sitzung) as Sitzungen, count() as Aufrufe
  from (${demoPages(where)})
  where Funktion != ''
  group by Rolle, Funktion
) as f
join (
  select Rolle, uniq(Sitzung) as Gesamt
  from (${demoPages(where)})
  group by Rolle
) as r on f.Rolle = r.Rolle
order by Rolle, Sitzungen desc`),
        },
        {
          name: 'Demo-Verhalten: Funktionen vor „Termin buchen“',
          description: 'Letzte 30 Tage. Welcher Anteil der Sitzungen mit und ohne Klick auf „Termin buchen“ einen Funktionsbereich gesehen hat. Ein großer Abstand deutet auf eine Funktion, die überzeugt. Wenige Klicks bedeuten große Zufallsschwankung.',
          ...hogql('demo', (where) => `
select
  Funktion,
  countIf(Gestartet = 1) as ${quoted('Sitzungen mit Klick')},
  round(100 * countIf(Gestartet = 1) / greatest(max(MitKlick), 1)) as ${quoted('Anteil mit Klick in Prozent')},
  round(100 * countIf(Gestartet = 0) / greatest(max(OhneKlick), 1)) as ${quoted('Anteil ohne Klick in Prozent')}
from (
  select Sitzung, Gestartet, arrayJoin(Funktionen) as Funktion, MitKlick, OhneKlick
  from (
    select
      Sitzung,
      Gestartet,
      Funktionen,
      sum(Gestartet) over () as MitKlick,
      count() over () - sum(Gestartet) over () as OhneKlick
    from (
      select
        properties.$session_id as Sitzung,
        max(event = 'demo_start_clicked') as Gestartet,
        groupUniqArrayIf(${feature}, event = '$pageview' and coalesce(properties.demo_role, properties.role) in ${sqlList(DEMO_ROLES)}) as Funktionen
      from events
      where ${where}
        and isNotNull(properties.$session_id)
        and timestamp > now() - interval 30 day
      group by Sitzung
    )
    where length(Funktionen) > 0
  )
)
where Funktion != ''
group by Funktion
order by ${quoted('Anteil mit Klick in Prozent')} desc, ${quoted('Anteil ohne Klick in Prozent')} desc`),
        },
        {
          name: 'Demo-Verhalten: ausprobierte Aktionen',
          description: 'Letzte 30 Tage. Was Besucher selbst gespeichert oder abgeschickt haben. Nur Aktionen mit Browser-Sitzung: die Daten, die beim Bereitstellen der Demo-Schule entstehen, zählen nicht.',
          ...hogql('demo', (where) => `
select
  Funktion,
  event as Aktion,
  count() as Anzahl,
  uniq(Sitzung) as Sitzungen
from (
  select ${feature} as Funktion, event, properties.$session_id as Sitzung
  from events
  where ${where}
    and event != '$pageview'
    and isNotNull(properties.$session_id)
    and timestamp > now() - interval 30 day
)
where Funktion != ''
group by Funktion, Aktion
order by Anzahl desc`),
        },
        {
          name: 'Demo-Verhalten: letzte Seite vor dem Aufhören',
          description: 'Letzte 30 Tage. Auf welcher Seite Demo-Sitzungen enden, wie viele Seiten und Sekunden die Sitzung bis dahin hatte.',
          ...hogql('demo', (where) => `
select
  Funktion,
  Seite,
  count() as ${quoted('Sitzungen endeten hier')},
  round(100 * count() / sum(count()) over (), 1) as ${quoted('Anteil in Prozent')},
  round(median(Seiten)) as ${quoted('Median Seiten bis dahin')},
  round(median(Dauer)) as ${quoted('Median Dauer (s)')}
from (
  select
    Sitzung,
    argMax(Funktion, timestamp) as Funktion,
    argMax(Seite, timestamp) as Seite,
    count() as Seiten,
    dateDiff('second', min(timestamp), max(timestamp)) as Dauer
  from (${demoPages(where)})
  group by Sitzung
)
group by Funktion, Seite
order by ${quoted('Sitzungen endeten hier')} desc
limit 30`),
        },
        {
          name: 'Demo: Einstiege nach Rolle und Quelle',
          description: 'Demo-Rolle und Kampagnenquelle (src) der letzten 30 Tage.',
          ...hogql('demo', (where) => `
select
  coalesce(properties.demo_role, 'unbekannt') as \`Demo-Rolle\`,
  coalesce(properties.src, 'ohne') as Quelle,
  countIf(event = 'demo_entered') as Einstiege,
  countIf(event = 'demo_role_switched') as Rollenwechsel,
  countIf(event = 'demo_start_clicked') as \`Termin buchen\`
from events
where ${where}
  and event in ('demo_entered', 'demo_role_switched', 'demo_start_clicked')
  and timestamp > now() - interval 30 day
group by \`Demo-Rolle\`, Quelle
order by Einstiege desc`),
        },
        {
          name: 'Demo-Funnel: Schritte pro Woche',
          ...trends('demo', {
            series: [
              series('demo_link_requested', 'Link angefordert'),
              series('demo_started', 'Demo-Schule bereitgestellt'),
              series('demo_entered', 'Eingestiegen'),
              series('demo_role_switched', 'Rolle gewechselt'),
              series('demo_start_clicked', 'Termin buchen'),
            ],
          }),
        },
        {
          name: 'Demo-Funnel: Ereignisse je Schritt (30 Tage)',
          description: 'Zählt Ereignisse, keine Besucher: Ein Besucher kann die Rolle mehrmals wechseln, ein Link mehrmals geöffnet werden. Link angefordert und Demo-Schule bereitgestellt kommen aus dem Backend, die übrigen Schritte aus dem Browser.',
          ...hogql('demo', (where) => `
select Schritt, Anzahl
from (
  select 1 as Nr, 'Link angefordert' as Schritt, countIf(event = 'demo_link_requested') as Anzahl from events where ${where} and timestamp > now() - interval 30 day
  union all
  select 2, 'Link geöffnet (Warteraum)', countIf(event = '$pageview' and properties.surface = 'public' and properties.$pathname = '/demo') from events where ${where} and timestamp > now() - interval 30 day
  union all
  select 3, 'Demo-Schule bereitgestellt (Backend)', countIf(event = 'demo_started') from events where ${where} and timestamp > now() - interval 30 day
  union all
  select 4, 'Eingestiegen', countIf(event = 'demo_entered') from events where ${where} and timestamp > now() - interval 30 day
  union all
  select 5, 'Rolle gewechselt', countIf(event = 'demo_role_switched') from events where ${where} and timestamp > now() - interval 30 day
  union all
  select 6, 'Termin buchen', countIf(event = 'demo_start_clicked') from events where ${where} and timestamp > now() - interval 30 day
)
order by Nr`),
        },
        {
          name: 'Demo: Wo klicken Besucher ins Leere?',
          description: 'Letzte 30 Tage, öffentliche Demo. Dead Clicks und Rage Clicks je Seite, mit Link zur Heatmap.',
          ...frictionTable(projectId, 'demo', [...PORTALS, 'public']),
        },
      ],
    },
  ];
}

/** Production events of schools with their feature area (SCHOOL_EVENT: no parents portal, no caterer). */
function schoolFeatureEvents(where, days) {
  return `
  select ${featureExpression()} as Funktion, toString(properties.school_id) as Schule, event, properties.$session_id as Sitzung
  from events
  where ${where}
    and ${SCHOOL_EVENT}
    and timestamp > now() - interval ${days} day`;
}

const ATTENDANCE_EVENTS = FEATURES.find((f) => f.name === 'Ein- und Auschecken').events;

/** Feature areas the per-school chart shows on their own (at most eight segments with „Weitere“). */
const KEY_FLOWS = [
  'Ein- und Auschecken', 'Aufsichten und Räume', 'Abwesenheiten', 'Elternanfragen',
  'Nachrichten und Elternbriefe', 'Zeiterfassung', 'Kinder und Kindakte',
];

/** School days (ON_WORKDAY) from a school's first attendance in `schoolDays` until yesterday. */
const workdaysSinceFirstAttendance = `if(countIf(Anwesenheit) = 0, 0, length(arrayFilter(d -> toDayOfWeek(d) <= 5 and toString(d) not in ${sqlList(publicHolidays())}, arrayMap(i -> addDays(minIf(Tag, Anwesenheit), i), range(toInt(greatest(dateDiff('day', minIf(Tag, Anwesenheit), today()), 0)))))))`;

/** Production events of schools (SCHOOL_EVENT) with their day (project time zone) and feature area. */
function schoolDays(where, days) {
  return `
  select
    toString(properties.school_id) as Schule,
    ${SCHOOL_BREAKDOWN} as Standort,
    toDate(timestamp) as Tag,
    event in ${sqlList(ATTENDANCE_EVENTS)} as Anwesenheit,
    ${ACTIVE_USE} as Nutzung,
    ${featureExpression()} as Funktion,
    event
  from events
  where ${where}
    and ${SCHOOL_EVENT}
    and timestamp > now() - interval ${days} day`;
}

/** Demo page views after the role pick, with their feature area. */
function demoPages(where) {
  return `
  select
    properties.$session_id as Sitzung,
    ${featureExpression()} as Funktion,
    properties.$pathname as Seite,
    coalesce(properties.demo_role, properties.role) as Rolle,
    timestamp
  from events
  where ${where}
    and event = '$pageview'
    and coalesce(properties.demo_role, properties.role) in ${sqlList(DEMO_ROLES)}
    and isNotNull(properties.$session_id)
    and timestamp > now() - interval 30 day`;
}

// --- sync --------------------------------------------------------------------

/** Minimal PostHog client; `request` is swappable for tests. */
export function posthogClient({ apiKey, request = fetch }) {
  if (!apiKey) throw new Error('POSTHOG_PERSONAL_API_KEY is not set');
  return async (method, path, body) => {
    const response = await request(`${POSTHOG_HOST}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`PostHog ${method} ${path}: ${response.status} ${text.slice(0, 500)}`);
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  };
}

async function listAll(api, path) {
  const results = [];
  let next = path;
  while (next) {
    const page = await api('GET', next);
    results.push(...page.results);
    next = page.next ? new URL(page.next).pathname + new URL(page.next).search : null;
  }
  return results;
}

export async function resolveProjectId(api, configured = process.env.POSTHOG_PROJECT_ID) {
  if (configured) return String(configured);
  const projects = await listAll(api, '/api/projects/');
  if (projects.length !== 1) {
    throw new Error(`The key sees ${projects.length} projects; set POSTHOG_PROJECT_ID`);
  }
  return String(projects[0].id);
}

/**
 * First path where `actual` lacks a value of `expected`, or null. PostHog
 * fills in defaults when it stores a query, so a stored query that contains
 * every value of the definition is current.
 */
export function missingPath(expected, actual, path = 'query') {
  if (expected === null || typeof expected !== 'object') {
    return expected === actual ? null : path;
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(expected) !== Array.isArray(actual)) return path;
  if (Array.isArray(expected) && expected.length !== actual.length) return path;
  for (const [key, value] of Object.entries(expected)) {
    const missing = missingPath(value, actual[key], `${path}.${key}`);
    if (missing) return missing;
  }
  return null;
}

/**
 * Creates or updates every dashboard and insight. Returns what it did, one
 * line per object; `dryRun` only reports.
 */
export async function sync(api, projectId, definitions, { dryRun = false } = {}) {
  const base = `/api/projects/${projectId}`;
  const log = [];
  const existingDashboards = (await listAll(api, `${base}/dashboards/?limit=200`)).filter((d) => !d.deleted);

  for (const definition of definitions) {
    let dashboard = existingDashboards.find((d) => d.name === definition.name);
    const dashboardBody = { name: definition.name, description: definition.description };
    if (!dashboard) {
      log.push(`create dashboard ${definition.name}`);
      dashboard = dryRun ? { id: null } : await api('POST', `${base}/dashboards/`, dashboardBody);
    } else if (dashboard.description !== definition.description) {
      log.push(`update dashboard ${definition.name}`);
      if (!dryRun) await api('PATCH', `${base}/dashboards/${dashboard.id}/`, dashboardBody);
    }

    for (const insight of definition.insights) {
      const found = (await listAll(api, `${base}/insights/?saved=true&limit=100&search=${encodeURIComponent(insight.name)}`))
        .filter((candidate) => !candidate.deleted && candidate.name === insight.name);
      const current = found[0];
      const body = { name: insight.name, description: insight.description ?? '', query: insight.query, saved: true };
      if (!current) {
        log.push(`create insight ${insight.name}`);
        if (!dryRun) await api('POST', `${base}/insights/`, { ...body, dashboards: [dashboard.id] });
        continue;
      }
      const dashboardIds = current.dashboards ?? [];
      const onDashboard = dashboard.id !== null && dashboardIds.includes(dashboard.id);
      const changed = missingPath(insight.query, current.query);
      if (onDashboard && !changed && (current.description ?? '') === body.description) {
        continue;
      }
      log.push(`update insight ${insight.name}${changed ? ` (${changed})` : ''}`);
      if (!dryRun) {
        await api('PATCH', `${base}/insights/${current.id}/`, {
          ...body,
          dashboards: onDashboard ? dashboardIds : [...dashboardIds, dashboard.id],
        });
      }
    }
  }
  return log;
}

/**
 * PostHog's answer when a query ran into its execution time limit. Load on
 * PostHog's side decides it as much as the query does, so `check` tries such
 * a query once more; every other error fails at once.
 */
export const isQueryTimeout = (error) => error?.status === 504 && /max execution time/i.test(error.message);

/** Attempts per query in `check`: one more only after a timeout (`isQueryTimeout`). */
const QUERY_ATTEMPTS = 2;

/**
 * Runs every insight query; a query PostHog rejects fails the run. A query
 * that times out twice fails too, and one that passed on its second attempt
 * says so in the log.
 */
export async function check(api, projectId, definitions) {
  const log = [];
  let failed = false;
  for (const definition of definitions) {
    for (const insight of definition.insights) {
      try {
        let result;
        let attempt = 1;
        for (;;) {
          try {
            result = await api('POST', `/api/projects/${projectId}/query/`, { query: insight.query.source });
            break;
          } catch (error) {
            if (attempt >= QUERY_ATTEMPTS || !isQueryTimeout(error)) throw error;
            attempt++;
          }
        }
        const retried = attempt > 1 ? ' (retried after a timeout)' : '';
        log.push(`ok   ${insight.name}: ${result.results?.length ?? 0} rows${retried}`);
      } catch (error) {
        failed = true;
        log.push(`FAIL ${insight.name}: ${error.message}`);
      }
    }
  }
  return { log, failed };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const api = posthogClient({ apiKey: process.env.POSTHOG_PERSONAL_API_KEY });
  const projectId = await resolveProjectId(api);
  if (process.argv.includes('--check')) {
    const { log, failed } = await check(api, projectId, dashboards({ projectId }));
    console.log(log.join('\n'));
    process.exitCode = failed ? 1 : 0;
    return;
  }
  const log = await sync(api, projectId, dashboards({ projectId }), { dryRun });
  console.log(log.length ? log.join('\n') : 'Everything is current.');
  const all = await listAll(api, `/api/projects/${projectId}/dashboards/?limit=200`);
  for (const definition of dashboards({ projectId })) {
    const dashboard = all.find((d) => !d.deleted && d.name === definition.name);
    if (dashboard) console.log(`${definition.name}: ${POSTHOG_HOST}/project/${projectId}/dashboard/${dashboard.id}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DEPLOYMENTS,
  FEATURES,
  ONBOARDING_SURFACE_LABELS,
  PARENT_FIRST_STEP_LABELS,
  ON_WORKDAY,
  POSTHOG_HOST,
  SCHOOL_BREAKDOWN,
  SETUP_CHECKLIST_STEP_LABELS,
  STAFF_FIRST_STEPS_EVENTS,
  STAFF_FIRST_STEP_LABELS,
  check,
  dashboards,
  featureExpression,
  featureOfPage,
  isQueryTimeout,
  missingPath,
  posthogClient,
  publicHolidays,
  readBrowserEvents,
  readOnboardingChecklistSteps,
  readOnboardingSurfaces,
  readPageNames,
  readRouteTemplates,
  sync,
} from './posthog-dashboards.mjs';

const definitions = dashboards({ projectId: '1' });
const insights = definitions.flatMap((dashboard) => dashboard.insights);

test('defines one dashboard per product surface plus the two across schools and the entry', () => {
  assert.deepEqual(definitions.map((dashboard) => dashboard.name), [
    'Nutzungsanalyse: Nutzung je Standort',
    'Nutzungsanalyse: OGS-App',
    'Nutzungsanalyse: Eltern-App',
    'Nutzungsanalyse: Schul-App',
    'Nutzungsanalyse: Caterer-Portal',
    'Nutzungsanalyse: Schule im Verlauf',
    'Nutzungsanalyse: Einstieg',
    'Nutzungsanalyse: Demo',
  ]);
  const names = insights.map((insight) => insight.name);
  assert.equal(new Set(names).size, names.length, 'insight names are the sync key and must be unique');
});

test('every insight description fits PostHog\'s limit of 400 characters', () => {
  // The API rejects a longer insight description only on write; --check and
  // --dry-run never send it, so the sync after a merge would fail.
  for (const insight of insights) {
    assert.ok((insight.description ?? '').length <= 400, `${insight.name}: ${(insight.description ?? "").length} characters`);
  }
});

test('every insight filters on production or the demo, never staging', () => {
  for (const insight of insights) {
    const deployment = DEPLOYMENTS[insight.deployment];
    assert.ok(deployment, `${insight.name} names no known deployment`);
    const source = insight.query.source;
    if (source.kind === 'HogQLQuery') {
      const tables = source.query.match(/\bfrom events\b/g) ?? [];
      const filters = source.query.match(new RegExp(`properties\\.deployment = '${deployment}'`, 'g')) ?? [];
      assert.ok(tables.length > 0, insight.name);
      assert.equal(filters.length, tables.length, `${insight.name}: every events scan filters the deployment`);
      const heatmaps = source.query.match(/\bfrom heatmaps\b/g) ?? [];
      const hosts = source.query.match(new RegExp(`startsWith\\(current_url, 'https://${deployment}/'\\)`, 'g')) ?? [];
      assert.equal(hosts.length, heatmaps.length, `${insight.name}: every heatmaps scan filters the deployment host`);
    } else {
      assert.deepEqual(source.properties.values[0].values,
        [{ key: 'deployment', type: 'event', operator: 'exact', value: [deployment] }], insight.name);
    }
    assert.doesNotMatch(JSON.stringify(insight.query), /staging|localhost/i, insight.name);
  }
});

test('school insights count Monday to Friday without the public holidays of NRW, the demo and the caterer every day', () => {
  for (const insight of insights) {
    const source = insight.query.source;
    const filters = source.kind === 'HogQLQuery'
      ? source.query.split(ON_WORKDAY).length - 1
      : source.properties.values.filter((group) => group.values.some((value) => value.key === ON_WORKDAY)).length;
    const scans = source.kind === 'HogQLQuery' ? source.query.match(/\bfrom (events|heatmaps)\b/g).length : 1;
    assert.equal(filters, insight.deployment === 'production' && !insight.everyDay ? scans : 0, insight.name);
  }
  // Only the caterer, an outside party that also plans on weekends, counts every day.
  const everyDay = definitions.filter((d) => d.insights.some((insight) => insight.everyDay));
  assert.deepEqual(everyDay.map((d) => d.name), ['Nutzungsanalyse: Caterer-Portal']);
  assert.ok(everyDay[0].insights.every((insight) => insight.everyDay), 'every caterer tile counts every day');
  const holidays = publicHolidays([2026, 2027]);
  assert.equal(holidays.length, 22);
  for (const day of ['2026-04-03', '2026-04-06', '2026-05-14', '2026-05-25', '2026-06-04', '2026-10-03', '2026-11-01', '2026-12-25', '2027-03-29']) {
    assert.ok(holidays.includes(day), day);
  }
  assert.ok(publicHolidays().includes('2035-12-26'));
});

test('the demo dashboards stay in the demo and the school dashboards in production', () => {
  const isDemo = (dashboard) => dashboard.name.startsWith('Nutzungsanalyse: Demo');
  const demos = definitions.filter(isDemo);
  assert.deepEqual(demos.map((d) => d.name), ['Nutzungsanalyse: Demo']);
  for (const demo of demos) {
    assert.ok(demo.insights.every((insight) => insight.deployment === 'demo'), demo.name);
  }
  const schools = definitions.filter((d) => !isDemo(d));
  for (const dashboard of schools) {
    assert.ok(dashboard.insights.every((insight) => insight.deployment === 'production'), dashboard.name);
  }
});

test('no insight looks at a single person', () => {
  for (const insight of insights) {
    const query = JSON.stringify(insight.query);
    assert.doesNotMatch(query, /distinct_id|\bpersons?\b|person_id|\$user_id|\bpdi\b|email|\bdau\b|weekly_active|monthly_active|unique_users/i, insight.name);
    assert.notEqual(insight.query.source.kind, 'PathsQuery', `${insight.name}: Paths count people`);
    const breakdown = insight.query.source.breakdownFilter?.breakdown;
    if (breakdown) assert.ok(['surface', 'role', SCHOOL_BREAKDOWN].includes(breakdown), insight.name);
  }
});

test('charts name a school from its production group and fall back to its ID', () => {
  assert.match(SCHOOL_BREAKDOWN, /from groups where index = 0 and startsWith\(key, 'moto-app\.de:'\)/);
  assert.match(SCHOOL_BREAKDOWN, /concat\('Schule ', toString\(properties\.school_id\)\)\)$/);
  assert.doesNotMatch(SCHOOL_BREAKDOWN, /demo|staging|localhost/);
});

test('reads the route templates of every portal from analytics-routes.ts', () => {
  const routes = readRouteTemplates();
  for (const route of [['ogs', '/dashboard'], ['ogs', '/demo'], ['parents', '/children/:id'], ['school', '/klasse']]) {
    assert.ok(routes.some(([surface, template]) => surface === route[0] && template === route[1]), route.join(' '));
  }
  assert.throws(() => readRouteTemplates('export const OTHER = [] as const;'), /TRACKED_TENANT_ROUTE_TEMPLATES/);
});

test('reads the browser events from analytics-policy.ts', () => {
  const events = readBrowserEvents();
  assert.ok(events.includes('demo_start_clicked'));
  assert.ok(!events.includes('login_success'), 'a core action comes from the backend');
  assert.throws(() => readBrowserEvents('const OTHER = 1;'), /CUSTOM_EVENTS/);
  const usage = insights.find((insight) => insight.name.startsWith('OGS-App: Was tun'));
  assert.match(usage.query.source.query, /event not in \('login_failed', /);
});

test('every route template belongs to exactly one feature area or is an entry page', () => {
  for (const [surface, template] of readRouteTemplates()) {
    const feature = featureOfPage(surface, template);
    assert.notEqual(feature, 'Sonstiges', `${surface} ${template}: add it to FEATURES or NO_FEATURE_PAGES`);
    const owners = FEATURES.filter((f) => (f.pages?.[surface] ?? []).some((pattern) => pattern.endsWith('/**')
      ? template === pattern.slice(0, -3) || template.startsWith(pattern.slice(0, -2))
      : template === pattern));
    assert.ok(owners.length <= 1, `${surface} ${template} is in ${owners.map((f) => f.name).join(' and ')}`);
  }
  assert.equal(featureOfPage('ogs', '/students/:id/room-history'), 'Kinder und Kindakte');
  assert.equal(featureOfPage('school', '/klasse/kind'), 'Kinder und Kindakte');
  assert.equal(featureOfPage('ogs', '/students-archive'), 'Sonstiges', 'a prefix covers its sub pages only');
  assert.equal(featureOfPage('parents', '/login'), null);
  assert.equal(featureOfPage('parents', '/documents'), 'Weitere Werkzeuge');
});

test('feature areas have unique names, each event belongs to one area, and the kiosk counts', () => {
  const names = FEATURES.map((f) => f.name);
  assert.equal(new Set(names).size, names.length);
  const events = FEATURES.flatMap((f) => f.events ?? []);
  assert.equal(new Set(events).size, events.length);
  assert.ok(events.includes('student_checked_in') && events.includes('student_checked_out'));
  const expression = featureExpression();
  for (const name of names) assert.ok(expression.includes(`'${name}'`), name);
  assert.match(expression, /startsWith\(event, 'demo_'\)/, 'the demo funnel events are no feature use');
});

test('the Alle Kinder tile counts tab changes per tab kind, and browser clicks are no feature use', () => {
  const tile = insights.find((insight) => insight.name === 'OGS-App: Welcher Reiter auf „Alle Kinder“?');
  const query = tile.query.source.query;
  assert.match(query, /event = 'child_scope_tab_selected'/);
  assert.match(query, /properties\.surface = 'ogs'/);
  for (const value of ['all', 'groups', 'room']) assert.match(query, new RegExp(`properties\\.child_scope = '${value}'`), value);
  assert.ok(readBrowserEvents().includes('child_scope_tab_selected'), 'the browser filter lets the event through');
  const expression = featureExpression();
  const noFeature = expression.slice(expression.lastIndexOf("startsWith(event, 'demo_')"));
  for (const event of ['child_scope_tab_selected', 'notification_bell_opened', 'notification_feed_entry_clicked', 'notification_feed_all_read']) {
    assert.match(noFeature, new RegExp(`'${event}'`), `${event} is no feature use`);
  }
});

test('the entry dashboard shows the notification setup per portal, marked as consent-only', () => {
  const dashboard = definitions.find((d) => d.name === 'Nutzungsanalyse: Einstieg');
  const tile = dashboard.insights.find((insight) => insight.name === 'Einstieg: Benachrichtigungs-Einrichtung je Portal (nur mit Einwilligung)');
  assert.ok(tile, 'the notification setup tile exists');
  assert.equal(tile.deployment, 'production');
  assert.match(tile.description, /nur mit Einwilligung/i);
  const query = tile.query.source.query;
  assert.match(query, /properties\.onboarding_surface = 'notification_setup'/);
  assert.match(query, /group by Portal\b/);
  for (const action of ['shown', 'accepted', 'dismissed']) {
    assert.match(query, new RegExp(`'onboarding_surface_${action}'`), action);
  }
  for (const [surface, label] of [['ogs', 'OGS-App'], ['school', 'Schul-App'], ['parents', 'Eltern-App']]) {
    assert.ok(query.includes(`'${surface}', '${label}'`), surface);
  }
  assert.ok(readOnboardingSurfaces().includes('notification_setup'), 'the browser filter allows the surface');
});

test('the entry dashboard counts self-opening surfaces from consenting browsers only, never as feature use', () => {
  const dashboard = definitions.find((d) => d.name === 'Nutzungsanalyse: Einstieg');
  assert.match(dashboard.description, /nur mit Einwilligung/);
  const perSurface = dashboard.insights.find((insight) => insight.name === 'Einstieg: je Fläche angezeigt, angenommen, geschlossen (nur mit Einwilligung)');
  const perSession = dashboard.insights.find((insight) => insight.name === 'Einstieg: Flächen pro erfasster Sitzung (nur mit Einwilligung)');
  assert.ok(perSurface && perSession, 'both tiles exist');
  for (const tile of [perSurface, perSession]) {
    assert.equal(tile.deployment, 'production');
    assert.match(tile.description, /nur mit Einwilligung/i, tile.name);
  }
  for (const action of ['shown', 'accepted', 'dismissed']) {
    assert.match(perSurface.query.source.query, new RegExp(`'onboarding_surface_${action}'`), action);
  }
  assert.match(perSession.query.source.query, /group by Sitzung/);
  assert.match(perSession.query.source.query, /uniq\(toString\(properties\.onboarding_surface\)\)/);

  // Every allowed surface of the browser filter has a German name on the tile.
  assert.deepEqual(Object.keys(ONBOARDING_SURFACE_LABELS).sort(), readOnboardingSurfaces().sort());
  assert.throws(() => readOnboardingSurfaces('const OTHER = 1;'), /ONBOARDING_SURFACES/);
  const query = perSurface.query.source.query;
  assert.match(query, /transform\(toString\(properties\.onboarding_surface\), \['/, 'transform takes arrays, not tuples');
  for (const [value, label] of Object.entries(ONBOARDING_SURFACE_LABELS)) {
    assert.ok(query.includes(`'${value}'`) && query.includes(`'${label}'`), value);
  }

  // Surface events and the install dialog's answers fall outside „Sonstiges“.
  const browserEvents = readBrowserEvents();
  const expression = featureExpression();
  const noFeature = expression.slice(expression.lastIndexOf("startsWith(event, 'demo_')"));
  for (const event of ['onboarding_surface_shown', 'onboarding_surface_accepted', 'onboarding_surface_dismissed', 'pwa_install_prompt_shown', 'pwa_install_prompt_accepted', 'pwa_install_prompt_dismissed']) {
    assert.ok(browserEvents.includes(event), `${event} passes the browser filter`);
    const byPrefix = event.startsWith('onboarding_') && noFeature.includes("startsWith(event, 'onboarding_')");
    assert.ok(byPrefix || noFeature.includes(`'${event}'`), `${event} is no feature use`);
  }
});

// Ankündigung (#7555): the server counts it for the school, also without
// consent, so its tile is the one entry tile without the consent mark.
test('the entry dashboard shows the announcement seen and closed from the server, never as feature use', () => {
  const dashboard = definitions.find((d) => d.name === 'Nutzungsanalyse: Einstieg');
  const tile = dashboard.insights.find((insight) => insight.name === 'Einstieg: Ankündigung gesehen und geschlossen');
  assert.ok(tile, 'the announcement tile exists');
  assert.equal(tile.deployment, 'production');
  assert.match(tile.description, /auch ohne Einwilligung/);
  const query = tile.query.source.query;
  for (const event of ['announcement_seen', 'announcement_dismissed']) {
    assert.match(query, new RegExp(`'${event}'`), event);
  }
  assert.doesNotMatch(query, /Geschlossen in Prozent/, 'bulk closing can include announcements not shown');
  assert.match(tile.description, /keinen Prozentwert/);
  assert.doesNotMatch(query, /distinct_id|person|\$session_id/, 'no person and no session');

  const expression = featureExpression();
  const noFeature = expression.slice(expression.lastIndexOf("startsWith(event, 'demo_')"));
  for (const event of ['announcement_seen', 'announcement_dismissed']) {
    assert.ok(noFeature.includes(`'${event}'`), `${event} is no feature use`);
  }
});

test('the entry dashboard counts the care worker\'s first steps from the server, never as feature use', () => {
  const dashboard = definitions.find((d) => d.name === 'Nutzungsanalyse: Einstieg');
  const hiding = dashboard.insights.find((insight) => insight.name === 'Einstieg: Erste Schritte der Betreuung abgeschlossen oder ausgeblendet (vom Server)');
  const perStep = dashboard.insights.find((insight) => insight.name === 'Einstieg: Erste Schritte der Betreuung je Schritt (vom Server)');
  assert.ok(hiding && perStep, 'both tiles exist');
  for (const tile of [hiding, perStep]) {
    assert.equal(tile.deployment, 'production');
    assert.match(tile.description, /auch ohne Einwilligung/, tile.name);
    assert.doesNotMatch(tile.query.source.query, /distinct_id|\$session_id|person/, `${tile.name} counts no people`);
  }
  assert.match(hiding.query.source.query, /'staff_first_steps_completed'/);
  assert.match(hiding.query.source.query, /'staff_first_steps_dismissed'/);
  for (const action of ['done', 'skipped', 'reopened']) {
    assert.match(perStep.query.source.query, new RegExp(`properties\\.action = '${action}'`), action);
  }

  // Every step of the checklist has a German name on the tile.
  const api = readFileSync(new URL('../frontend/src/lib/staff-onboarding-api.ts', import.meta.url), 'utf8');
  const keys = api.match(/STAFF_ONBOARDING_STEP_KEYS[^=]*=\s*\[([^\]]*)\]/)?.[1].match(/"[a-z_]+"/g).map((key) => key.slice(1, -1));
  assert.deepEqual(Object.keys(STAFF_FIRST_STEP_LABELS), keys);
  for (const [value, label] of Object.entries(STAFF_FIRST_STEP_LABELS)) {
    assert.ok(perStep.query.source.query.includes(`'${value}'`) && perStep.query.source.query.includes(`'${label}'`), value);
  }

  // The server events fall outside „Sonstiges“.
  const expression = featureExpression();
  const noFeature = expression.slice(expression.lastIndexOf("startsWith(event, 'demo_')"));
  for (const event of STAFF_FIRST_STEPS_EVENTS) {
    assert.ok(FEATURES.every((f) => !f.events?.includes(event)), event);
    assert.ok(noFeature.includes(`'${event}'`), `${event} is no feature use`);
  }
});

test('the entry dashboard shows the parents\' first steps from consenting browsers only, never as feature use', () => {
  const dashboard = definitions.find((d) => d.name === 'Nutzungsanalyse: Einstieg');
  const tile = dashboard.insights.find((insight) => insight.name === 'Einstieg: Erste Schritte der Eltern (nur mit Einwilligung)');
  assert.ok(tile, 'the tile exists');
  assert.equal(tile.deployment, 'production');
  assert.match(tile.description, /nur mit Einwilligung/i);
  const query = tile.query.source.query;
  for (const event of ['onboarding_checklist_step_done', 'onboarding_checklist_dismissed', 'onboarding_checklist_completed']) {
    assert.match(query, new RegExp(`'${event}'`), event);
  }
  assert.match(query, /properties\.onboarding_surface = 'parent_first_steps'/);
  assert.match(query, /properties\.checklist = 'parent_first_steps'/);
  assert.match(query, /properties\.surface = 'parents'/);

  // Every allowed step of the browser filter has a German name on the tile.
  assert.deepEqual(Object.keys(PARENT_FIRST_STEP_LABELS).sort(), readOnboardingChecklistSteps().sort());
  assert.throws(() => readOnboardingChecklistSteps('const OTHER = 1;'), /ONBOARDING_CHECKLIST_STEPS/);
  for (const [value, label] of Object.entries(PARENT_FIRST_STEP_LABELS)) {
    assert.ok(query.includes(`'${value}'`) && query.includes(`'${label}'`), value);
  }

  // The checklist events pass the browser filter and fall outside „Sonstiges“.
  const browserEvents = readBrowserEvents();
  const expression = featureExpression();
  const noFeature = expression.slice(expression.lastIndexOf("startsWith(event, 'demo_')"));
  for (const event of ['onboarding_checklist_step_done', 'onboarding_checklist_dismissed', 'onboarding_checklist_completed']) {
    assert.ok(browserEvents.includes(event), `${event} passes the browser filter`);
    assert.ok(noFeature.includes("startsWith(event, 'onboarding_')") || noFeature.includes(`'${event}'`), `${event} is no feature use`);
  }
});

test('the entry dashboard shows the setup checklist from the server: completed, dismissed and skipped steps', () => {
  const dashboard = definitions.find((d) => d.name === 'Nutzungsanalyse: Einstieg');
  const outcome = dashboard.insights.find((insight) => insight.name === 'Einrichtungs-Checkliste: abgeschlossen und ausgeblendet');
  const skipped = dashboard.insights.find((insight) => insight.name === 'Einrichtungs-Checkliste: übersprungene Schritte');
  assert.ok(outcome && skipped, 'both tiles exist');
  for (const tile of [outcome, skipped]) {
    assert.equal(tile.deployment, 'production');
    assert.match(tile.description, /auch ohne Einwilligung/, tile.name);
  }
  assert.match(outcome.query.source.query, /'onboarding_setup_checklist_completed'/);
  assert.match(outcome.query.source.query, /'onboarding_setup_checklist_dismissed'/);
  assert.match(outcome.query.source.query, /group by Schule_ID/, 'a rate per school, never per person');
  assert.match(outcome.query.source.query, /countIf\(HatAbgeschlossen = 1\)/, 'PostHog requires the UInt8 condition explicitly');
  assert.match(outcome.query.source.query, /countIf\(HatAusgeblendet = 1 and HatAbgeschlossen = 0\)/, 'PostHog requires the UInt8 condition explicitly');
  assert.match(outcome.query.source.query, /as HatAbgeschlossen/, 'the inner flag differs from the visible aggregate');
  assert.match(skipped.query.source.query, /'onboarding_setup_checklist_step_skipped'/);

  // Every step of the wizard (schoolsetup.StepKeys) has its German name on the tile.
  const wizard = readFileSync(new URL('../backend/modules/schoolsetup/schoolsetup.go', import.meta.url), 'utf8');
  const steps = [...wizard.matchAll(/^\s*Step\w+ StepKey = "(\w+)"/gm)].map((match) => match[1]);
  assert.ok(steps.length > 0, 'reads the step keys');
  assert.deepEqual(Object.keys(SETUP_CHECKLIST_STEP_LABELS).sort(), steps.sort());
  for (const [value, label] of Object.entries(SETUP_CHECKLIST_STEP_LABELS)) {
    assert.ok(skipped.query.source.query.includes(`'${value}'`) && skipped.query.source.query.includes(`'${label}'`), value);
  }

  // The server's checklist events are no feature use and stay out of „Sonstiges“.
  const expression = featureExpression();
  const noFeature = expression.slice(expression.lastIndexOf("startsWith(event, 'demo_')"));
  assert.ok(noFeature.includes("startsWith(event, 'onboarding_')"));
  for (const event of ['onboarding_setup_checklist_completed', 'onboarding_setup_checklist_dismissed', 'onboarding_setup_checklist_step_skipped']) {
    assert.ok(event.startsWith('onboarding_'), `${event} is no feature use`);
    assert.ok(FEATURES.every((feature) => !feature.events?.includes(event)), event);
  }
});

test('the rarely used page lists name every route template of their portal', () => {
  const ogs = insights.find((insight) => insight.name.startsWith('OGS-App: Welche Seiten öffnet'));
  const parents = insights.find((insight) => insight.name.startsWith('Eltern-App: Welche Seiten öffnet'));
  assert.match(ogs.query.source.query, /'\/students\/:id'/);
  assert.doesNotMatch(ogs.query.source.query, /'\/children\/:id'/);
  assert.match(parents.query.source.query, /'\/children\/:id'/);
});

test('page tables show the navigation name of a page', () => {
  const names = readPageNames();
  assert.equal(names.get('/students/search'), 'Alle Kinder');
  assert.equal(names.get('/home'), 'Startseite');
  assert.throws(() => readPageNames('const OTHER = 1;'), /href\/label/);
  const pages = insights.find((insight) => insight.name === 'OGS-App: Welche Seiten werden am meisten genutzt?');
  assert.match(pages.query.source.query, /'Alle Kinder'/);
  assert.match(pages.query.source.query, /\$prev_pageview_duration/);
});

test('a school counts as active through use, not through a failed login or a dead click', () => {
  const weekly = insights.find((insight) => insight.name === 'Aktive Schulen pro Woche');
  assert.match(JSON.stringify(weekly.query), /event != 'login_failed'/);
  const lastWeek = insights.find((insight) => insight.name === 'Standorte: mit Nutzung in den letzten 7 Tagen');
  assert.match(lastWeek.query.source.query, /uniqIf\(Schule, Nutzung\)/);
  assert.match(lastWeek.query.source.query, /event != 'login_failed'\) as Nutzung|event != 'login_failed' as Nutzung/);
  const oldCondition = "(event = '$pageview' or not startsWith(event, '$'))";
  for (const insight of insights.filter((i) => i.deployment === 'production')) {
    const query = JSON.stringify(insight.query);
    if (!query.includes(oldCondition)) continue;
    assert.match(query, /event != 'login_failed'/, `${insight.name}: use ACTIVE_USE`);
  }
});

test('every portal of a school has its own page, action, and friction tables', () => {
  for (const [dashboard, surface] of [['OGS-App', 'ogs'], ['Eltern-App', 'parents'], ['Schul-App', 'school']]) {
    const tiles = definitions.find((d) => d.name === `Nutzungsanalyse: ${dashboard}`).insights;
    for (const question of ['Welche Seiten werden am meisten genutzt?', 'Welche Seiten öffnet kaum jemand?']) {
      const tile = tiles.find((insight) => insight.name === `${dashboard}: ${question}`);
      assert.match(tile.query.source.query, new RegExp(`properties\\.surface = '${surface}'`), tile.name);
    }
    assert.ok(tiles.some((insight) => insight.name.startsWith(`${dashboard}: Wo klicken`)), dashboard);
  }
});

test('the caterer portal counts its core actions per school, since its browser sends nothing', () => {
  const tiles = definitions.find((d) => d.name === 'Nutzungsanalyse: Caterer-Portal').insights;
  const actions = tiles.find((insight) => insight.name === 'Caterer-Portal: Was tun Caterer?');
  assert.match(actions.query.source.query, /properties\.surface = 'caterer'/);
  assert.match(actions.query.source.query, /uniq\(concat\(toString\(properties\.school_id\), toString\(toDate\(timestamp\)\)\)\) as `Tage je Schule`/);
  const queries = JSON.stringify(tiles.map((insight) => insight.query));
  assert.ok(tiles.every((insight) => !/Seite|klicken/.test(insight.name)), 'the caterer portal has no page views');
  for (const event of ['caterer_invited', 'caterer_invite_accepted', 'caterer_supply_ended', 'meal_order_confirmed']) {
    assert.match(queries, new RegExp(`\\b${event}\\b`), event);
  }
  // The school's own link actions are a feature area; the caterer's own saves are no use by the school.
  assert.deepEqual(FEATURES.find((f) => f.name === 'Caterer-Anbindung').events, ['caterer_invited', 'caterer_supply_ended']);
  const expression = featureExpression();
  const noFeature = expression.slice(expression.lastIndexOf("startsWith(event, 'demo_')"));
  for (const event of ['caterer_invite_accepted', 'meal_order_confirmed']) {
    assert.ok(FEATURES.every((f) => !f.events?.includes(event)), event);
    assert.match(noFeature, new RegExp(`'${event}'`), `${event} is no feature use`);
  }
});

test('the caterer never makes its school look active, and its idempotent writes count once per school and day', () => {
  const school = definitions.filter((d) => d.name !== 'Nutzungsanalyse: Caterer-Portal' && !d.name.includes('Demo'));
  const notCaterer = "coalesce(properties.surface, '') != 'caterer'";
  let checked = 0;
  for (const insight of school.flatMap((d) => d.insights)) {
    const query = JSON.stringify(insight.query);
    // A scan of the schools' events (schoolDays, schoolFeatureEvents) or a
    // school's feature area filters its rows with SCHOOL_EVENT itself; ACTIVE_USE
    // in a column would not keep caterer rows out of the scan.
    if (/as Schule\b|school_id[^"]*'Sonstiges'/.test(query)) {
      checked++;
      assert.ok(query.includes(`isNotNull(properties.school_id) and ${notCaterer}`), `${insight.name}: the school scan leaves out the caterer`);
    } else if (/event != 'login_failed'/.test(query)) {
      checked++;
      assert.ok(query.includes(notCaterer), `${insight.name}: a caterer action is no use by the school`);
    } else {
      continue;
    }
    // Every events scan of a HogQL query that reads school_id leaves the caterer out itself.
    const source = insight.query.source;
    if (source.kind !== 'HogQLQuery') continue;
    for (const scan of source.query.split(/\bfrom events\b/).slice(1)) {
      const where = scan.split(/\bfrom events\b|\bgroup by\b|\) as /)[0];
      if (where.includes('school_id')) assert.ok(where.includes(notCaterer), `${insight.name}: an events scan counts the caterer`);
    }
  }
  assert.ok(checked >= 10, `${checked} school activity insights`);
  // Every other insight that reads school_id is bound to a school portal or to
  // events no caterer sends (kiosk bookings, a login with a school).
  const fixedSurface = /properties\.surface = '(ogs|parents|school)'/;
  const attendance = "event in ('student_checked_in', 'student_checked_out')";
  // featureExpression() names every portal itself; only a filter outside it binds the query.
  const features = JSON.stringify(featureExpression()).slice(1, -1);
  for (const insight of school.flatMap((d) => d.insights)) {
    const query = JSON.stringify(insight.query).replaceAll(features, '');
    if (!query.includes('school_id') || query.includes(notCaterer) || fixedSurface.test(query)) continue;
    const source = insight.query.source;
    assert.equal(source.kind, 'TrendsQuery', `${insight.name}: reads school_id without leaving out the caterer`);
    for (const step of source.series) {
      assert.ok(step.event === 'login_success' || step.properties?.some((p) => p.key === attendance),
        `${insight.name}: reads school_id without leaving out the caterer`);
    }
  }
  const tiles = definitions.find((d) => d.name === 'Nutzungsanalyse: Caterer-Portal').insights;
  const perSchool = tiles.find((insight) => insight.name.endsWith('je Schule (30 Tage)')).query.source.query;
  assert.match(perSchool, /uniq\(Tag\) as `Tage mit Bestätigung`/);
  assert.match(perSchool, /toDate\(timestamp\) as Tag/);
  assert.doesNotMatch(perSchool, /count\(\)/, 'repeated confirmations count once per day');
  assert.match(perSchool, /\ngroup by Schule\n/, 'two schools of the same name stay apart');
  assert.match(perSchool, /properties\.surface = 'caterer'/);
  // Only the table, keyed by school ID, splits by school; a name breakdown would merge namesakes.
  assert.ok(tiles.every((insight) => insight.query.source.breakdownFilter === undefined), 'no caterer chart breaks down by school name');
  for (const insight of tiles.filter((tile) => tile.query.kind === 'InsightVizNode')) {
    for (const step of insight.query.source.series) {
      assert.equal(step.math_hogql, 'uniq(concat(toString(properties.school_id), toString(toDate(timestamp))))', `${insight.name} ${step.event}`);
    }
  }
});

test('next pages count page changes from the start page, not people', () => {
  const ogs = insights.find((insight) => insight.name.startsWith('OGS-App: Wohin'));
  assert.match(ogs.query.source.query, /properties\.\$prev_pageview_pathname = '\/home'/);
  assert.match(ogs.query.source.query, /properties\.surface = 'ogs'/);
  assert.doesNotMatch(ogs.query.source.query, /session_id/);
});

test('friction tables link the heatmap and read rage clicks from the heatmap data', () => {
  const ogs = dashboards({ projectId: '4711' }).find((d) => d.name === 'Nutzungsanalyse: OGS-App');
  const table = ogs.insights.find((insight) => insight.name.startsWith('OGS-App: Wo klicken')).query.source.query;
  assert.match(table, /'https:\/\/eu\.posthog\.com\/project\/4711\/heatmaps\/new\?pageURL='/);
  assert.match(table, /'https:\/\/moto-app\.de'/);
  assert.match(table, /from heatmaps/);
  assert.match(table, /type = 'rageclick'/);
  assert.match(table, /properties\.surface in \('ogs'\)/);
});

test('friction tables find the sessions of a portal through its page views, not through every event', () => {
  const tables = insights.filter((insight) => / Wo klicken /.test(insight.name));
  assert.equal(tables.length, 4);
  for (const insight of tables) {
    const sessions = /session_id in \(\s*select \$session_id from events\s*where ([\s\S]*?)\n\s*\)/.exec(insight.query.source.query)?.[1];
    assert.ok(sessions, `${insight.name}: rage clicks are matched to the portal through the session`);
    assert.match(sessions, /^event = '\$pageview' and timestamp > now\(\) - interval 30 day\b/, insight.name);
    assert.match(sessions, /properties\.surface in \(/, insight.name);
  }
});

test('the client only calls the EU API and needs a key', async () => {
  assert.throws(() => posthogClient({ apiKey: '' }), /POSTHOG_PERSONAL_API_KEY/);
  const calls = [];
  const api = posthogClient({
    apiKey: 'test-key',
    request: async (url, init) => {
      calls.push({ url, init });
      return new Response('{"ok":true}', { status: 200 });
    },
  });
  await api('GET', '/api/projects/');
  assert.equal(calls[0].url, `${POSTHOG_HOST}/api/projects/`);
  assert.equal(POSTHOG_HOST, 'https://eu.posthog.com');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
});

const TIMEOUT_BODY = '{"type":"server_error","code":"error","detail":"Query has hit the max execution time before completing."}';

/** PostHog client whose query endpoint answers each call with the next status of `statuses`, then 200. */
function queryEndpoint(statuses, body = TIMEOUT_BODY) {
  const calls = [];
  const api = posthogClient({
    apiKey: 'test-key',
    request: async (url) => {
      calls.push(url);
      const status = statuses[calls.length - 1] ?? 200;
      return new Response(status === 200 ? '{"results":[[1]]}' : body, { status });
    },
  });
  return { api, calls };
}

const oneInsight = [{ name: 'D', insights: [{ name: 'Tabelle', query: { source: { kind: 'HogQLQuery', query: 'select 1' } } }] }];

test('check tries a query once more after PostHog hit its execution time limit', async () => {
  const endpoint = queryEndpoint([504]);
  const result = await check(endpoint.api, '1', oneInsight);
  assert.deepEqual(result, { log: ['ok   Tabelle: 1 rows (retried after a timeout)'], failed: false });
  assert.equal(endpoint.calls.length, 2);
});

test('check fails a query that times out twice and never retries other errors', async () => {
  const twice = queryEndpoint([504, 504, 200]);
  const timedOut = await check(twice.api, '1', oneInsight);
  assert.equal(timedOut.failed, true);
  assert.match(timedOut.log[0], /^FAIL Tabelle: PostHog POST \/api\/projects\/1\/query\/: 504 .*max execution time/);
  assert.equal(twice.calls.length, 2);

  for (const [status, body] of [[400, '{"detail":"Unknown column"}'], [504, 'Gateway Timeout'], [500, TIMEOUT_BODY]]) {
    const endpoint = queryEndpoint([status, 200], body);
    const result = await check(endpoint.api, '1', oneInsight);
    assert.equal(result.failed, true, `${status} ${body}`);
    assert.match(result.log[0], new RegExp(`^FAIL Tabelle: .*: ${status} `));
    assert.equal(endpoint.calls.length, 1, `${status} ${body} is not retried`);
  }
  assert.equal(isQueryTimeout(new Error('504 max execution time')), false, 'needs the HTTP status, not just the text');
});

/** In-memory PostHog: dashboards and insights, with the list endpoints. */
function fakePostHog() {
  const store = { dashboards: [], insights: [] };
  const writes = [];
  let nextId = 1;
  const api = async (method, path, body) => {
    const url = new URL(path, POSTHOG_HOST);
    const [, , , , kind, id] = url.pathname.split('/');
    const items = store[kind];
    if (method === 'GET') {
      const search = url.searchParams.get('search');
      return { next: null, results: structuredClone(search ? items.filter((item) => item.name.includes(search)) : items) };
    }
    writes.push(`${method} ${kind}`);
    if (method === 'POST') {
      const item = { id: nextId++, deleted: false, ...structuredClone(body) };
      items.push(item);
      return item;
    }
    const item = items.find((candidate) => String(candidate.id) === id);
    Object.assign(item, structuredClone(body));
    return item;
  };
  return { api, store, writes };
}

test('sync creates everything once and is idempotent', async () => {
  const posthog = fakePostHog();
  const first = await sync(posthog.api, '1', definitions);
  assert.equal(posthog.store.dashboards.length, definitions.length);
  assert.equal(posthog.store.insights.length, insights.length);
  assert.equal(first.length, definitions.length + insights.length);
  for (const dashboard of posthog.store.dashboards) {
    const expected = definitions.find((d) => d.name === dashboard.name).insights.length;
    assert.equal(posthog.store.insights.filter((i) => i.dashboards.includes(dashboard.id)).length, expected);
  }

  posthog.writes.length = 0;
  assert.deepEqual(await sync(posthog.api, '1', definitions), []);
  assert.deepEqual(posthog.writes, []);
});

test('sync updates a changed insight in place and puts it back on its dashboard', async () => {
  const posthog = fakePostHog();
  await sync(posthog.api, '1', definitions);
  const insight = posthog.store.insights[0];
  insight.query = { kind: 'HogQLQuery', query: 'select 1' };
  insight.dashboards = [];

  const log = await sync(posthog.api, '1', definitions);
  assert.deepEqual(log, [`update insight ${insight.name} (query.kind)`]);
  assert.equal(posthog.store.insights.length, insights.length);
  assert.deepEqual(insight.query, insights[0].query);
  assert.deepEqual(insight.dashboards, [posthog.store.dashboards[0].id]);
});

test('defaults PostHog adds to a stored query do not count as a change', () => {
  const expected = { kind: 'TrendsQuery', series: [{ event: 'x', math: 'total' }] };
  const stored = { kind: 'TrendsQuery', series: [{ event: 'x', math: 'total', name: 'x' }], version: 2 };
  assert.equal(missingPath(expected, stored), null);
  assert.equal(missingPath(expected, { ...stored, series: [] }), 'query.series');
  assert.equal(missingPath(expected, { ...stored, series: [{ event: 'y', math: 'total' }] }), 'query.series.0.event');
});

test('a dry run writes nothing', async () => {
  const posthog = fakePostHog();
  const log = await sync(posthog.api, '1', definitions, { dryRun: true });
  assert.equal(log.length, definitions.length + insights.length);
  assert.deepEqual(posthog.writes, []);
});

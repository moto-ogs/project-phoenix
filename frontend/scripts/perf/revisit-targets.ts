import type { Locator, Page } from "@playwright/test";
import type { RevisitFixture, RevisitRole } from "./revisit-access";
import type { Content, Marker } from "./revisit-content";

export interface Stop {
  content: Content;
  entry?: string;
  link: (page: Page) => Locator;
  selectContent?: (page: Page) => Promise<Content>;
  rememberHeading?: boolean;
  auditedRead?: RegExp;
  prepare?: (page: Page) => Promise<void>;
}
export interface Journey {
  role: RevisitRole;
  name: string;
  via: Stop;
  target: Stop;
  long?: Stop[];
  inPage?: boolean;
  initialSelection?: boolean;
  backVia?: Stop;
  keyboard?: boolean;
}
function href(path: string) {
  return (page: Page) =>
    page
      .locator(
        'a:not([inert] *)[href="' +
          path +
          '"],a:not([inert] *)[href^="' +
          path +
          '?"]',
      )
      .filter({ visible: true })
      .first();
}
function pageStop(
  path: string,
  criterion: string,
  markers: Marker[],
  link = href(path),
): Stop {
  return { content: { path, criterion, markers }, link };
}
const text = (css: string, text: string): Marker => ({ css, text });
const exact = (css: string, exact: string): Marker => ({ css, exact });
const css = (css: string): Marker => ({ css });
const section = (name: string) => (page: Page) =>
  page
    .locator('nav [data-setup-tour="nav-section-' + name + '"]')
    .filter({ visible: true })
    .first();
function flow(
  role: RevisitRole,
  name: string,
  via: Stop,
  target: Stop,
  pool: Stop[],
  keyboard = false,
): Journey {
  const others = pool.filter(
    (s) =>
      s.content.path !== via.content.path &&
      s.content.path !== target.content.path,
  );
  return { role, name, via, target, long: others.slice(0, 3), keyboard };
}
function tenant(role: "admin" | "betreuer", f: RevisitFixture): Journey[] {
  const home = pageStop("/home", "Datenzeile der Startkarte", [
    role === "admin"
      ? text('main a[href="/students/search"]', "Kinder anwesend\\s*[1-9]\\d*")
      : text("main span,main p", "\\d+ von \\d+ da"),
  ]);
  const children = pageStop("/students/search", "Öffnbare Kinderkarte", [
    css(
      'main button[data-setup-tour="student-card"]:not([aria-pressed]):not([data-checkin-mode])',
    ),
  ]);
  const rooms = pageStop("/rooms", "Raumkarte mit Kapazität", [
    text('main a[href^="/rooms/"]', "Kapazität:"),
  ]);
  const supervision = pageStop(
    "/active-supervisions",
    "Aktion im geladenen Aufsichtsraum",
    [exact("main button", "Raum verlassen")],
    section("supervisions"),
  );
  supervision.rememberHeading = true;
  const requests = pageStop(
    "/anfragen",
    "Anfragegruppe mit offener Anzahl oder bestätigter Leerzustand",
    [
      text(
        "main p,main span",
        "\\d+ offene Anfragen? ·|Keine offenen Anfragen",
      ),
    ],
  );
  const time = pageStop(
    "/time-tracking",
    "Geladene Wochensumme der Zeiterfassung",
    [text("main tr", "Summe KW")],
  );
  const plan = pageStop(
    "/betreuungsplan",
    "Belegte Planzeile mit Personenzahl",
    [text("main span", "\\d+\\s*P\\.")],
  );
  for (const [stop, key] of [
    [time, "team"],
    [plan, "planung"],
  ] as const) {
    stop.prepare = async (page) => {
      const toggle = page
        .locator(
          '[data-setup-tour="nav-group-' + key + '"][aria-expanded="false"]',
        )
        .filter({ visible: true })
        .first();
      if (await toggle.isVisible()) await toggle.click();
    };
  }
  const group = pageStop(
    "/ogs-groups",
    "Anwesenheitsliste der eigenen Gruppe",
    [
      css('main button[data-setup-tour="student-card"]'),
      text("main span", "von \\d+ da"),
    ],
  );
  group.rememberHeading = true;
  const groups = pageStop(
    "/ogs-groups/overview",
    "Öffnbare Gruppe in der Übersicht",
    [css('[aria-label="Gruppen"] a,[aria-label="Gruppen"] button')],
    section("groups"),
  );
  const pool = [home, rooms, children, time, supervision];
  const journeys = [
    flow(role, "kindersuche-" + role, home, children, pool),
    flow(
      role,
      "aufsicht-" + role,
      role === "admin" ? children : rooms,
      supervision,
      pool,
    ),
    flow(role, "zeit-" + role, home, time, pool),
  ];
  const student = pageStop(
    "/students/" + f.first.childId,
    "Zielkind und verfügbare Schnellaktionen in der Kinderakte",
    [
      exact("main h1,main h2", f.first.childName),
      css('main [aria-label="Schnellaktionen"]'),
    ],
    (page) =>
      page
        .locator('main button[data-setup-tour="student-card"]')
        .filter({
          has: page.getByRole("heading", {
            name: f.first.childName,
            exact: true,
          }),
        })
        .first(),
  );
  journeys.push(flow(role, "kinderakte-" + role, children, student, pool));
  const staffList = pageStop("/staff", "Öffnbare Karte der Betreuungsperson", [
    exact("main h3", f.staff.name),
  ]);
  staffList.prepare = time.prepare;
  const staffDetail = pageStop(
    "/staff/" + f.staff.id,
    "Gewählte Person mit geladenem Stundenkonto",
    [exact("main h1", f.staff.name), exact("main button", "Auszahlung")],
    (p) =>
      p.getByRole("button", {
        name: f.staff.name + " - Details öffnen",
        exact: true,
      }),
  );
  const roomDetail = pageStop(
    "/rooms/" + f.room.id,
    "Gewählter Raum mit Stammdaten und Anwesenheitsstand",
    [
      exact("main h1", f.room.name),
      text("main dd", "Hauptgebäude|Erdgeschoss|Normaler Raum"),
      css('main [aria-label="Kinder im Raum"]'),
    ],
  );
  const shift = pageStop(
    "/dienstplan",
    "Besetzte Dienstplanzeile der Betreuungsperson",
    [
      css('main button[aria-label="Aktionen für ' + f.staff.name + '"]'),
      css('main button[aria-label^="Schicht anlegen, "]'),
    ],
  );
  shift.prepare = plan.prepare;
  if (role === "admin")
    journeys.push(
      flow(role, "kindersuche-tastatur", home, children, pool, true),
      flow(role, "dienstplan-admin", home, shift, pool),
      flow(role, "team-person", staffList, staffDetail, pool),
      flow(role, "räume-raum", rooms, roomDetail, pool),
      flow(role, "anfragen-admin", children, requests, pool),
      flow(role, "plan-admin", home, plan, pool),
    );
  else
    journeys.push(
      {
        ...flow(
          role,
          "gruppe-kinderakte",
          {
            ...group,
            prepare: async (p) => {
              if (
                !(await p
                  .locator('nav a[href^="/ogs-groups?group="]:not([inert] *)')
                  .first()
                  .isVisible())
              )
                await section("groups")(p).click();
            },
            link: (p) =>
              p
                .locator('nav a[href^="/ogs-groups?group="]:not([inert] *)')
                .filter({ visible: true })
                .first(),
          },
          student,
          pool,
        ),
        backVia: home,
      },
      flow(
        role,
        "tagesplan-betreuer",
        home,
        pageStop(
          "/tagesplan",
          "Planblock des laufenden Betreuungstags mit Zeitraum und Raum",
          [text("main li", "[0-9]{2}:[0-9]{2}.*(Mittagessen|Lernzeit).*")],
        ),
        pool,
      ),
      flow(role, "gruppe-navigation", groups, group, pool),
      flow(
        role,
        "gruppe-startkarte",
        home,
        {
          ...group,
          link: (page) =>
            page.getByRole("link", { name: "Meine Gruppe heute: zur Gruppe" }),
        },
        pool,
      ),
      flow(role, "start-betreuer", rooms, home, pool),
      flow(role, "anfragen-betreuer", children, requests, pool),
    );
  if (role === "betreuer") {
    const planView = (name: string): Stop => ({
      ...plan,
      prepare: undefined,
      link: (p) => p.getByRole("button", { name, exact: true }),
      content: {
        ...plan.content,
        criterion:
          name === "Tag"
            ? "Aktive Tagesansicht mit den fachlich gleichen Terminblöcken wie nach der Tagesantwort"
            : "Aktive Wochenansicht mit belegtem Betreuungsblock",
        confirmTitles: name === "Tag" ? 'main button[title*=" – "]' : undefined,
        markers: [
          exact('button[aria-pressed="true"]', name),
          text("main button", "Frühbetreuung|Lernzeit Jahrgang"),
        ],
      },
    });
    journeys.push({
      role,
      name: "plan-betreuer",
      via: planView("Woche"),
      target: planView("Tag"),
      inPage: true,
    });
  } else {
    const hasLink = async (p: Page, path: string) => href(path)(p).isVisible();
    const absenceList = pageStop(
      "/absences",
      "Gemeldete Abwesenheit mit Zielkind in der Datenzeile",
      [css("main tbody tr td:nth-child(2)")],
      (p) =>
        href("/absences")(p)
          .or(p.getByRole("menuitem", { name: "Abwesenheiten", exact: true }))
          .first(),
    );
    absenceList.prepare = async (p) => {
      if (await hasLink(p, "/absences")) return;
      if (new URL(p.url()).pathname !== children.content.path)
        await children.link(p).click();
      await p
        .getByRole("button", { name: "Weitere Aktionen", exact: true })
        .click();
    };
    const firstAbsent = (p: Page) => p.locator("main tbody tr").first();
    const absentStudent = {
      ...student,
      link: firstAbsent,
      selectContent: async (p: Page) => {
        const label = await firstAbsent(p).locator("td").nth(1).innerText();
        const selected = f.students.find(
          (person) =>
            person.last_name + ", " + person.first_name === label.trim(),
        );
        if (!selected)
          throw new Error(
            "Abwesenheitszeile passt zu keinem Kind der Messfixture.",
          );
        return {
          ...student.content,
          path: "/students/" + selected.id,
          markers: [
            exact("main h1", selected.first_name + " " + selected.last_name),
            css('main [aria-label="Schnellaktionen"]'),
          ],
        };
      },
    };
    const stats = pageStop(
      "/statistics",
      "Anwesenheitsbericht mit geladener Datenzeile",
      [css("main tbody tr td:nth-child(2)")],
    );
    stats.prepare = async (p) => {
      if (!(await hasLink(p, "/statistics")))
        await p
          .getByRole("button", { name: "Verwaltung", exact: true })
          .click();
    };
    const statsChild = {
      ...student,
      prepare: async (p: Page) => {
        await p.getByRole("tab", { name: "Kinder", exact: true }).click();
      },
      link: href(student.content.path),
    };
    const filledRoom = {
      ...roomDetail,
      prepare: async (p: Page) => {
        if (
          !(await hasLink(p, roomDetail.content.path)) &&
          new URL(p.url()).pathname !== rooms.content.path
        )
          await rooms.link(p).click();
      },
    };
    const roomChildLink = (p: Page) =>
      p.getByRole("button", { name: / Profil öffnen$/ }).first();
    const roomStudent = {
      ...student,
      link: roomChildLink,
      selectContent: async (p: Page) => {
        const label = await roomChildLink(p).getAttribute("aria-label");
        const selected = f.students.find(
          (person) =>
            person.first_name + " " + person.last_name + " Profil öffnen" ===
            label,
        );
        if (!selected)
          throw new Error("Raumkarte passt zu keinem Kind der Messfixture.");
        return {
          ...student.content,
          path: "/students/" + selected.id,
          markers: [
            exact("main h1", selected.first_name + " " + selected.last_name),
            css('main [aria-label="Schnellaktionen"]'),
          ],
        };
      },
    };
    journeys.push(
      {
        ...flow(role, "abwesenheiten-kinderakte", absenceList, absentStudent, [
          home,
          rooms,
          children,
          time,
        ]),
        backVia: home,
      },
      {
        ...flow(role, "statistik-kinderakte", stats, statsChild, pool),
        backVia: home,
      },
      {
        ...flow(role, "raum-kinderakte", filledRoom, roomStudent, [
          home,
          children,
          rooms,
          time,
        ]),
        backVia: home,
      },
    );
  }
  return journeys;
}
export function revisitTargets(f: RevisitFixture): Journey[] {
  const journeys = [
    ...tenant("admin", f),
    ...tenant("betreuer", f),
    ...portals(f),
  ];
  for (const name of [
    "kindersuche-betreuer",
    "tagesübersicht-klasse",
    "übersicht-schule",
    "trägerliste-konten",
    "konto-bestellungen",
  ]) {
    const original = journeys.find((j) => j.name === name)!;
    journeys.push({ ...original, name: name + "-tastatur", keyboard: true });
  }
  return journeys;
}
export function parentStops(family: RevisitFixture["first"]) {
  const childPath = "/children/" + family.childId;
  const profileLink = css('main a[href="' + childPath + '"]');
  const home = pageStop(
    "/",
    "Öffnbare Profilkarte des Kindes dieses Elternkontos",
    [profileLink],
  );
  const child = pageStop(
    childPath,
    "Name des Zielkindes und dessen geladene, bedienbare Betreuungskarte",
    [
      exact("h1,h2,h3", family.childName),
      css('main a[href="/messages/' + family.childId + '"]'),
    ],
  );
  const list = pageStop(
    "/children",
    "Kinderauswahl mit Link zum Kind des angemeldeten Kontos",
    [profileLink],
  );
  return { home, child, list };
}
function portals(f: RevisitFixture): Journey[] {
  const { home, child, list } = parentStops(f.first);
  const messages = pageStop(
    "/messages",
    "Auswählbare Unterhaltung des ausgewählten Kindes",
    [css('main a[href="/messages/' + f.first.childId + '"]')],
  );
  const calendar = pageStop(
    "/calendar",
    "Bedienbarer Termin in der geladenen Terminliste",
    [css("main article button")],
  );
  const documents = pageStop(
    "/documents",
    "Dokumenteintrag oder bestätigter leerer Dokumentenordner",
    [
      text(
        "main li,main p,main h2,main h3",
        "herunterladen|keine Dokumente|keine Unterlagen",
      ),
    ],
  );
  const parents = [home, list, messages, calendar, documents];
  const closeAbsence = {
    ...child,
    link: (p: Page) =>
      p
        .getByRole("dialog", { name: "Abwesenheit melden" })
        .getByRole("button", { name: "Schließen", exact: true }),
  };
  const openAbsence = {
    ...child,
    link: (p: Page) => p.getByRole("button", { name: /abmelden Krank melden/ }),
    content: {
      ...child.content,
      criterion:
        "Abwesenheitsdialog für das ausgewählte Kind mit Tagesauswahl; keine Meldung wird versandt",
      markers: [
        css('[role="dialog"] [role="combobox"]'),
        text(
          '[role="dialog"] button',
          "Erster Tag|Krankmeldung an die OGS senden",
        ),
      ],
    },
  };
  const parentFlows: Journey[] = [
    {
      role: "parents",
      name: "kind-abwesenheitsdialog",
      via: closeAbsence,
      target: openAbsence,
      inPage: true,
    },
    {
      ...flow("parents", "start-nachrichten", home, messages, parents),
      long: [calendar, list, child],
    },
    flow("parents", "start-kind", home, child, parents),
    {
      ...flow("parents", "kind-start", child, home, parents),
      long: [messages, calendar, list],
    },
  ];

  const classLink = (page: Page) =>
    page
      .locator('a[href^="/klasse?klasse="]')
      .filter({ visible: true })
      .first();
  const school = pageStop("/", "Tagesübersicht mit Link zur Klasse", [
    css('main a[href^="/klasse?klasse="]'),
  ]);
  const klass = pageStop(
    "/klasse",
    "Geladene Kinderzeile der Zielklasse",
    [css('main a[href^="/klasse/kind?klasse=Klasse%201a&"]')],
    classLink,
  );
  klass.content.query = { klasse: "Klasse 1a" };
  klass.entry = "/klasse?klasse=Klasse%201a";
  const absences = pageStop(
    "/fehlzeiten",
    "Fehlzeiten der zugewiesenen Klasse",
    [css("main tbody tr td:nth-child(2)")],
  );
  const schCalendar = pageStop(
    "/kalender",
    "Öffnbare Datumszelle im Schulkalender",
    [
      text(
        "main p, main article",
        "Keine Einträge in dieser Woche|Elternsprechtag",
      ),
    ],
  );
  const notices = pageStop(
    "/tagesinformationen",
    "Hinweis der OGS oder bestätigter Leerzustand",
    [
      text(
        "main h2,main h3,main button",
        "Heute keine Hinweise|Zur Kenntnis nehmen",
      ),
    ],
  );
  const schoolMessages = pageStop(
    "/nachrichten",
    "Bestätigter leerer Posteingang oder auswählbare Unterhaltung",
    [text("main p,main a", "Noch keine Nachrichten|Unterhaltung öffnen")],
  );
  const noteLink = (p: Page) =>
    p.locator('main a[href^="/klasse/kind?klasse="]').first();
  const sharedNote = pageStop(
    "/klasse/kind",
    "Klassenkind mit freigegebenen Beobachtungen oder bestätigtem Leerzustand",
    [exact("main h2,main h3", "Beobachtungen der OGS")],
    noteLink,
  );
  sharedNote.auditedRead = /^\/api\/school\/class-day\/shared-notes\//;
  sharedNote.selectContent = async (p: Page) => {
    const url = new URL((await noteLink(p).getAttribute("href"))!, p.url());
    const student = f.students.find(
      (s) => String(s.id) === url.searchParams.get("kind"),
    );
    if (!student) throw new Error("Klassenzeile gehört nicht zur Messfixture.");
    return {
      ...sharedNote.content,
      query: Object.fromEntries(url.searchParams),
      markers: [
        ...sharedNote.content.markers,
        exact("main h1", student.first_name + " " + student.last_name),
        text("main p", "Die OGS hat diese Notizen für dich freigegeben"),
      ],
    };
  };
  const schoolPool = [school, absences, schCalendar, notices, schoolMessages];
  const detail = "/schulen/" + f.schoolId;
  const targetSchool = css('main a[href="' + detail + '"]');
  const overview = pageStop(
    "/uebersicht",
    "Zahlenzeile der Zielschule mit Detailverweis",
    [targetSchool],
  );
  const schoolDetail = pageStop(
    detail,
    "Name der Zielschule mit belegten Stammdaten",
    [
      exact("main h1,main h2,main dd,main span", f.schoolName),
      text("main p", "^\\d+$"),
      exact("main p", "Alle betreuten Kinder dieser Schule."),
    ],
  );
  const occupancy = pageStop(
    "/belegung",
    "Belegungszeile mit Link zur Zielschule",
    [targetSchool],
  );
  const comparison = pageStop(
    "/standortvergleich",
    "Standortzeile mit Zielschul-Link",
    [targetSchool],
  );
  const utilization = pageStop(
    "/auslastung",
    "Auslastungsdaten für die Zielschule",
    [text("main tr,main a,main li", f.schoolName)],
  );
  const directory = pageStop("/", "Öffnbare Schule im Standortverzeichnis", [
    targetSchool,
  ]);
  const holidays = pageStop(
    "/ferien",
    "Auswählbarer veröffentlichter Ferienzeitraum",
    [text("main tbody tr", "Veröffentlicht")],
  );
  const holiday = pageStop(
    "/ferien",
    "Gewählter Zeitraum mit bedienbarem Wochenformular",
    [css('main button[aria-label="Anmeldebeginn im Kalender auswählen"]')],
    (p) =>
      p.locator("main tbody tr").filter({ hasText: "Veröffentlicht" }).first(),
  );
  holiday.content.numericDetail = true;
  holiday.selectContent = async (p) => ({
    ...holiday.content,
    markers: [
      ...holiday.content.markers,
      exact(
        "main h1",
        await p
          .locator("main tbody tr")
          .filter({ hasText: "Veröffentlicht" })
          .first()
          .locator("td")
          .first()
          .innerText(),
      ),
    ],
  });
  const traegerPool = [overview, occupancy, comparison, utilization, directory];
  const orgs = pageStop(
    "/organizations",
    "Öffnbare Zeile der Seed-Organisation",
    [text("tbody tr", f.orgName)],
  );
  const org = pageStop(
    "/operator/organizations/" + f.orgSlug,
    "Name, Stammdaten und Kennzahlen der gewählten Organisation",
    [
      exact("main h1", f.orgName),
      exact("main button", "Bearbeiten"),
      text("main p", "^20[0-9]{2}$"),
    ],
    (page) => page.getByRole("row").filter({ hasText: f.orgName }).first(),
  );
  const schools = pageStop("/schools", "Schulliste mit Seed-Schule", [
    text("tbody tr", f.schoolName),
  ]);
  const accounts = pageStop("/accounts", "Geladene Kontozeile", [
    css("main tbody tr td:nth-child(2)"),
  ]);
  const caterers = pageStop(
    "/caterers",
    "Geladener Eintrag des Seed-Caterers",
    [text("main tr,main li", "Frischeküche")],
  );
  const operatorPool = [orgs, schools, accounts, caterers];
  // A partial failure still renders the school's row and the Summe header.
  // Only the loaded row ends in its numeric total (including a genuine zero).
  const schoolName = f.schoolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const orders = pageStop("/", "Bestellzahlen der belieferten Schule", [
    text("main tbody tr", `^${schoolName}\\s.*\\b\\d+$`),
    text("main th", "^Summe$"),
  ]);
  const account = pageStop(
    "/konto",
    "Bestätigte Anmeldeadresse und bedienbare Passwortaktion",
    [exact("main dd", f.caterer.email), exact("button", "Passwort ändern")],
  );
  account.prepare = async (page) => {
    await page.getByRole("button", { name: /Profilmenü/ }).click();
  };
  const period = (name: string) => ({
    ...orders,
    content: {
      ...orders.content,
      criterion: "Gewählter Zeitraum und zugehörige Tageszahlen der Schule",
      markers: [
        ...orders.content.markers,
        css(
          name === "Morgen"
            ? "thead tr:has(th:nth-child(3):last-child)"
            : "thead tr:has(th:nth-child(7):last-child)",
        ),
        exact('button[aria-pressed="true"]', name),
      ],
    },
    link: (page: Page) => page.getByRole("button", { name, exact: true }),
  });
  const toggleSchool = (expanded: boolean) => (page: Page) =>
    page.getByRole("button", {
      name: f.schoolName + (expanded ? " einklappen" : " ausklappen"),
      exact: true,
    });
  const collapsed = {
    ...orders,
    content: {
      ...orders.content,
      markers: [
        ...orders.content.markers,
        css('main button[aria-expanded="false"]'),
      ],
    },
    link: toggleSchool(true),
  };
  const expanded = {
    ...orders,
    content: {
      ...orders.content,
      criterion: "Aufgeklappte Schule mit geladenem Bestellstand je Tag",
      markers: [
        ...orders.content.markers,
        exact("main td,main th,main span", "Stand"),
      ],
    },
    link: toggleSchool(false),
  };
  return [
    ...parentFlows,
    flow("school", "tagesübersicht-klasse", school, klass, schoolPool),
    {
      ...flow("school", "klasse-kind", klass, sharedNote, [
        school,
        absences,
        schCalendar,
        schoolMessages,
      ]),
      long: [absences, schCalendar, school],
      backVia: school,
    },
    flow("school", "fehlzeiten-start", absences, school, schoolPool),
    flow("traeger", "schulen-ferien", directory, holidays, traegerPool),
    flow("traeger", "ferien-zeitraum", holidays, holiday, traegerPool),
    flow("traeger", "übersicht-schule", overview, schoolDetail, traegerPool),
    flow("traeger", "schulen-start", overview, directory, traegerPool),
    flow("traeger", "belegung-übersicht", occupancy, overview, traegerPool),
    flow("operator", "trägerliste-konten", orgs, accounts, [
      ...operatorPool,
      pageStop("/devices", "Registriertes Gerät der Zielschule", [
        text("tbody tr", f.schoolName),
      ]),
    ]),
    flow(
      "operator",
      "schulen-schuldetail",
      schools,
      pageStop(
        "/operator/organizations/" + f.orgSlug + "/schools/" + f.schoolSlug,
        "Gewählte Schule mit geladenen Kennzahlen und Verwaltung",
        [
          exact("main h1", f.schoolName),
          exact("main button", "Kinderkontingent"),
          text("main p", "^\\d+ von \\d+$"),
        ],
        (p) => p.getByRole("row").filter({ hasText: f.schoolName }).first(),
      ),
      operatorPool,
    ),
    flow("operator", "trägerliste-detail", orgs, org, operatorPool),
    flow("operator", "schulen-trägerliste", schools, orgs, [
      ...operatorPool,
      pageStop("/devices", "Registriertes Gerät der Zielschule", [
        text("tbody tr", f.schoolName),
      ]),
    ]),
    {
      role: "caterer",
      name: "bestellungen-konto",
      via: orders,
      target: account,
    },
    {
      role: "caterer",
      name: "konto-bestellungen",
      via: account,
      target: orders,
    },
    {
      role: "caterer",
      name: "schule-bestelldetail",
      via: collapsed,
      target: expanded,
      inPage: true,
    },
    {
      role: "caterer",
      name: "bestellungen-zeitraum",
      initialSelection: true,
      via: period("Diese Woche"),
      target: period("Morgen"),
      inPage: true,
    },
  ];
}

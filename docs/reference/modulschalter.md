# Modulschalter je Schule

**Stand:** 24.11.2026\
**Quelle für:** gebuchte Module einer Schule, Leistungskatalog Schleswig-Holstein 4.16. Entscheidungen: Kommentar vom 24.10.2026 in [#4812](https://github.com/moto-ogs/project-phoenix/issues/4812). Umsetzung der Grundlage: [#4892](https://github.com/moto-ogs/project-phoenix/issues/4892). Folge-Issues: Routen [#4893](https://github.com/moto-ogs/project-phoenix/issues/4893), Navigation [#4894](https://github.com/moto-ogs/project-phoenix/issues/4894), Jobs und Portale [#4895](https://github.com/moto-ogs/project-phoenix/issues/4895), Geräte [#4896](https://github.com/moto-ogs/project-phoenix/issues/4896), Träger-Portal [#6052](https://github.com/moto-ogs/project-phoenix/issues/6052).

moto Basis hat jede Schule. Dazu bucht eine Schule Zusatzmodule. Je Zusatzmodul gibt es einen Schalter je Schule, den nur das moto-Team im Operator-Portal umlegt. Schul-Admins sehen ihre Module lesend unter Einstellungen, Reiter „Module“.

## Regeln

- **Ebene: je Schule.** Die Schule bleibt der Mandant. Eine Vorgabe je Träger kommt erst mit [ADR 0086](../adr/0086-traeger-werte-liegen-zwischen-standard-und-schule.md) und ist nicht Teil dieser Liste. Das Träger-Portal reicht über die Schulen eines Trägers: Dort zählt ein Modul, sobald eine Schule des Trägers es gebucht hat (siehe „Träger-Portal“).
- **Bestandsschutz.** Jeder Modulschalter hat die Voreinstellung „gebucht“. Keine Schule verliert mit dem Deployment eine Funktion. Danach gleicht das moto-Team die Schalter an die Verträge an. Auch eine neu angelegte Schule startet mit allen Modulen; das moto-Team bestellt ab, was der Vertrag nicht enthält. #6052 hat diese Regel am 24.11.2026 geprüft und beibehalten: Das Anlegen einer Schule schreibt weiter keinen Schalter.
- **Abbestellen löscht keine Daten.** Ein abbestelltes Modul ist sofort ausgeblendet und gesperrt. Die Daten bleiben, bis ihre Löschfrist abläuft ([Löschfristen](loeschfristen.md)). Arbeitszeitnachweise bleiben nach § 16 Abs. 2 ArbZG zwei Jahre erhalten. Einen eigenen Nur-Lesen-Modus gibt es nicht.
- **Export nach Abbestellung.** Braucht eine Schule Daten eines abbestellten Moduls, bucht das moto-Team das Modul vorübergehend, die Schule exportiert, und das moto-Team bestellt wieder ab. Jede Änderung steht im Einstellungs-Audit.
- **Feinsteuerung bleibt.** Schul-Einstellungen wie `operations.meal_plan_enabled` oder `enrollment.enabled` schalten innerhalb eines Moduls. Eine Funktion ist nur sichtbar, wenn das Modul gebucht und die Einstellung an ist.
- **Keine Env-Fallbacks.** Die Schalter sind Einstellungen der Registry (`AccessOperatorManaged`, [ADR 0048](../adr/0048-loeschfristen-traegt-das-moto-team-je-schule-ein.md)). Sie werden über den Settings-Service gelesen.

## Modulliste

Die Liste steht im Code in `backend/modules/settings/records/modules.go`. Das Frontend spiegelt die Schlüssel in `frontend/src/lib/modules.ts`; ein Test hält beide gleich.

| Modul | Schlüssel | Einstellung | Setzt voraus | Gibt es in moto |
|---|---|---|---|---|
| NFC-Anwesenheit | `nfc_anwesenheit` | `module.nfc_anwesenheit` | Basis | ja |
| Mittagessen und Catering | `mittagessen` | `module.mittagessen` | Basis | ja |
| Eltern-App | `eltern_app` | `module.eltern_app` | Basis | ja |
| Online-Anmeldung | `online_anmeldung` | `module.online_anmeldung` | Basis | ja |
| Unterricht am Vormittag | `unterricht_vormittag` | `module.unterricht_vormittag` | Basis | ja |
| Dienstplan | `dienstplan` | `module.dienstplan` | Basis | ja |
| Zeiterfassung | `zeiterfassung` | `module.zeiterfassung` | Basis | ja |
| Personalakte | `personalakte` | `module.personalakte` | Basis | ja |
| Träger-Übersicht | `traeger_uebersicht` | `module.traeger_uebersicht` | Basis | ja, im Träger-Portal |
| Ferienbetreuung | `ferienbetreuung` | `module.ferienbetreuung` | Online-Anmeldung | ja, im Träger-Portal |
| Verträge und Dokumente | `vertraege` | `module.vertraege` | Basis | ja, im Träger-Portal |
| Elternbeiträge und Abrechnung | `elternbeitraege` | `module.elternbeitraege` | Verträge und Dokumente | ja, im Träger-Portal |

Seit #6052 gibt es jedes Modul der Liste. Kommt ein Modul dazu, das es noch nicht gibt (`Available: false` in der Modulliste), hat es trotzdem einen Schalter, der festhält, was die Schule gebucht hat. Eine Route darf ihm nicht gehören: Nichts würde sie sperren. `TestFullProductionRouterGolden` („only an offered module owns routes“) schlägt sonst an.

`module.nfc_anwesenheit` hat `attendance.nfc_enabled` abgelöst. Migration 1.15.501 hat für jede Schule den bisherigen Wert übernommen; eine Schule ohne Wert hatte NFC aus und behält es aus.

### Kinder ohne OGS-Platz

Kinder der Klasse ohne OGS-Platz als eigene Kinder (#4803, [ADR 0282](../adr/0282-kind-ohne-ogs-platz-ist-ein-kind-der-klasse-mit-eigenem-datensatz.md)) schaltet kein Modul frei, sondern die Einstellung `operations.children_without_care_place`. Das moto-Team setzt sie im Operator-Portal (Reiter „Module“). Ihre Voreinstellung ist aus, und sie wirkt nur bei gebuchtem Modul Unterricht am Vormittag. Ein Modulschalter allein reicht nicht, weil jeder Modulschalter auf „gebucht“ voreingestellt ist. Sobald beides an ist, werden die Klassenlisteneinträge der Schule zu Kindern ohne OGS-Platz. Ausschalten wandelt nichts zurück.

### Abhängigkeiten

- Ferienbetreuung setzt Online-Anmeldung voraus.
- Elternbeiträge und Abrechnung setzt Verträge und Dokumente voraus.
- Dienstplan setzt nur Basis voraus. Seit #4894 hängen `Dienstplan`, `Mein Dienstplan` und die Dienstarten nicht mehr an `timetable.enabled`, sondern am Modul Dienstplan.
- Der Reiter Arbeitszeitmodell gehört zu Zeiterfassung.
- Stempeln am Kiosk braucht Zeiterfassung und NFC-Anwesenheit. Das ist keine Abhängigkeit zwischen Schaltern: Beide Module bleiben einzeln buchbar, das Stempeln prüft beide (#4896).

Beim Schalten prüft moto beide Richtungen. Wer ein Modul ohne seine Voraussetzung bucht, bekommt `settings.module_requires`. Wer eine Voraussetzung abbestellt, die ein gebuchtes Modul braucht, bekommt `settings.module_required_by`. Zurücksetzen auf die Voreinstellung zählt als Buchen. Die Prüfung nimmt eine Sperre je Schule, damit zwei gleichzeitige Änderungen sich nicht gegenseitig übersehen.

## Leistungskatalog Schleswig-Holstein 4.1 bis 4.15

Katalogpunkt 4.16 fragt, ob sich die Funktionen 4.1 bis 4.15 modular hinzufügen und entfernen lassen ([#2899](https://github.com/moto-ogs/project-phoenix/issues/2899)). Jede Funktion gehört zu genau einem Modul oder zur Basis. Was Basis ist, kann eine Schule nicht abbestellen, weil moto ohne diese Funktion keine OGS führen kann.

| Katalog | Funktion | Zuordnung | Begründung |
|---|---|---|---|
| 4.1 | Digitale Elterneinwilligungen | Eltern-App | Eltern geben Einwilligungen im Elternportal ab. Einwilligungen im Anmeldeformular gehören zu Online-Anmeldung. |
| 4.2 | Kursangebote | Basis | AGs und Aktivitäten sind der Kern der Planung. Ohne sie gibt es keine Anwesenheit in Räumen. |
| 4.3 | Kursanmeldung und Zuweisung | Basis | Das Team weist Kinder Kursen zu. Die Anmeldung durch Eltern gehört zu Eltern-App. |
| 4.4 | Kursleistungsübersicht | Basis | Auswertung der Kurse aus Basis-Daten (gibt es noch nicht, #2891). |
| 4.5 | Anwesenheitsmanagement | Basis | Anwesenheit am Computer und Handy ist Basis. Erfassung mit Armband oder Karte am Tablet ist NFC-Anwesenheit. |
| 4.6 | Betreuungsmanagement | Basis | Kinder, Gruppen und Betreuungszeiten sind die Grundlage jeder anderen Funktion. |
| 4.7 | Abholmanagement | Basis | Abholzeiten und Abholberechtigte pflegt das Team. Änderungen durch Eltern gehören zu Eltern-App. |
| 4.8 | Dienst- und Einsatzplanung | Dienstplan | |
| 4.9 | Kalender | Basis | Termine und Schließtage braucht jede Planung. |
| 4.10 | Meldung bei Betreuungsausfällen | Eltern-App | Die Meldung erreicht Eltern über Elternportal und Push. |
| 4.11 | Dateiablage | Basis | Ablage des Teams ohne eigenes Modul im Modulkatalog. |
| 4.12 | Kommunikationsmodul | Eltern-App | Nachrichten und Elternbriefe an Eltern gehören zu Eltern-App. Der Team-Chat ist Basis. |
| 4.13 | Essen-Anmeldung | Mittagessen und Catering | |
| 4.14 | Abrechnungsfunktion | Elternbeiträge und Abrechnung | Im Träger-Portal: Abrechnungsläufe, Monatsbeiträge, Lastschrift und Export. |
| 4.15 | Weitergehendes Personalmanagement | Personalakte | Arbeitszeit und Urlaub gehören zu Zeiterfassung. |

## Schnittstelle für Routen, Jobs und Portale

Die Folge-Issues setzen auf diese Teile auf. Neue Module kommen nur über die Modulliste dazu.

**Backend, Paket `modules/settings` (vorhanden):**

- `settings.ModuleKey` und die Konstanten `settings.ModuleNFCAnwesenheit` bis `settings.ModuleElternbeitraege`; die Liste mit Namen und Voraussetzungen in `modules/settings/records` (`Modules()`, `LookupModule`, `ModuleDependents`).
- Je Modul die Einstellung `module.<schlüssel>`. Lesen heißt: `ResolveBool` des Settings-Service für die Schule der Anfrage, `ResolveBoolForTenant` außerhalb der Tenant-Middleware. Beide gehen über den Request-Cache, nie über eine Umgebungsvariable.
- `settings.ModuleSettingKeys()` für ein gebündeltes Lesen, `settings.BookedModules(readBool)` für die gebuchten Module aus einem schon geladenen Satz Einstellungen (so liest die Mandanten-Auflösung).

**Backend, Helfer `ModuleBooking` (seit #4893):**

- `settings.NewModuleBooking(reader)`; `reader` ist der Settings-Service (`ResolveBoolForTenant`). Ohne Reader liefert der Aufruf einen Fehler, die Komposition bricht ab.
- `RequireForTenant(ctx, tenantID, modules...)` liest in einer eigenen Tenant-Transaktion und über den Request-Cache. Das passt für die Routensperre vor der Transaktion der Anfrage ebenso wie für Scheduler, Login und Refresh der Portale und Geräte (#4895, #4896). In einer laufenden Admin-Transaktion schlägt dieser Aufruf fehl, sobald der Cache den Schalter nicht hält. Dort liest `ResolveManyForTenants` die Schalter aller Schulen in einer Abfrage (so `ParentChildReadsForBookedSchools`, #7967).
- `RequireForTenant` liefert `*settings.ModuleNotBookedError{TenantID, Module}` für das erste fehlende Modul. Ein Lesefehler bleibt ein Fehler und wird nie als „gebucht“ oder „nicht gebucht“ gewertet. Ein unbekannter Schlüssel ist ein Fehler (`settings.ErrUnknownModule`).
- Fehlercode `module.not_booked` (403, Klasse `permission`). `details.module` ist der Modulschlüssel, `details.module_label` der Name. Das Frontend erklärt damit den fehlenden Modulzustand (#4894).

**Frontend:**

- `booked_modules` in `/auth/tenant/resolve`: die gebuchten Schlüssel in Katalogreihenfolge, für jedes Teammitglied ohne `config:read`.
- `frontend/src/lib/modules.ts`: Typ `ModuleKey`, `MODULE_KEYS`, `moduleSettingKey`, `parseBookedModules`. Unbekannte Schlüssel fallen weg, eine fehlende Liste bucht nichts.
- `useBookedModules()` und `useModuleBooked(module)` aus `~/lib/tenant-context`. Ohne Mandantendaten ist nichts gebucht. `useNFCEnabled()` folgt dem Modul NFC-Anwesenheit.
- Eine Änderung eines Modulschalters leert den Cache der Mandantendaten sofort (`TENANT_RESOLVE_AFFECTING_KEYS`).

## Navigation, Kacheln und erklärender Zustand (#4894)

Das Modul-Register `frontend/src/lib/module-register.ts` ordnet jede Seite der Mitarbeiter-Navigation, jeden Bereich der Seitenleiste, jeden Baustein der Startseite und jeden Reiter der Personalakte einem Modul oder der Basis zu. Seitenleiste, mobile Navigation, Startseite, Datenverwaltung und die Personalakte lesen nur dieses Register; `module-register.test.ts` schlägt an, wenn eine Seite oder ein Baustein fehlt.

- **Darstellung C.** Wer die Schule leitet (Adminzuschnitt oder `config:manage`), sieht den Eintrag eines nicht gebuchten Moduls mit Schloss. Der Eintrag führt auf die Seite. Alle anderen sehen ihn nicht. Die Reiter unten in der mobilen Navigation zeigen nur offene Seiten; ein Eintrag mit Schloss steht im Mehr-Menü.
- **Feinsteuerung.** Schul-Einstellungen wie `operations.meal_plan_enabled` oder `timetable.enabled` gelten nur bei gebuchtem Modul. Bei nicht gebuchtem Modul sieht die Leitung das Schloss, auch wenn die Einstellung aus ist.
- **Startseite und Reiter.** Bausteine und Reiter der Personalakte eines nicht gebuchten Moduls fehlen für alle, ohne Schloss: eine Kachel ohne Daten belegt nur Platz, und die Leitung sieht das Modul in der Navigation und unter Einstellungen.
- **Erklärender Zustand.** `TenantPage`, das Gerüst jeder Seite, zeigt auf jeder Seite eines nicht gebuchten Moduls statt des Inhalts, zu welchem Modul sie gehört und wer handelt: die Leitung das moto-Team, alle anderen ihre Leitung. Lehnt eine Anfrage mit `module.not_booked` ab, zeigen `TenantPage`, `LoadErrorAlert` und `FormErrorAlert` denselben Zustand als Hinweis statt als Fehler, und die Mandantendaten laden neu.
- **Bewusste Abweichung vom Backend.** Aktivitäten (`/activities`, `/database/activities`) gehören im Register zu NFC-Anwesenheit, weil sie vor den Modulen nur mit NFC zu sehen waren. Geräte (`/database/devices`) folgen NFC-Anwesenheit wie im Backend.

## Routen

Seit #4893 gehört jede Route des Produktions-Routers genau einem Modul oder der Basis. Die Zuordnung steht in `backend/api/module_routes.go` (`moduleRouteRules`), die ganze Liste in `backend/api/testdata/route_modules.golden`.

- **Regeln nach Pfad.** Eine Regel nennt einen Pfadanfang und ein Modul. Die genaueste Regel gewinnt. `*` steht für genau einen Pfadteil, etwa eine ID. Es gibt keine Regel für alles: Eine Route unter einem neuen Pfadanfang lässt `TestFullProductionRouterGolden` scheitern, bis eine Regel sie zuordnet.
- **Sperre.** Ein Router-weiter Schritt ordnet jede Anfrage nach diesen Regeln ein. `api.TenantScopeMiddleware` prüft nach dem Binden der Schule, ob das Modul gebucht ist, und antwortet sonst mit 403 `module.not_booked`. Basis-Routen und das Operator-Portal sind nicht betroffen. Ein Plattform-Token ohne Schule läuft durch.
- **Kosten.** Die Prüfung liest den Schalter in einer eigenen kurzen Lesetransaktion vor der Transaktion der Anfrage. Der Budget-Test der Anmeldungs-Rückläufe hält diese Form fest (genau ein Select des Schalters), das Budget der Route selbst bleibt unverändert.
- **Öffentliche Anmeldung.** Die öffentlichen Routen lösen die Schule über den Pfad auf, nicht über eine Sitzung. `enrollment.enabled` gilt dort nur, wenn das Modul Online-Anmeldung gebucht ist. Phasenliste, Formular, Uploads und Absenden antworten dann mit `enrollment.disabled`. Formularaufbau, Angebotsliste, Rechtstexte und Captcha einer Phase enthalten keine Personendaten und bleiben lesbar. Auch der Statuslink einer abgeschickten Anmeldung schließt sich und antwortet wie ein abgelaufener Link. So erfährt die Familie nichts über den Vertrag der Schule. Die Anmeldung bleibt gespeichert; nach erneutem Buchen gilt der Link wieder.
- **Download des Lohnbüros (#4805).** `/public/payroll-download` ist Basis. Der Link holt eine Datei ab, die schon verschickt ist; einen Versand legt nur der Monatsabschluss einer Schule mit Zeiterfassung an. Der Link nennt die Schule, die Abfrage läuft in ihrer Transaktion.
- **Träger-Portal.** `api.TraegerScopeMiddleware` sperrt die Routen der vier Träger-Module nach dem Binden des Trägers, siehe „Träger-Portal“.
- **Portale.** Elternportal und Schulportal sperrt #4895 an der Sitzung, siehe unten. Geräte sperrt seit #4896 eine eigene Sperre hinter der Geräte-Anmeldung, siehe „Geräte und PyrePortal“. Welche Flächen anderswo gesperrt werden, steht in `moduleRoutesLockedElsewhere`; der Golden-Test verlangt für jede andere Modulroute die Sperre.

## Träger-Portal (#6052)

Träger-Übersicht, Ferienbetreuung, Verträge und Dokumente und Elternbeiträge und Abrechnung liegen im Träger-Portal (`/traeger/...`). Dessen Sitzung gehört einem Träger, nicht einer Schule.

- **Ein Modul zählt für den Träger, sobald eine seiner Schulen es gebucht hat.** Die Schalter bleiben je Schule. Dieselbe Regel gilt im Elternportal (offen, solange eine Schule Eltern-App bucht) und seit #7177 bei den fehlenden Angaben des Trägers. Ferienzeiträume, Abrechnungsläufe und Verträge sind Objekte des ganzen Trägers; innerhalb einer Funktion wird nicht je Schule gefiltert. Das moto-Team bucht ein Träger-Modul deshalb einheitlich für alle Schulen eines Trägers. Eine Vorgabe je Träger folgt mit ADR 0086.
- **Sperre.** Der Router-weite Schritt ordnet die Anfrage ein, `api.TraegerScopeMiddleware` prüft nach dem Binden des Trägers (`requireTraegerModule` in `backend/api/module_traeger_booking.go`). Bucht keine Schule das Modul, antwortet die Route mit 403 `module.not_booked`, `details.module` und `details.module_label`. Ein Träger ohne Schulen hat nichts gebucht. Ein deaktivierter oder gelöschter Träger bekommt 401 wie beim Rahmen des Portals. Ein Lesefehler ist ein Serverfehler, nie eine Buchungsentscheidung. Fehlt beim Start eine der beiden Quellen, bricht die Komposition ab.
- **Kosten.** Die Prüfung liest vor der Träger-Transaktion in eigenen administrativen Lesungen erst die Schulen des Trägers, dann gebündelt die Schalter aller Schulen (`settings.TraegerModuleBooking` über `ResolveManyForTenants`). Die Zahl der Abfragen hängt nicht von der Zahl der Schulen ab. Die Träger-Routen haben keinen Request-Cache der Einstellungen, jede Modulroute liest also neu; Basis-Routen lesen nichts.
- **Rahmen des Portals.** `GET /traeger/organization/` nennt in `booked_modules` die Module, die für den Träger zählen. Das Portal sperrt damit Navigation und Seiten. Eine Antwort ohne Liste bucht nichts. Solange der Rahmen lädt oder nicht lesbar ist, zeigt das Portal alles offen und ohne Schloss: Die Sperre selbst sitzt im Backend, und kein Eintrag soll kurz verschwinden. Lehnt das Backend eine Anfrage mit `module.not_booked` ab, lädt das Portal den Rahmen neu.
- **Basis im Träger-Portal:** Anmeldung, Mitglieder, Schulliste und Schulansicht, Einstellungen und Stammdaten (auch Bankverbindungen und Dokumentvorlagen), Dokumente des Trägers, Schließtage, Anmeldephasen, Personal, Hinweise und die fehlenden Angaben. Zu den Schließtagen gehört auch die Benachrichtigung der Familien, deren Ferienbuchung ein neuer Schließtag trifft (`/traeger/holiday-closures`): Diese Familien haben gebucht und müssen es erfahren, auch wenn die Ferienbetreuung inzwischen abbestellt ist.
- **Öffentliche Ferienanmeldung.** Der Link trägt keine Sitzung. `holidayTraegerDirectory` löst den Träger des Links auf und antwortet ohne Ferienbetreuung wie bei einem abgelaufenen Link. Das gilt für Formular, Beitragsauskunft (`/traeger/holiday-quotes`), Statuslink und die Vorbelegung im Elternportal. Die PDFs eines Zeitraums bleiben lesbar (keine Personendaten). Die Ausnahme in `moduleRoutesLockedElsewhere` gilt für den ganzen Pfadanfang `/traeger/holiday-registrations`: Dort liegen nur die öffentlichen Routen des Links, eine Route des Büros gehört nicht dorthin.
- **Was schon verschickt ist, bleibt erreichbar.** Der Link zum Unterschreiben eines Vertrags (`/public/care-contract-signing`), die Dokumente im Elternportal und die Jobs `care-contract-conclusion`, `care-contract-reminders` und `holiday-closure-*` bleiben Basis: Sie schließen ab, was das Träger-Büro mit gebuchtem Modul begonnen hat. Neues beginnt nur über die gesperrten Routen des Büros. Mails des Trägers tragen keine Schule und laufen deshalb nicht durch die Sperre je Schule.
- **Schule liest weiter.** `/api/care-contracts` (Verträge aus den Anmeldungen der Schule), `/api/holiday-weeks`, `/api/holiday-guests` und `/api/traeger-documents` folgen nicht den Träger-Modulen: Die Schule, die ein Kind betreut, braucht diese Angaben, egal welche Schule des Trägers das Modul bucht.

| Bereich im Träger-Portal | Routen unter `/traeger` | Modul |
|---|---|---|
| Dashboard, Belegung, Auslastung, Ankunft und Abholung, Standortvergleich, Tagesmeldung | `schools/alerts`, `schools/occupancy`, `schools/utilization`, `schools/{id}/utilization`, `schools/arrival-pickup-times`, `schools/comparison`, `schools/daily-attendance` | Träger-Übersicht |
| Berichte, Länger als gebucht | `reports`, `report-templates`, `care-time-overruns` | Träger-Übersicht |
| Ferienbetreuung | `holiday-periods`, `holiday-contributions`, öffentlich `holiday-registrations`, `holiday-quotes` | Ferienbetreuung |
| Verträge | `contracts`, `contract-templates`, `contract-notices`, `contract-imports`, `contract-corrections`, `contract-child-links`, `contract-enrollments`, `contract-changes` | Verträge und Dokumente |
| Abrechnungsläufe, Familien und Zahlung, Preise und Ermäßigungen, Abrechnungsvorgaben, Dokumentarten | `billing-*`, `number-ranges`, `family-billing`, `family-children`, `contribution-rules`, `cost-bearers`, `care-billing-runs`, `care-tariffs`, `care-meal-tariffs`, `care-rules`, `care-evidences`, `care-cost-shares`, `care-notice-runs`, `sepa-*`, `finance-exports`, `finance-handovers`, `export-recipient` | Elternbeiträge und Abrechnung |

Grenzfälle: „Länger als gebucht“ ist eine Auswertung hinter dem Recht „Berichte lesen“ und gehört deshalb zur Träger-Übersicht, nicht zu den Verträgen. Die Regeln des Ferienbeitrags (`contribution-rules`) stehen bei den Abrechnungsvorgaben hinter dem Recht „Abrechnung“ und gehören zu Elternbeiträge und Abrechnung; was eine einzelne Ferienanmeldung kostet (`holiday-contributions`), gehört zur Ferienbetreuung. Die Seite „Abrechnungsvorgaben“ zeigt die Bankverbindungen immer und erklärt ohne das Modul nur ihren Abrechnungsteil. Auf einem Vertrag fehlen ohne Elternbeiträge und Abrechnung die Karten „Empfänger und Zahlung“ und „SEPA-Lastschriftmandat“.

**Frontend.** Das Register `frontend/src/lib/traeger-modules.ts` ordnet jede Seite des Träger-Portals einem Modul oder der Basis zu. Wer das Träger-Büro leitet (Recht „Mitglieder und Rollen“), sieht die Einträge eines nicht gebuchten Moduls mit Schloss, alle anderen sehen sie nicht (Darstellung C wie im Team-Portal). Die Seite zeigt statt des Inhalts, zu welchem moto-Modul sie gehört und wer handelt. Im Träger-Portal heißt es „moto-Modul“, weil „Modul“ dort auch die Betreuungsmodule eines Vertrags meint. Das Dashboard ist das Startziel: Ohne Träger-Übersicht fehlt sein Eintrag für alle, und die Schulliste ist das Startziel. Unter Einstellungen, „moto-Module“ steht der Stand der vier Module.

## Geräte und PyrePortal (#4896)

Geräte haben keine Sitzung, deshalb sperrt nicht `TenantScopeMiddleware`, sondern `gateDeviceAuthentication` in `backend/api/module_booking_gate.go`. Die Sperre sitzt hinter jeder Geräte-Anmeldung, also erst nach geprüftem Geräteschlüssel und PIN. Nur ein echtes Gerät erfährt, was die Schule gebucht hat.

- **Jede Kiosk-Route braucht NFC-Anwesenheit:** Scannen, Aktivitäten, Anmeldung mit der Geräte-PIN, Gerätedaten, Fehlerberichte und Armband zuordnen am Tablet (`/api/students/{id}/rfid`).
- **Stempeln am Kiosk** (`/api/iot/staff-clock`, `.../state`) braucht zusätzlich Zeiterfassung. Fehlt NFC-Anwesenheit, nennt die Antwort NFC-Anwesenheit; sonst Zeiterfassung. Ohne Zeiterfassung bleibt die Anwesenheit am Kiosk offen.
- **Antwort:** 403 `module.not_booked` wie bei den übrigen Routen, mit `details.module` und `details.module_label`. PyrePortal zeigt dazu einen eigenen Hinweis: bei NFC-Anwesenheit schon bei der Anmeldung mit der PIN, bei Zeiterfassung beim Stempeln.
- **Geräteverwaltung im Team-Portal** (`/api/iot/...` mit Sitzung) sperrt `TenantScopeMiddleware` wie jede Modulroute. Das Operator-Portal verwaltet Geräte weiter für jede Schule.

Backend und PyrePortal gehören zusammen ausgerollt: Ein altes PyrePortal zeigt die Sperre nur mit dem allgemeinen Text „Das ist hier nicht erlaubt“.

## Jobs, Portale, E-Mail und Push (#4895)

### Hintergrundjobs

`workerJobScopes` in `backend/modules/schedulerruntime/internal/application/job_modules.go` ordnet jeden Job des Workers einem Modul, der Basis oder der Aufbewahrung zu. `TestEveryWorkerJobHasAScope` schlägt an, wenn ein neuer Job fehlt. Ein Job eines Moduls überspringt jede Schule, die das Modul nicht gebucht hat. Jobs über `forEachTenantSettings` lesen den Schalter aus dem Einstellungs-Schnappschuss der Minute (`schedulerPollingSettingKeys`) ohne zusätzliche Abfrage; `break-auto-end` und `booking-consistency-audit` laufen über `forEachTenant` und lesen ihn in der Tenant-Transaktion der Schule. Ein unlesbarer Schalter zählt die Schule als fehlgeschlagen, der nächste Lauf versucht es erneut. Eine übersprungene Schule gilt für den Lauf als erledigt: Erinnerungen, die fällig wurden, während das Modul abbestellt war, holt der Job nach erneutem Buchen nicht nach.

| Job | Zuordnung |
|---|---|
| `break-auto-end`, `auto-checkout` | Zeiterfassung |
| `appointment-reminders`, `announcement-reminders` | Eltern-App (Erinnerungen an Eltern) |
| `rollover-deadline` | Online-Anmeldung (Fristen der Rückmeldephasen) |
| `visit-cleanup`, `timetable-cleanup`, `time-tracking-cleanup`, `student-change-log-cleanup`, `pwa-usage-cleanup`, `staff-message-cleanup`, `token-cleanup`, `staff-document-file-cleanup`, `student-document-file-cleanup`, `file-store-cleanup` | Aufbewahrung, läuft immer |
| alle übrigen, auch `reminder-notifications` (Abholung und Aktivitäten für das Team), `email-outbox` und `holiday-guest-reconciliation` (Feriengäste der ausrichtenden OGS, #4666) | Basis |

Die Bereinigungsbefehle `cleanup …` in `backend/cmd/cleanup.go` sind Aufbewahrung oder Basis (`cleanupCommandScopes`, geprüft von `TestEveryCleanupCommandHasAScope`). Das moto-Team ruft sie von Hand für alle Schulen auf.

Einen Hintergrundjob für den Versand ans Lohnbüro oder für Essensfristen gibt es nicht. Der Versand ans Lohnbüro läuft beim Export (`/api/time-tracking/...`, Zeiterfassung, seit #4893 gesperrt); `exporttransfer`-Wiederherstellung im Worker schließt nur unklare Übertragungen ab und sendet nichts. Essensfristen prüft der Speiseplan beim Ändern der Teilnahme; diese Wege sind mit dem Modul Mittagessen gesperrt.

### Elternportal

Das Elternportal gehört zum Modul Eltern-App. Es reicht über Schulen hinweg, deshalb sperrt es das Konto, nicht eine Schule: Es bleibt offen, solange mindestens eine Schule mit der Eltern-Rolle des Kontos Eltern-App gebucht hat.

- **Login** (`/parent/auth/login`, auch der Demo-Zugang `/access/sessions`) stellt sonst keine Sitzung aus und antwortet mit 403 `module.not_booked`, `details.module = eltern_app`. Die Sitzung wird an die erste Schule mit gebuchtem Modul gebunden.
- **Refresh** (`/auth/refresh`) erneuert sonst keine Sitzung, mit derselben Antwort. Das Backend lässt den vorgelegten Refresh-Token unberührt. Das Frontend wertet jede 403 beim Refresh als Ende der Sitzung; die nächste Anmeldung erklärt dann den Zustand.
- **Laufende Anfragen**: `ParentScopeMiddleware` prüft jede Anfrage an `/parent/*`, `/parent-sse` und `/parent-news-attachments` (Gastgeber: die Root mit `ListGuardianSchoolIDs` und `ModuleBooking`). So endet eine offene Sitzung sofort, nicht erst mit dem Ablauf des Zugangstokens.
- **Einladung annehmen** (`/auth/guardian-invitations/{token}`) legt nur das Konto an und stellt keine Sitzung aus; der Login danach sperrt. Das Wiederversenden durch das Team (`.../{id}/resend`) ist eine Route der Eltern-App und mit #4893 gesperrt.
- **Anmeldung im Elternportal** (`/parent/enrollments/...`) braucht zusätzlich Online-Anmeldung der Zielschule: `enrollment.enabled` zählt nur bei gebuchtem Modul. Die Liste der Anmeldungen und der Schulen zum Anmelden folgt Online-Anmeldung, nicht Eltern-App.
- **Zwei Schulen**: Eltern mit Kindern an zwei Schulen, von denen nur eine Eltern-App gebucht hat, behalten das Portal. Die Kinder der anderen Schule blendet es aus (`ParentChildReadsForBookedSchools` in `roots/owners`): Kinderliste, Nachrichten, Elternbriefe und jeder Weg zu einem einzelnen Kind lesen die Kinder dort. Ein Kind einer solchen Schule gilt für das Portal als nicht verknüpft. Der Kalender der Eltern liest seine Termine über den Kalender der Schule, nicht über diese Kinderliste; neue Termine an Eltern verschickt eine Schule ohne Eltern-App nicht (siehe E-Mail und Push).

### Schulportal

moto schule gehört zum Modul Unterricht am Vormittag und ist an eine Schule gebunden.

- **Login, zweiter Faktor und Schulwechsel** (`/school/auth/*`) prüfen das Modul in Identity & Access vor jeder Sitzung, beim Login schon vor dem Versand des Codes. Antwort: 403 `module.not_booked`, `details.module = unterricht_vormittag`.
- **Refresh** erneuert die Sitzung nicht; wie im Elternportal endet die Sitzung im Frontend.
- **Laufende Anfragen**: `SchoolScopeMiddleware` sperrt jede Route unter `/school` und `/school-sse` wie `TenantScopeMiddleware` die Team-Routen. Der Golden-Test verlangt eine der beiden Sperren für jede Modulroute.

Das Frontend erklärt beides statt einer Fehlerseite: Die Login-Seiten zeigen einen Hinweis (Eltern in ihrer Sprache, `frontend/src/lib/portal-not-booked.ts`), und eine abgelehnte Anfrage einer offenen Sitzung zeigt denselben Satz (`ModulePortalProvider` in beiden Portalen).

### E-Mail und Push

- **Push**: Der Benachrichtigungs-Router prüft jede Mitteilung vor allen Kanälen. Eine Mitteilung an Eltern (`ScopeGuardian`) braucht Eltern-App, sonst antwortet er `ErrDisabled`, das jeder Erzeuger schon als stilles Nein behandelt. Geräte von moto schule bekommen nur bei gebuchtem Unterricht am Vormittag etwas; das Team-Portal bekommt seine Mitteilung trotzdem.
- **Bereits eingereiht**: Der Versand des Outbox-Workers fragt vor jeder E-Mail und jedem Push `Deliverable` (`roots/owners/delivery_module_gate.go`). E-Mails an Eltern (Elternbriefe, Nachrichten, Termine, Einladung, Willkommen) gehören zu Eltern-App, E-Mails der Anmeldung zu Online-Anmeldung. Jede Mail-Art des Workers muss einem Modul oder der Basis zugeordnet sein, sonst startet er nicht (`requireClassified`). Pushes an das Elternportal zu Eltern-App, an moto schule zu Unterricht am Vormittag. Ein Auftrag eines abbestellten Moduls wird abgebrochen, nicht später nachgeholt. Ein unlesbarer Schalter versucht es erneut.
- Alle übrigen E-Mails (Anmeldecodes, Passwort, Einladungen des Teams, Abwesenheiten des Personals) sind Basis.

### Grenzfälle

| Route | Zuordnung | Begründung |
|---|---|---|
| `/api/meal-caterer`, `/caterer` | Mittagessen und Catering | Die Schule verwaltet ihren Caterer in ihrer Mandanten-Sitzung. Das Caterer-Portal hat eine schulübergreifende Sitzung; seine Modulsperre folgt mit den übrigen Portalen in #4895. Der Zugriff je Schule verlangt weiterhin eine Belieferung. |
| `/api/guardians/...` | Basis | Erziehungsberechtigte und Abholberechtigte braucht jede Schule. |
| `/api/guardians/invitations`, `invitable`, `bulk-invite`, `without-account`, `.../invite` | Eltern-App | Einladungen gibt es nur für das Elternportal. |
| `/api/guardians/payment-overview`, `.../payment` | Basis | Bankdaten der Eltern gibt es heute ohne Abrechnung. Wenn Elternbeiträge und Abrechnung gebaut wird, wandern sie dorthin. |
| `/api/students/change-requests`, `.../excused-absence-requests`, `.../offering-change-requests`, `.../care-schedule-change-requests`, `.../master-data-change-requests` | Basis | Der Anfragen-Eingang mischt Eltern-App und Online-Anmeldung. Ohne Eltern-App kommen keine neuen Anfragen, offene kann die Schule abschließen. |
| `/api/messages`, `/api/parent-announcements`, `/api/announcement-attachments` | Eltern-App | Nachrichten und Elternbriefe an Eltern. Der Team-Chat (`/api/staff-messages`) ist Basis. |
| `/api/time-tracking/assignments`, `.../holidays`, `.../closing-days` | Basis | Eigene Blöcke aus dem Betreuungsplan auf der Startseite, Feiertage und Schließtage der Planung. |
| `/api/time-tracking/shifts` | Dienstplan | Eigene Dienste unter „Mein Dienstplan“. Die übrigen Routen unter `/api/time-tracking` sind Zeiterfassung. |
| `/api/enrollment/...` | Online-Anmeldung | Auch die Betreuungsangebote: Ihre Verwaltung liegt im Bereich Anmeldungen. Die Angebote eines Kindes (`/api/students/care-offerings`, `.../pickup-schedules`) bleiben Basis. |
| `/api/staff/{id}/schedule`, `.../payroll-number`, `.../target-overrides`, `.../vacation`, `.../absences`, `/api/staff/absences`, `/api/absence-types`, `/api/work-time-models` | Zeiterfassung | Arbeitszeitmodell, Urlaub und Personalnummer für den Lohnexport. |
| `/api/settings/payroll-status`, `/api/import/opening-balances` | Zeiterfassung | Lohnbüro-Versand und Startsalden der Stundenkonten. |
| `/api/staff/{id}/stammdaten`, `.../documents`, `documents-directory`, `documents-profile`, `financial-profile` | Personalakte | Personalstammdaten, Dokumente, Bank- und Steuerdaten. |
| `/api/staff/dashboard-summary`, `/api/staff/externals` | Basis | Kachel „Personal heute“ und externe Betreuungskräfte. |
| `/api/timetable/shift-coverage` | Dienstplan | Besetzung aus dem Dienstplan im Terminformular. Die übrige Planung ist Basis. |
| `/api/week-protocols` | Basis | Wochenprotokoll je Gruppe (#4769, Modulkatalog „Planung“). Es fasst Tagesauswertung, Blöcke und Tagesinformationen zusammen, alles Basis; Planung hat keinen eigenen Schalter. |
| `/api/substitutions`, `/api/timetable/substitutions` | Basis | Übergaben einer Gruppe gibt es ohne Dienstplan. |
| `/api/surveys` | Basis | Umfragen an das Team gibt es ohne Eltern-App. Eine Umfrage an Eltern erreicht sie nur über das Elternportal (`/parent/me/news/{id}/survey`, Eltern-App) und über Mitteilungen an Eltern, die ohne Eltern-App nicht verschickt werden. Wie bei Terminen an Eltern sperrt also der Weg zu den Eltern, nicht das Anlegen. |
| `/api/class-list-entries`, `/api/students/class-arrival-*`, `/api/students/school-checkin` | Basis | Klassenlisten und Ankunft aus der Schule pflegt das OGS-Team. Das Schulportal der Lehrkräfte ist Unterricht am Vormittag. |
| `/api/feedback` | Basis | Rückmeldungen der Kinder am Tablet, auch zum Essen. Die Rückmeldung gibt es ohne das Modul Mittagessen. |
| `/api/holiday-weeks` | Basis | Teilnehmerliste der ausrichtenden OGS (#4665). Die Ferienbetreuung plant der Träger; die Schule, die eine Woche ausrichtet, braucht die Liste unabhängig von ihren gebuchten Modulen. Online-Anmeldung betrifft nur die Anmeldung je Schule. |
| `/api/holiday-guests`, `/api/holiday-weeks/{weekId}/guest-group` | Basis | Feriengäste der ausrichtenden OGS (#4666): Gruppe der Woche wählen, Betreuung, Notfall und Abholung eines Gasts. Gruppe und Check-in sind Basis; die Gäste kommen mit ihnen, unabhängig von gebuchten Modulen. |
| `/api/search`, `/api/students/enrollment-answer-filters` | Basis | Die Suche (ADR 0231) findet Kinder, Kontakte, Mitarbeitende, Räume und Gruppen, die jede Schule hat. Angaben aus der Online-Anmeldung findet sie nur, wenn die Schule Anmeldungen hatte; ohne das Modul gibt es keine neuen Angaben, vorhandene bleiben in der Kinderakte lesbar. |
| `/api/traeger-documents` | Basis | Dokumente, die der Träger für die Schule oder die Eltern an ihr freigegeben hat (#4692). Der Träger entscheidet über die Freigabe; die OGS-Leitung braucht sie unabhängig von gebuchten Modulen. |

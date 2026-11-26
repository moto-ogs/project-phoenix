# Revisit: Fachinhalt nach Navigation

Vollserie auf `rechenzentrum`: 159 Durchgänge in 25:24 min einschließlich
Frontend-Build und Start. Alle 187 budgetpflichtigen Warm- und
Rückweg-Mediane lagen unter 150 ms. Der langsamste lag bei 145 ms
(Zeiterfassung, Admin, Rückweg nach vier anderen Seiten). Keiner der 561
budgetpflichtigen Warm- und Rückweg-Einzelwerte zeigte eine Ladehülle.
Kein gemessener Seitenwechsel lud das Dokument neu.

Außerhalb des Budgets: Beim auditpflichtigen Öffnen des Klassenkinds im
Schulportal zeigte sich in allen zwölf Warm- und Rückweg-Proben ein Skelett
(Mediane 197–214 ms). Der Abruf läuft bei jedem Öffnen.

Git-Merge-Basis development@ea66dcbc5bb342ca7c74f750c015ecbe4803264e · Checkout ea66dcbc5bb342ca7c74f750c015ecbe4803264e (sauber) · 2026-11-26T02:08:43.237Z · Chromium 158.0.8127.88 · linux/x64, Intel(R) Core(TM) i9-14900K (32 logische CPUs)

Quellbäume des Checkouts: frontend/src fc437077f1cc43b1b8c83740527da0d7b08ef13b (identisch mit Basis), backend dc3abf967b93ee05871be64b1fa86b5aa04329c0.

CPU ×4, 150 ms RTT, Desktop 3 Mbit/s, Pixel 7 1.6 Mbit/s. Abweichungen: „nah“ = Median 130–170 ms; „Last“ = mindestens ein Durchgang im Mittel unter 50 % freier Host-CPU. Kein kausaler Vergleich bei unterschiedlicher Last.

Millisekunden: Median [Minimum–Maximum] aus 3 Durchgängen (parallel). Ziel: je gültigem warmen bzw. Rückweg-Median < 150 ms. · = kein solcher History-Weg. Pro Zelle folgen RSC/JS/BFF (jeweils Median) und die tatsächlich sichtbaren Ladeanzeigen dieser Richtung. Einzelwerte und Ladeanzeigen je Lauf stehen im JSON.

| Portal/Rolle | Ablauf | Profil/Eingabe | Erstbesuch | Warm 1 | Zurück 1 | Warm 4 | Zurück 4 | Inhaltskriterium |
|---|---|---|---|---|---|---|---|---|
| admin | kindersuche-admin | Desktop/click | 1114 [1111–1116]<br>1/11/7 · progress-bar, skeleton | 108 [102–115]<br>0/0/1 · keine | 104 [104–108]<br>0/0/11 · keine | 141 [138–142] · nah<br>0/0/11 · keine | 100 [99–111]<br>0/0/11 · keine | Öffnbare Kinderkarte |
| admin | aufsicht-admin | Desktop/click | 1099 [1095–1131]<br>10/23/5 · progress-bar, skeleton, loading | 100 [100–106]<br>0/0/4 · keine | 82 [81–86]<br>0/0/3 · keine | 123 [112–124]<br>0/0/6 · keine | 90 [90–96]<br>0/0/1 · keine | Aktion im geladenen Aufsichtsraum |
| admin | zeit-admin | Desktop/click | 872 [865–894]<br>8/14/1 · progress-bar, skeleton, loading | 135 [134–138] · nah<br>6/0/1 · keine | 116 [116–117]<br>0/0/4 · keine | 103 [98–104]<br>0/0/4 · keine | 145 [142–153] · nah<br>0/0/4 · keine | Geladene Wochensumme der Zeiterfassung |
| admin | kinderakte-admin | Desktop/click | 1593 [1588–1595]<br>3/18/11 · progress-bar, skeleton, loading | 120 [120–120]<br>0/0/1 · keine | 79 [72–83]<br>0/0/16 · keine | 122 [122–128]<br>0/0/16 · keine | 82 [80–88]<br>0/0/15 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| admin | kindersuche-tastatur | Desktop/keyboard | 1113 [1086–1151]<br>1/11/7 · progress-bar, skeleton | 104 [98–106]<br>0/0/1 · keine | 103 [100–103]<br>0/0/11 · keine | 125 [116–126]<br>0/0/11 · keine | 96 [93–115]<br>0/0/11 · keine | Öffnbare Kinderkarte |
| admin | dienstplan-admin | Desktop/click | 1027 [1016–1318]<br>9/14/4 · progress-bar, skeleton | 112 [112–113]<br>0/0/1 · keine | 100 [94–100]<br>0/0/6 · keine | 132 [128–133] · nah<br>0/0/6 · keine | 105 [99–105]<br>0/0/1 · keine | Besetzte Dienstplanzeile der Betreuungsperson |
| admin | team-person | Desktop/click | 1155 [1088–1181]<br>3/15/1 · progress-bar, skeleton | 82 [75–111]<br>0/0/1 · keine | 59 [59–61]<br>0/0/9 · keine | 82 [81–88]<br>0/0/9 · keine | 58 [56–60]<br>0/0/5 · keine | Gewählte Person mit geladenem Stundenkonto |
| admin | räume-raum | Desktop/click | 282 [274–291]<br>10/17/5 · skeleton | 95 [95–98]<br>4/0/6 · keine | 60 [58–60]<br>0/0/3 · keine | 95 [93–97]<br>2/0/6 · keine | 67 [63–68]<br>0/0/1 · keine | Gewählter Raum mit Stammdaten und Anwesenheitsstand |
| admin | anfragen-admin | Desktop/click | 786 [777–795]<br>1/7/1 · progress-bar, skeleton, loading | 92 [85–99]<br>0/0/4 · keine | 69 [68–79]<br>0/0/5 · keine | 122 [116–123]<br>0/0/5 · keine | 82 [81–84]<br>0/0/5 · keine | Anfragegruppe mit offener Anzahl oder bestätigter Leerzustand |
| admin | plan-admin | Desktop/click | 1116 [1116–1127]<br>7/12/11 · progress-bar, skeleton | 111 [109–113]<br>0/0/1 · keine | 117 [111–117]<br>0/0/13 · keine | 122 [119–124]<br>0/0/13 · keine | 89 [88–92]<br>0/0/10 · keine | Belegte Planzeile mit Personenzahl |
| admin | abwesenheiten-kinderakte | Desktop/click | 1639 [1636–2001]<br>3/19/11 · progress-bar, skeleton, loading | 81 [74–82]<br>0/0/1 · keine | 77 [75–81]<br>0/0/16 · keine | 93 [92–97]<br>0/0/16 · keine | 73 [69–76]<br>0/0/10 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| admin | statistik-kinderakte | Desktop/click | 1715 [1709–1723]<br>11/18/11 · progress-bar, skeleton, loading | 78 [77–78]<br>0/0/1 · keine | 69 [66–70]<br>0/0/16 · keine | 91 [86–101]<br>0/0/16 · keine | 69 [68–73]<br>0/0/5 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| admin | raum-kinderakte | Desktop/click | 441 [441–443]<br>5/0/11 · skeleton, loading | 103 [102–106]<br>4/0/1 · keine | 73 [71–83]<br>0/0/16 · keine | 121 [119–128]<br>5/0/16 · keine | 75 [74–77]<br>0/0/13 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| betreuer | kindersuche-betreuer | Desktop/click | 1017 [997–1018]<br>3/9/9 · progress-bar, skeleton | 108 [103–114]<br>0/0/2 · keine | 100 [96–103]<br>0/0/13 · keine | 132 [118–170] · nah<br>0/0/14 · keine | 89 [87–108]<br>0/0/1 · keine | Öffnbare Kinderkarte |
| betreuer | aufsicht-betreuer | Desktop/click | 1263 [1255–1287]<br>10/24/9 · progress-bar, skeleton, loading | 91 [78–100]<br>0/0/8 · keine | 65 [58–73]<br>0/0/2 · keine | 96 [92–96]<br>0/0/5 · keine | 82 [79–86]<br>0/0/1 · keine | Aktion im geladenen Aufsichtsraum |
| betreuer | zeit-betreuer | Desktop/click | 832 [816–971]<br>14/13/1 · progress-bar, skeleton, loading | 134 [134–136] · nah<br>0/0/1 · keine | 101 [101–103]<br>0/0/4 · keine | 99 [92–103]<br>0/0/4 · keine | 89 [81–127]<br>0/0/1 · keine | Geladene Wochensumme der Zeiterfassung |
| betreuer | kinderakte-betreuer | Desktop/click | 1596 [1593–2147]<br>5/18/10 · progress-bar, skeleton, loading | 114 [111–116]<br>0/0/1 · keine | 71 [68–77]<br>0/0/14 · keine | 127 [123–145]<br>0/0/14 · keine | 73 [70–75]<br>0/0/10 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| betreuer | gruppe-kinderakte | Desktop/click | 1486 [1482–1492]<br>3/17/10 · progress-bar, skeleton, loading | 85 [82–85]<br>0/0/1 · keine | 69 [69–70]<br>0/0/14 · keine | 91 [89–93]<br>0/0/14 · keine | 72 [66–80]<br>0/0/13 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| betreuer | tagesplan-betreuer | Desktop/click | 496 [494–519]<br>3/2/1 · progress-bar, skeleton | 81 [67–86]<br>0/0/1 · keine | 55 [53–58]<br>0/0/2 · keine | 88 [88–93]<br>0/0/2 · keine | 69 [61–77]<br>0/0/1 · keine | Planblock des laufenden Betreuungstags mit Zeitraum und Raum |
| betreuer | gruppe-navigation | Desktop/click | 917 [900–926]<br>1/10/4 · progress-bar, skeleton | 83 [82–86]<br>0/0/2 · keine | 71 [66–74]<br>0/0/4 · keine | 117 [104–120]<br>0/0/4 · keine | 76 [75–79]<br>0/0/2 · keine | Anwesenheitsliste der eigenen Gruppe |
| betreuer | gruppe-startkarte | Desktop/click | 952 [950–954]<br>6/10/6 · progress-bar, skeleton | 110 [105–115]<br>0/0/2 · keine | 71 [71–77]<br>0/0/4 · keine | 119 [115–121]<br>0/0/4 · keine | 89 [85–91]<br>0/0/1 · keine | Anwesenheitsliste der eigenen Gruppe |
| betreuer | start-betreuer | Desktop/click | 271 [271–284]<br>12/17/1 · skeleton | 80 [80–81]<br>0/0/7 · keine | 62 [61–63]<br>0/0/2 · keine | 96 [79–96]<br>0/0/8 · keine | 71 [68–74]<br>0/0/1 · keine | Datenzeile der Startkarte |
| betreuer | anfragen-betreuer | Desktop/click | 773 [770–1346]<br>3/7/1 · progress-bar, skeleton, loading | 76 [76–85]<br>0/0/2 · keine | 62 [61–66]<br>0/0/4 · keine | 100 [99–101]<br>0/0/4 · keine | 73 [69–76]<br>0/0/4 · keine | Anfragegruppe mit offener Anzahl oder bestätigter Leerzustand |
| betreuer | plan-betreuer | Desktop/click | 89 [87–99]<br>0/0/1 · keine | 60 [60–70]<br>0/0/0 · keine | · | · | · | Aktive Tagesansicht mit den fachlich gleichen Terminblöcken wie nach der Tagesantwort |
| betreuer | kindersuche-betreuer-tastatur | Desktop/keyboard | 1005 [993–1013]<br>3/9/9 · progress-bar, skeleton | 92 [81–100]<br>0/0/2 · keine | 100 [93–102]<br>0/0/13 · keine | 123 [120–126]<br>0/0/14 · keine | 87 [84–87]<br>0/0/1 · keine | Öffnbare Kinderkarte |
| parents | kind-abwesenheitsdialog | Desktop/click | 118 [115–131]<br>0/0/0 · keine | 99 [67–120]<br>0/0/0 · keine | · | · | · | Abwesenheitsdialog für das ausgewählte Kind mit Tagesauswahl; keine Meldung wird versandt |
| parents | kind-abwesenheitsdialog | Pixel 7/touch | 114 [113–115]<br>0/0/0 · keine | 81 [81–98]<br>0/0/0 · keine | · | · | · | Abwesenheitsdialog für das ausgewählte Kind mit Tagesauswahl; keine Meldung wird versandt |
| parents | start-nachrichten | Desktop/click | 745 [742–746]<br>8/7/0 · progress-bar | 53 [51–78]<br>0/0/0 · keine | 31 [31–32]<br>0/0/0 · keine | 72 [70–72]<br>0/0/0 · keine | 44 [39–47]<br>0/0/0 · keine | Auswählbare Unterhaltung des ausgewählten Kindes |
| parents | start-nachrichten | Pixel 7/touch | 900 [899–906]<br>8/7/0 · progress-bar | 66 [65–67]<br>0/0/0 · keine | 31 [31–40]<br>0/0/0 · keine | 73 [71–85]<br>0/0/0 · keine | 36 [35–37]<br>0/0/0 · keine | Auswählbare Unterhaltung des ausgewählten Kindes |
| parents | start-kind | Desktop/click | 779 [772–779]<br>11/7/1 · progress-bar, loading, skeleton | 73 [68–76]<br>0/0/0 · keine | 48 [45–62]<br>0/0/0 · keine | 73 [71–79]<br>0/0/0 · keine | 52 [52–58]<br>0/0/0 · keine | Name des Zielkindes und dessen geladene, bedienbare Betreuungskarte |
| parents | start-kind | Pixel 7/touch | 1203 [1197–1225]<br>10/7/1 · progress-bar, loading, skeleton | 83 [83–87]<br>0/0/0 · keine | 43 [43–45]<br>0/0/0 · keine | 88 [88–108]<br>0/0/0 · keine | 51 [49–52]<br>0/0/0 · keine | Name des Zielkindes und dessen geladene, bedienbare Betreuungskarte |
| parents | kind-start | Desktop/click | 537 [536–551]<br>8/6/2 · progress-bar | 54 [54–54]<br>0/0/0 · keine | 39 [37–40]<br>0/0/0 · keine | 80 [78–89]<br>0/0/0 · keine | 62 [60–62]<br>0/0/0 · keine | Öffnbare Profilkarte des Kindes dieses Elternkontos |
| parents | kind-start | Pixel 7/touch | 629 [629–638]<br>6/6/2 · progress-bar | 67 [67–69]<br>0/0/0 · keine | 37 [37–48]<br>0/0/0 · keine | 89 [85–90]<br>0/0/0 · keine | 51 [46–56]<br>0/0/0 · keine | Öffnbare Profilkarte des Kindes dieses Elternkontos |
| school | tagesübersicht-klasse | Desktop/click | 248 [240–264]<br>2/0/1 · skeleton | 59 [54–66]<br>1/0/0 · keine | 39 [37–42]<br>0/0/2 · keine | 50 [49–50]<br>1/0/0 · keine | 35 [32–35]<br>0/0/1 · keine | Geladene Kinderzeile der Zielklasse |
| school | klasse-kind | Desktop/click | 563 [562–564]<br>3/2/1 · progress-bar, skeleton | 214 [214–230]<br>0/0/1 · skeleton | 197 [197–198]<br>0/0/1 · skeleton | 214 [198–214]<br>0/0/1 · skeleton | 198 [193–198]<br>0/0/1 · skeleton | Klassenkind mit freigegebenen Beobachtungen oder bestätigtem Leerzustand (Abruf bei jedem Öffnen) |
| school | fehlzeiten-start | Desktop/click | 516 [515–528]<br>4/9/1 · progress-bar, skeleton | 50 [49–51]<br>0/0/1 · keine | 36 [35–49]<br>0/0/2 · keine | 52 [50–66]<br>0/0/0 · keine | 34 [32–36]<br>0/0/3 · keine | Tagesübersicht mit Link zur Klasse |
| school | tagesübersicht-klasse-tastatur | Desktop/keyboard | 240 [240–250]<br>2/0/1 · skeleton | 51 [47–63]<br>1/0/0 · keine | 40 [34–54]<br>0/0/2 · keine | 41 [40–52]<br>1/0/0 · keine | 37 [36–38]<br>0/0/1 · keine | Geladene Kinderzeile der Zielklasse |
| traeger | schulen-ferien | Desktop/click | 214 [213–222]<br>3/4/1 · skeleton | 54 [51–54]<br>1/0/1 · keine | 44 [38–44]<br>0/0/2 · keine | 58 [58–61]<br>1/0/2 · keine | 37 [34–37]<br>0/0/1 · keine | Auswählbarer veröffentlichter Ferienzeitraum |
| traeger | ferien-zeitraum | Desktop/click | 598 [597–624]<br>7/4/4 · progress-bar | 76 [75–76]<br>1/0/1 · keine | 77 [74–81]<br>0/0/5 · keine | 91 [90–139]<br>1/0/5 · keine | 72 [69–72]<br>0/0/1 · keine | Gewählter Zeitraum mit bedienbarem Wochenformular |
| traeger | übersicht-schule | Desktop/click | 513 [513–529]<br>1/3/1 · progress-bar | 49 [49–52]<br>1/0/1 · keine | 36 [35–38]<br>0/0/2 · keine | 52 [52–54]<br>1/0/2 · keine | 41 [40–42]<br>0/0/2 · keine | Name der Zielschule mit belegten Stammdaten |
| traeger | schulen-start | Desktop/click | 214 [200–218]<br>2/0/1 · skeleton | 50 [49–50]<br>1/0/1 · keine | 36 [33–36]<br>0/0/1 · keine | 51 [49–51]<br>1/0/1 · keine | 36 [36–37]<br>0/0/1 · keine | Öffnbare Schule im Standortverzeichnis |
| traeger | belegung-übersicht | Desktop/click | 218 [216–268]<br>2/0/2 · skeleton | 54 [52–55]<br>1/0/1 · keine | 50 [46–50]<br>0/0/4 · keine | 60 [57–61]<br>1/0/4 · keine | 49 [48–56]<br>0/0/4 · keine | Zahlenzeile der Zielschule mit Detailverweis |
| traeger | übersicht-schule-tastatur | Desktop/keyboard | 520 [511–526]<br>1/3/1 · progress-bar | 52 [48–65]<br>1/0/1 · keine | 36 [36–37]<br>0/0/2 · keine | 44 [42–70]<br>1/0/2 · keine | 41 [40–41]<br>0/0/2 · keine | Name der Zielschule mit belegten Stammdaten |
| operator | trägerliste-konten | Desktop/click | 574 [560–588]<br>1/4/1 · progress-bar, skeleton | 83 [82–85]<br>1/0/0 · keine | 72 [69–78]<br>0/0/3 · keine | 82 [80–84]<br>1/0/0 · keine | 69 [68–71]<br>0/0/1 · keine | Geladene Kontozeile |
| operator | schulen-schuldetail | Desktop/click | 586 [578–589]<br>7/10/2 · progress-bar, skeleton | 49 [47–50]<br>1/0/0 · keine | 37 [34–50]<br>0/0/5 · keine | 48 [46–64]<br>1/0/0 · keine | 33 [32–38]<br>0/0/2 · keine | Gewählte Schule mit geladenen Kennzahlen und Verwaltung |
| operator | trägerliste-detail | Desktop/click | 801 [800–802]<br>2/8/3 · progress-bar, skeleton | 49 [49–50]<br>1/0/0 · keine | 29 [29–34]<br>0/0/2 · keine | 48 [48–49]<br>1/0/1 · keine | 36 [36–38]<br>0/0/2 · keine | Name, Stammdaten und Kennzahlen der gewählten Organisation |
| operator | schulen-trägerliste | Desktop/click | 201 [199–202]<br>1/0/0 · skeleton | 50 [50–51]<br>1/0/0 · keine | 34 [32–35]<br>0/0/2 · keine | 49 [49–50]<br>1/0/0 · keine | 35 [33–38]<br>0/0/2 · keine | Öffnbare Zeile der Seed-Organisation |
| operator | trägerliste-konten-tastatur | Desktop/keyboard | 593 [562–595]<br>1/4/1 · progress-bar, skeleton | 81 [81–82]<br>1/0/0 · keine | 69 [64–88]<br>0/0/3 · keine | 80 [76–83]<br>1/0/0 · keine | 69 [67–69]<br>0/0/1 · keine | Geladene Kontozeile |
| caterer | bestellungen-konto | Desktop/click | 514 [514–514]<br>1/3/1 · progress-bar | 47 [46–48]<br>1/0/1 · keine | 25 [23–25]<br>0/0/5 · keine | · | · | Bestätigte Anmeldeadresse und bedienbare Passwortaktion |
| caterer | konto-bestellungen | Desktop/click | 513 [513–513]<br>1/2/1 · progress-bar | 48 [48–49]<br>0/0/1 · keine | 26 [25–26]<br>0/0/2 · keine | · | · | Bestellzahlen der belieferten Schule |
| caterer | schule-bestelldetail | Desktop/click | 199 [193–213]<br>0/0/1 · skeleton | 31 [30–32]<br>0/0/0 · keine | · | · | · | Aufgeklappte Schule mit geladenem Bestellstand je Tag |
| caterer | bestellungen-zeitraum | Desktop/click | 198 [198–198]<br>0/0/1 · skeleton | 32 [31–33]<br>0/0/0 · keine | · | · | · | Gewählter Zeitraum und zugehörige Tageszahlen der Schule |
| caterer | konto-bestellungen-tastatur | Desktop/keyboard | 504 [503–510]<br>1/2/1 · progress-bar | 44 [37–47]<br>0/0/1 · keine | 24 [23–27]<br>0/0/2 · keine | · | · | Bestellzahlen der belieferten Schule |

## Mediane unter 150 ms nach Navigationsart, Gerät und Eingabe

| Fall | Warm 1 | Zurück 1 | Warm 4 | Zurück 4 |
|---|---:|---:|---:|---:|
| Seitenwechsel · Desktop · click | 38/38 | 38/38 | 36/36 | 36/36 |
| Seitenwechsel · Desktop · keyboard | 6/6 | 6/6 | 5/5 | 5/5 |
| Seitenintern · Desktop · click | 4/4 | · | · | · |
| Seitenintern · Pixel 7 · touch | 1/1 | · | · | · |
| Seitenwechsel · Pixel 7 · touch | 3/3 | 3/3 | 3/3 | 3/3 |
| Protokollierter Lesezugriff (nicht wiederverwendbar) · Desktop · click | · | · | · | · |

## Getrennte Fälle

Nicht im 150-ms-Budget. Im selben Browser wurde zuerst die bisherige Familie abgewiesen, dann die neue bestätigt.

| Elternprofil | Abmeldung: bis Bestätigung | Ohne Sitzung: bis Anmeldung |
|---|---:|---:|
| Desktop | 66 [65–67] | 1107 [1106–1113] |
| Pixel 7 | 113 [113–114] | 1490 [1477–1495] |

| Elternprofil | Nach Rechteentzug: erlaubte Familienübersicht |
|---|---:|
| Desktop | 800 [797–808] |
| Pixel 7 | 1358 [1357–1366] |

# Revisit: Fachinhalt nach Navigation

Git-Merge-Basis development@764c20585da55c6bff1f6397855736dce575a0a5 · Checkout 50e3dfe271e097b8bbb9a47c5e893cd547535e52 (sauber) · 2026-11-25T05:39:54.739Z · Chromium 158.0.8127.88 · linux/x64, Intel(R) Core(TM) i9-14900K (32 logische CPUs)

Quellbäume des Checkouts: frontend/src 946fca64ab2c9e211cad4adfeaba5dcd4f1f50b8 (identisch mit Basis), backend a7b804ce6104869f6c969720b9156a063d7f15e0.

CPU ×4, 150 ms RTT, Desktop 3 Mbit/s, Pixel 7 1.6 Mbit/s. Abweichungen: „nah“ = Median 130–170 ms; „Last“ = mindestens ein Durchgang im Mittel unter 50 % freier Host-CPU. Kein kausaler Vergleich bei unterschiedlicher Last.

Millisekunden: Median [Minimum–Maximum] aus drei Läufen. Ziel: je gültigem warmen bzw. Rückweg-Median < 150 ms. · = kein solcher History-Weg. Pro Zelle folgen RSC/JS/BFF (jeweils Median) und die tatsächlich sichtbaren Ladeanzeigen dieser Richtung. Einzelwerte und Ladeanzeigen je Lauf stehen im JSON.

| Portal/Rolle | Ablauf | Profil/Eingabe | Erstbesuch | Warm 1 | Zurück 1 | Warm 4 | Zurück 4 | Inhaltskriterium |
|---|---|---|---|---|---|---|---|---|
| admin | kindersuche-admin | Desktop/click | 1464 [1464–1468]<br>1/10/12 · progress-bar, skeleton | 531 [526–540]<br>1/0/1 · progress-bar | 356 [353–356]<br>0/0/11 · keine | 592 [555–598]<br>1/0/11 · progress-bar | 336 [325–338]<br>0/0/11 · keine | Öffnbare Kinderkarte |
| admin | aufsicht-admin | Desktop/click | 1131 [1124–1132]<br>2/8/6 · progress-bar, skeleton, loading | 193 [188–195]<br>0/0/1 · keine | 151 [143–153] · nah<br>0/0/6 · keine | 201 [187–217]<br>0/0/6 · keine | 140 [134–141] · nah<br>0/0/6 · keine | Aktion im geladenen Aufsichtsraum |
| admin | zeit-admin | Desktop/click | 1357 [1046–1369]<br>3/14/17 · progress-bar, skeleton, loading | 322 [319–336]<br>1/0/1 · progress-bar | 135 [133–136] · nah<br>0/0/4 · keine | 328 [314–334]<br>1/0/4 · progress-bar | 135 [131–139] · nah<br>0/0/4 · keine | Geladene Wochensumme der Zeiterfassung |
| admin | kinderakte-admin | Desktop/click | 1429 [1417–1493]<br>1/13/25 · progress-bar, skeleton, loading | 302 [298–306]<br>1/0/2 · progress-bar | 114 [110–116]<br>0/0/24 · keine | 306 [303–308]<br>1/0/25 · progress-bar | 121 [117–125]<br>0/0/25 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| admin | kindersuche-tastatur | Desktop/keyboard | 1422 [1417–1426]<br>3/10/12 · progress-bar, skeleton | 373 [371–386]<br>0/0/1 · progress-bar | 322 [320–324]<br>0/0/11 · keine | 380 [372–382]<br>0/0/11 · progress-bar | 328 [319–330]<br>0/0/1 · keine | Öffnbare Kinderkarte |
| admin | dienstplan-admin | Desktop/click | 1203 [1201–1224]<br>1/9/7 · progress-bar, skeleton | 386 [385–387]<br>1/0/1 · progress-bar | 194 [189–201]<br>0/0/6 · keine | 390 [387–403]<br>1/0/5 · progress-bar | 200 [194–204]<br>0/0/5 · keine | Besetzte Dienstplanzeile der Betreuungsperson |
| admin | team-person | Desktop/click | 1374 [1370–1621]<br>1/14/9 · progress-bar, skeleton | 290 [289–291]<br>1/0/1 · skeleton | 144 [141–145] · nah<br>0/0/9 · keine | 296 [293–297]<br>1/0/9 · skeleton | 128 [125–128]<br>0/0/9 · keine | Gewählte Person mit geladenem Stundenkonto |
| admin | räume-raum | Desktop/click | 1038 [1037–1053]<br>1/8/8 · progress-bar, skeleton, loading | 262 [261–262]<br>1/0/1 · skeleton | 110 [107–110]<br>0/0/8 · keine | 274 [271–278]<br>1/0/8 · skeleton | 107 [105–110]<br>0/0/8 · keine | Gewählter Raum mit Stammdaten und Anwesenheitsstand |
| admin | anfragen-admin | Desktop/click | 1020 [1017–1021]<br>1/6/5 · progress-bar, skeleton, loading | 267 [265–267]<br>1/0/4 · progress-bar, skeleton | 93 [90–94]<br>0/0/5 · keine | 267 [260–272]<br>1/0/5 · progress-bar, skeleton | 85 [85–89]<br>0/0/5 · keine | Anfragegruppe mit offener Anzahl oder bestätigter Leerzustand |
| admin | plan-admin | Desktop/click | 1171 [1170–1181]<br>1/10/11 · progress-bar | 324 [319–334]<br>1/0/1 · progress-bar | 153 [152–153] · nah<br>0/0/12 · keine | 336 [330–353]<br>1/0/10 · progress-bar | 156 [155–157] · nah<br>0/0/10 · keine | Belegte Planzeile mit Personenzahl |
| admin | abwesenheiten-kinderakte | Desktop/click | 1572 [1571–1572]<br>1/13/25 · progress-bar, skeleton, loading | 269 [268–275]<br>1/0/1 · progress-bar | 118 [108–119]<br>0/0/25 · keine | 279 [278–283]<br>1/0/25 · progress-bar | 99 [98–101]<br>0/0/25 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| admin | statistik-kinderakte | Desktop/click | 1463 [1461–1467]<br>1/12/25 · progress-bar, skeleton, loading | 273 [262–274]<br>1/0/1 · progress-bar | 111 [108–112]<br>0/0/25 · keine | 273 [268–278]<br>1/0/25 · progress-bar | 100 [99–103]<br>0/0/25 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| admin | raum-kinderakte | Desktop/click | 1658 [1646–2151]<br>1/15/25 · progress-bar, skeleton, loading | 290 [288–295]<br>1/0/1 · progress-bar | 117 [116–118]<br>0/0/25 · keine | 304 [299–304]<br>1/0/25 · progress-bar | 106 [103–111]<br>0/0/25 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| betreuer | kindersuche-betreuer | Desktop/click | 1472 [1472–1474]<br>1/10/14 · progress-bar, skeleton | 536 [536–545]<br>1/0/2 · progress-bar | 355 [351–359]<br>0/0/13 · keine | 537 [532–609]<br>1/0/14 · progress-bar | 324 [322–330]<br>0/0/10 · keine | Öffnbare Kinderkarte |
| betreuer | aufsicht-betreuer | Desktop/click | 1314 [1310–1319]<br>2/9/10 · progress-bar, skeleton, loading | 160 [155–164] · nah<br>0/0/1 · keine | 118 [118–119]<br>0/0/9 · keine | 152 [151–166] · nah<br>0/0/9 · keine | 115 [113–124]<br>0/0/7 · keine | Aktion im geladenen Aufsichtsraum |
| betreuer | zeit-betreuer | Desktop/click | 1028 [1008–1175]<br>1/11/13 · progress-bar, skeleton, loading | 321 [319–326]<br>1/0/1 · progress-bar | 139 [138–163] · nah<br>0/0/4 · keine | 321 [317–322]<br>1/0/4 · progress-bar | 127 [117–130]<br>0/0/4 · keine | Geladene Wochensumme der Zeiterfassung |
| betreuer | kinderakte-betreuer | Desktop/click | 1423 [1416–1971]<br>1/13/20 · progress-bar, skeleton, loading | 289 [286–294]<br>1/0/2 · progress-bar | 106 [105–110]<br>0/0/19 · keine | 294 [292–294]<br>1/0/20 · progress-bar | 110 [107–111]<br>0/0/20 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| betreuer | gruppe-kinderakte | Desktop/click | 1480 [1479–1562]<br>1/14/20 · progress-bar, skeleton, loading | 265 [265–270]<br>1/0/1 · progress-bar | 106 [103–109]<br>0/0/20 · keine | 267 [267–269]<br>1/0/20 · progress-bar | 92 [88–93]<br>0/0/20 · keine | Zielkind und verfügbare Schnellaktionen in der Kinderakte |
| betreuer | tagesplan-betreuer | Desktop/click | 631 [629–744]<br>1/2/11 · progress-bar, skeleton | 233 [230–235]<br>1/0/1 · progress-bar | 55 [54–55]<br>0/0/2 · keine | 231 [230–235]<br>1/0/2 · progress-bar | 58 [57–61]<br>0/0/2 · keine | Planblock des laufenden Betreuungstags mit Zeitraum und Raum |
| betreuer | gruppe-navigation | Desktop/click | 998 [998–999]<br>1/8/5 · progress-bar, skeleton | 265 [265–267]<br>1/0/2 · skeleton | 104 [104–105]<br>0/0/4 · keine | 258 [258–259]<br>1/0/4 · skeleton | 101 [95–106]<br>0/0/4 · keine | Anwesenheitsliste der eigenen Gruppe |
| betreuer | gruppe-startkarte | Desktop/click | 982 [982–987]<br>1/9/6 · progress-bar, skeleton | 315 [315–336]<br>1/0/2 · progress-bar, skeleton | 108 [107–116]<br>0/0/4 · keine | 315 [315–316]<br>1/0/4 · progress-bar, skeleton | 107 [106–109]<br>0/0/4 · keine | Anwesenheitsliste der eigenen Gruppe |
| betreuer | start-betreuer | Desktop/click | 965 [964–967]<br>1/7/7 · progress-bar, skeleton | 237 [237–239]<br>1/0/1 · progress-bar, skeleton | 72 [70–75]<br>0/0/8 · keine | 256 [246–257]<br>1/0/7 · progress-bar, skeleton | 73 [72–74]<br>0/0/7 · keine | Datenzeile der Startkarte |
| betreuer | anfragen-betreuer | Desktop/click | 867 [862–1296]<br>1/6/3 · progress-bar, skeleton, loading | 260 [259–260]<br>1/0/2 · progress-bar, skeleton | 82 [80–82]<br>0/0/4 · keine | 259 [259–262]<br>1/0/4 · progress-bar, skeleton | 80 [77–94]<br>0/0/4 · keine | Anfragegruppe mit offener Anzahl oder bestätigter Leerzustand |
| betreuer | plan-betreuer | Desktop/click | 90 [89–91]<br>0/0/1 · keine | 63 [62–64]<br>0/0/0 · keine | · | · | · | Aktive Tagesansicht mit den fachlich gleichen Terminblöcken wie nach der Tagesantwort |
| betreuer | kindersuche-betreuer-tastatur | Desktop/keyboard | 1443 [1442–1658]<br>3/10/14 · progress-bar, skeleton | 367 [366–372]<br>0/0/2 · progress-bar | 365 [353–369]<br>0/0/13 · keine | 372 [369–404]<br>0/0/14 · progress-bar | 320 [315–322]<br>0/0/1 · keine | Öffnbare Kinderkarte |
| parents | kind-abwesenheitsdialog | Desktop/click | 115 [114–118]<br>0/0/0 · keine | 68 [68–69]<br>0/0/0 · keine | · | · | · | Abwesenheitsdialog für das ausgewählte Kind mit Tagesauswahl; keine Meldung wird versandt |
| parents | kind-abwesenheitsdialog | Pixel 7/touch | 113 [112–113]<br>0/0/0 · keine | 81 [80–82]<br>0/0/0 · keine | · | · | · | Abwesenheitsdialog für das ausgewählte Kind mit Tagesauswahl; keine Meldung wird versandt |
| parents | start-nachrichten | Desktop/click | 705 [700–705]<br>1/8/1 · progress-bar | 232 [230–233]<br>1/0/0 · progress-bar | 34 [34–35]<br>0/0/0 · keine | 233 [232–233]<br>1/0/0 · progress-bar | 33 [32–33]<br>0/0/0 · keine | Auswählbare Unterhaltung des ausgewählten Kindes |
| parents | start-nachrichten | Pixel 7/touch | 840 [838–842]<br>1/8/1 · progress-bar | 252 [249–266]<br>1/0/0 · progress-bar | 35 [34–36]<br>0/0/0 · keine | 263 [249–266]<br>1/0/0 · progress-bar | 32 [31–33]<br>0/0/0 · keine | Auswählbare Unterhaltung des ausgewählten Kindes |
| parents | start-kind | Desktop/click | 1113 [1112–1113]<br>5/7/9 · progress-bar, skeleton, loading | 254 [251–256]<br>1/0/0 · progress-bar | 45 [44–53]<br>0/0/0 · keine | 253 [252–256]<br>1/0/0 · progress-bar | 48 [46–50]<br>0/0/0 · keine | Name des Zielkindes und dessen geladene, bedienbare Betreuungskarte |
| parents | start-kind | Pixel 7/touch | 1345 [1330–1379]<br>4/7/9 · progress-bar, skeleton, loading | 298 [295–298]<br>1/0/0 · progress-bar | 47 [46–47]<br>0/0/0 · keine | 301 [301–302]<br>1/0/0 · progress-bar | 42 [42–48]<br>0/0/0 · keine | Name des Zielkindes und dessen geladene, bedienbare Betreuungskarte |
| parents | kind-start | Desktop/click | 498 [491–499]<br>6/3/4 · progress-bar, skeleton | 233 [221–233]<br>1/0/0 · progress-bar | 48 [46–51]<br>0/0/0 · keine | 225 [221–233]<br>1/0/0 · progress-bar | 47 [44–49]<br>0/0/0 · keine | Öffnbare Profilkarte des Kindes dieses Elternkontos |
| parents | kind-start | Pixel 7/touch | 602 [599–604]<br>1/3/4 · progress-bar, skeleton | 253 [251–255]<br>1/0/0 · progress-bar | 45 [44–46]<br>0/0/0 · keine | 253 [249–263]<br>1/0/0 · progress-bar | 44 [42–44]<br>0/0/0 · keine | Öffnbare Profilkarte des Kindes dieses Elternkontos |
| school | tagesübersicht-klasse | Desktop/click | 681 [681–681]<br>1/6/0 · progress-bar | 214 [202–215]<br>1/0/0 · progress-bar | 35 [34–39]<br>0/0/2 · keine | 201 [198–218]<br>1/0/2 · progress-bar | 32 [31–33]<br>0/0/0 · keine | Geladene Kinderzeile der Zielklasse |
| school | klasse-kind | Desktop/click | 577 [563–579]<br>1/2/1 · progress-bar, skeleton | 363 [362–364]<br>1/0/1 · progress-bar, skeleton | 195 [195–202]<br>0/0/1 · skeleton | 364 [362–364]<br>1/0/1 · skeleton, progress-bar | 193 [189–197]<br>0/0/1 · skeleton | Klassenkind mit freigegebenen Beobachtungen oder bestätigtem Leerzustand |
| school | fehlzeiten-start | Desktop/click | 679 [663–680]<br>1/3/1 · progress-bar, skeleton | 199 [199–199]<br>1/0/1 · progress-bar | 33 [31–33]<br>0/0/2 · keine | 199 [198–200]<br>1/0/2 · progress-bar | 27 [25–30]<br>0/0/1 · keine | Tagesübersicht mit Link zur Klasse |
| school | tagesübersicht-klasse-tastatur | Desktop/keyboard | 656 [656–672]<br>4/6/0 · progress-bar | 44 [38–53]<br>0/0/0 · keine | 33 [32–34]<br>0/0/0 · keine | 41 [39–48]<br>0/0/0 · keine | 34 [34–34]<br>0/0/1 · keine | Geladene Kinderzeile der Zielklasse |
| traeger | schulen-ferien | Desktop/click | 530 [529–531]<br>1/1/1 · progress-bar | 217 [215–217]<br>1/0/1 · progress-bar | 42 [41–42]<br>0/0/2 · keine | 205 [204–206]<br>1/0/2 · progress-bar | 38 [38–39]<br>0/0/2 · keine | Auswählbarer veröffentlichter Ferienzeitraum |
| traeger | ferien-zeitraum | Desktop/click | 760 [760–775]<br>1/7/4 · progress-bar | 231 [226–241]<br>1/0/1 · progress-bar | 71 [70–71]<br>0/0/5 · keine | 236 [234–239]<br>1/0/5 · progress-bar | 73 [72–78]<br>0/0/5 · keine | Gewählter Zeitraum mit bedienbarem Wochenformular |
| traeger | übersicht-schule | Desktop/click | 529 [529–530]<br>1/3/1 · progress-bar | 200 [200–202]<br>1/0/1 · progress-bar | 33 [32–34]<br>0/0/2 · keine | 200 [198–200]<br>1/0/2 · progress-bar | 31 [30–32]<br>0/0/2 · keine | Name der Zielschule mit belegten Stammdaten |
| traeger | schulen-start | Desktop/click | 529 [529–530]<br>1/2/1 · progress-bar | 200 [200–202]<br>1/0/1 · progress-bar | 28 [28–28]<br>0/0/1 · keine | 200 [199–200]<br>1/0/1 · progress-bar | 27 [26–30]<br>0/0/1 · keine | Öffnbare Schule im Standortverzeichnis |
| traeger | belegung-übersicht | Desktop/click | 535 [532–535]<br>1/2/1 · progress-bar | 204 [203–206]<br>1/0/1 · progress-bar | 44 [44–44]<br>0/0/3 · keine | 204 [204–205]<br>1/0/3 · progress-bar | 40 [40–43]<br>0/0/3 · keine | Zahlenzeile der Zielschule mit Detailverweis |
| traeger | übersicht-schule-tastatur | Desktop/keyboard | 663 [657–663]<br>3/3/1 · progress-bar | 52 [48–53]<br>0/0/1 · keine | 33 [31–93]<br>0/0/2 · keine | 43 [43–50]<br>0/0/2 · keine | 33 [33–33]<br>0/0/1 · keine | Name der Zielschule mit belegten Stammdaten |
| operator | trägerliste-konten | Desktop/click | 731 [730–733]<br>1/4/2 · progress-bar, skeleton | 244 [243–249]<br>1/0/0 · progress-bar | 75 [75–76]<br>0/0/3 · keine | 244 [240–255]<br>1/0/3 · progress-bar | 67 [66–67]<br>0/0/0 · keine | Geladene Kontozeile |
| operator | schulen-schuldetail | Desktop/click | 568 [568–568]<br>1/5/2 · progress-bar, skeleton | 200 [199–201]<br>1/0/0 · progress-bar | 38 [35–38]<br>0/0/5 · keine | 202 [201–205]<br>1/0/5 · progress-bar | 32 [32–33]<br>0/0/0 · keine | Gewählte Schule mit geladenen Kennzahlen und Verwaltung |
| operator | trägerliste-detail | Desktop/click | 786 [783–787]<br>1/10/2 · progress-bar, skeleton | 214 [213–215]<br>1/0/0 · progress-bar | 44 [36–44]<br>0/0/3 · keine | 214 [213–215]<br>1/0/3 · progress-bar | 33 [32–39]<br>0/0/0 · keine | Name, Stammdaten und Kennzahlen der gewählten Organisation |
| operator | schulen-trägerliste | Desktop/click | 518 [516–518]<br>1/2/0 · progress-bar | 199 [198–200]<br>1/0/0 · progress-bar | 33 [33–34]<br>0/0/2 · keine | 206 [198–209]<br>1/0/2 · progress-bar | 33 [31–34]<br>0/0/0 · keine | Öffnbare Zeile der Seed-Organisation |
| operator | trägerliste-konten-tastatur | Desktop/keyboard | 865 [863–868]<br>3/4/2 · progress-bar, skeleton | 90 [89–96]<br>0/0/0 · keine | 82 [82–84]<br>0/0/3 · keine | 87 [86–91]<br>0/0/3 · keine | 71 [66–72]<br>0/0/0 · keine | Geladene Kontozeile |
| caterer | bestellungen-konto | Desktop/click | 514 [514–515]<br>1/3/1 · progress-bar | 198 [195–198]<br>1/0/1 · progress-bar | 33 [19–34]<br>0/0/5 · keine | · | · | Bestätigte Anmeldeadresse und bedienbare Passwortaktion |
| caterer | konto-bestellungen | Desktop/click | 513 [512–514]<br>1/2/1 · progress-bar | 198 [197–199]<br>1/0/1 · keine | 25 [25–28]<br>0/0/2 · keine | · | · | Bestellzahlen der belieferten Schule |
| caterer | schule-bestelldetail | Desktop/click | 197 [197–197]<br>0/0/1 · skeleton | 31 [31–32]<br>0/0/0 · keine | · | · | · | Aufgeklappte Schule mit geladenem Bestellstand je Tag |
| caterer | bestellungen-zeitraum | Desktop/click | 197 [197–198]<br>0/0/1 · skeleton | 31 [30–31]<br>0/0/0 · keine | · | · | · | Gewählter Zeitraum und zugehörige Tageszahlen der Schule |
| caterer | konto-bestellungen-tastatur | Desktop/keyboard | 654 [651–656]<br>3/2/1 · progress-bar | 48 [42–50]<br>0/0/1 · keine | 31 [25–32]<br>0/0/2 · keine | · | · | Bestellzahlen der belieferten Schule |

## Mediane unter 150 ms nach Navigationsart, Gerät und Eingabe

| Fall | Warm 1 | Zurück 1 | Warm 4 | Zurück 4 |
|---|---:|---:|---:|---:|
| Seitenwechsel · Desktop · click | 0/39 | 33/39 | 0/37 | 32/37 |
| Seitenwechsel · Desktop · keyboard | 4/6 | 4/6 | 3/5 | 3/5 |
| Seitenintern · Desktop · click | 4/4 | · | · | · |
| Seitenintern · Pixel 7 · touch | 1/1 | · | · | · |
| Seitenwechsel · Pixel 7 · touch | 0/3 | 3/3 | 0/3 | 3/3 |

## Getrennte Fälle

Nicht im 150-ms-Budget. Im selben Browser wurde zuerst die bisherige Familie abgewiesen, dann die neue bestätigt.

| Elternprofil | Abmeldung: bis Bestätigung | Ohne Sitzung: bis Anmeldung |
|---|---:|---:|
| Desktop | 66 [66–67] | 1569 [1094–1571] |
| Pixel 7 | 114 [113–114] | 1642 [1638–1643] |

| Elternprofil | Nach Rechteentzug: erlaubte Familienübersicht |
|---|---:|
| Desktop | 798 [797–801] |
| Pixel 7 | 1358 [1358–1378] |

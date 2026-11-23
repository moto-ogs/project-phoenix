---
status: accepted
---

# Bestandskinder bekommen ihre Anmeldung still aus dem importierten Vertrag

Entscheidung vom 22.11.2026 zu
[#7760](https://github.com/moto-ogs/project-phoenix/issues/7760), Teil 2. Sie
setzt die drei Entscheidungen um, die
[ADR 0307](0307-importierte-vertraege-werden-ueber-kennungen-mit-der-kinderakte-verknuepft.md)
im Abschnitt „Anmeldung und Buchungen“ festhält, und ändert die Regel aus
[ADR 0232](0232-bestandsvertraege-kommen-aus-einer-datei-ohne-anmeldung.md)
und [ADR 0153](0153-betreuungsvertrag-entsteht-im-traeger-buero-aus-der-angenommenen-anmeldung.md),
dass ein Vertrag genau einen Ursprung hat.

## Kontext

Ein importierter Vertrag ist nach ADR 0307 mit der Kinderakte verknüpft. Das
Kind hat damit aber weder Anmeldung noch Buchungen. Die tägliche Betreuung
liest genehmigte Buchungen aus Enrollment und Care Plan, und
`AmendFromBookings` folgt nur Verträgen mit `request_child_id`. Die 313
Kinder von SJR Pforzheim haben einen Vertrag, den das Träger-Büro sieht, aber
keine Betreuung, die die Schule sieht.

Keiner der vorhandenen Wege passt: Die manuelle Anmeldung mit
`ExistingStudentID` setzt `matched_by_office`, und solche Kinder liest der
Vertrag nicht. Eine Phase für bestehende Kinder ändert Angaben der Eltern und
kann einem Elternkonto Zugang zur Schule geben.

## Entscheidungen des Product Owners

Yannick Wenger, 22.11.2026 (#7760), wie in ADR 0307 festgehalten:

1. Jedes migrierte Kind bekommt nachträglich eine Anmeldung, aus der die
   Buchungen entstehen. Der importierte Vertrag wird an Kinderakte und
   Anmeldung gebunden; `chk_contracts_origin` verlangt dafür mindestens einen
   Ursprung statt genau einen.
2. Nach der Bindung gilt der normale Weg: Eine genehmigte Buchungsänderung
   erzeugt eine neue Vertragsversion. Migrierte Verträge verhalten sich danach
   wie alle anderen.
3. Der Massenlauf bleibt still: kein Versand und keine Einladung als
   Nebenwirkung. Danach löst das Büro bewusst einen getrennten Schritt aus:
   eine Mail an die Eltern und die Einladung ins Elternportal für alle, die
   noch kein Konto haben.

## Entscheidung

### 1. Buchungen aus dem Vertrag, mit Beweis (Care Contract)

Der Plan (`carecontract.ContractEnrollments`) sagt je importiertem Vertrag
einer Schule, welche Buchungen eine Anmeldung tragen muss:

- Buchungen sind halboffen. **Kein Kind wird vor seinem Vertrag gebucht.**
  Die Buchung der heute geltenden Version beginnt am ersten Tag, an dem der
  Vertrag in der Phase Betreuung verspricht: am Betreuungsbeginn der Phase
  oder, wenn der Vertrag später begann, an seinem ersten Tag (erste
  wirksame Version). Beginnt die Betreuung der Phase am 10.08. und der
  Vertrag am 01.01., ist das Kind ab dem 01.01. gebucht und auf dem Roster,
  nicht ab dem 10.08. Ein Vertrag, der älter ist als die Phase, wird ab dem
  Betreuungsbeginn gebucht. Die Buchung endet mit dem frühesten von:
  letzter Tag des Moduls, Ende der Version, Ende einer Kündigung, Beginn
  der nächsten Version, Ende der Phase.
- Jede spätere Version ist eine geplante Änderung an ihrem ersten Tag.
  Versionen vor der geltenden werden nicht gebucht.
- **Der Beweis hat zwei Teile.** Erstens die Vertragsanpassung selbst: Der
  Plan gibt die Buchungen als Anmeldung in dieselbe Rechnung, die
  `AmendFromBookings` nach der Bindung anstellt, und an keinem Tag darf eine
  Version entstehen. Ein Vertrag ohne Ende verspricht Betreuung über das
  Schuljahr hinaus; auch dafür schreibt die Anpassung keine Version
  (`care_ends` nach dem Ende der Phase), das hält keine Zeile zurück.
  Zweitens der direkte Vergleich: Die Anpassung übernimmt aus den Buchungen
  nur die Module, die sich an einem Tag ändern. Beginnt die geltende Version
  eines älteren Vertrags nach ihrer Buchung (Phase ab 01.08., zweite
  Version ab 01.10.), gibt es keinen solchen Tag, und eine abweichende
  Endzeit bliebe unbemerkt. Deshalb
  vergleicht der Plan versprochene und gebuchte Betreuung an jedem Tag, an
  dem eine Buchung, eine Version, ein Modul oder der Vertrag beginnt oder
  endet: Wochentag, Modul und Endzeit. Bereit heißt: Die Buchungen sind der
  Vertrag.
- **Die Vergangenheit zählt, soweit sie gebucht wird.** Abgeleitete
  Buchungen werden von ihrem ersten Tag an verglichen, vor heute mit der
  heute geltenden Version: Versionen davor bucht niemand. Vor dem ersten
  Tag des Vertrags verspricht er nichts; eine Buchung dort ist nicht die
  des Vertrags. Die Buchungen einer bestehenden Anmeldung werden ab heute
  verglichen. Was davor liegt, hat die Schule genehmigt, lässt sich nicht
  mehr ändern und erzeugt keine Version.
- **Abweichende Endzeiten bleiben zurück.** Weicht die Endzeit eines
  Wochentags im Vertrag von der des Moduls ab, etwa weil eine
  Angebotskorrektur (ADR 0306) die alte Endzeit behielt, würde die Buchung
  eine neue Version mit der Endzeit des Moduls erzeugen. Der Standard ist:
  Die Zeile bleibt zurück (`end_time`), nie eine stille neue Version. Das
  Büro berichtigt den Vertrag oder das Modul.
- Nicht ableitbar, jeweils mit Grund: Vertrag nicht aktiv, Vertrag noch nicht
  begonnen, Modul kein Betreuungsangebot der Schule mehr, Module der
  geltenden Version aus zwei Phasen (`two_phases`), Phase noch nicht
  begonnen oder beendet, Modul mit festen Tagen an
  anderen Tagen, Tag vom Modul nicht angeboten, Betreuung versprochen ohne
  Buchung in der Phase. Ein Modul der geltenden Version, dessen letzter Tag
  vorbei ist, wird nicht gebucht und entscheidet nichts, auch nicht über
  die Phase.
- **Gekündigte Verträge werden nicht angemeldet** (`contract_not_active`),
  auch wenn sie bis zu ihrem letzten Tag weiterlaufen. Die Anpassung liest
  nur aktive Verträge. Ein gebundener gekündigter Vertrag folgte seinen
  Buchungen nicht mehr: Eine genehmigte Buchungsänderung erzeugte keine
  Version, Vertrag und Buchungen liefen auseinander, ohne dass es jemand
  sieht. Das Kind bleibt bis zum Ende so betreut wie vor dem Lauf; nimmt das
  Büro die Kündigung zurück, nimmt der nächste Lauf den Vertrag mit.
- **Geplante Änderungen bleiben schon im Plan zurück** (`planned_change`).
  Hat der Vertrag eine Version, die erst nach heute beginnt, zeigt die
  Zeile die abgeleiteten Buchungen und die Änderung, ist aber nicht bereit:
  Die stille Anmeldung schreibt keine datierte Änderung (Abschnitt 2). Plan
  und Anmeldung sagen dasselbe. Das gilt auch für eine geplante Version,
  deren Module zur nächsten Phase gehören: Sie heißt `planned_change`,
  nicht `two_phases`; heute hat der Vertrag eine Phase. Ausnahme: Trägt eine bestehende Anmeldung
  des Kindes die Änderung schon in ihren Buchungen, wird der Vertrag an sie
  gebunden; dafür wird nichts geschrieben. Die geplante Änderung antwortet
  vor der Prüfung, ob ein Modul aktiv ist, und diese Prüfung gilt nur den
  Modulen, die der Lauf jetzt buchen würde: Ein deaktiviertes Modul der
  geplanten Version hält für sich nichts zurück.
- Hat das Kind in der Phase schon eine angenommene Anmeldung, bekommt es
  keine zweite. Der Vertrag wird an genau diese gebunden, wenn es die
  einzige ist, sie keinen Vertrag hat und ihre eigenen Buchungen den Beweis
  bestehen; sonst bleibt die Zeile zurück (`has_application`). So beendet
  auch ein neuer Lauf einen abgebrochenen: Er findet die Anmeldung des
  ersten Laufs und bindet. Bewiesen wird, was gespeichert ist, nicht was der
  Plan heute ableiten würde: Ist seit dem ersten Lauf der letzte Tag eines
  Moduls vergangen, bucht die gespeicherte Anmeldung es weiter bis zu diesem
  Tag, und der Vertrag wird trotzdem gebunden. Der Beweis des Plans allein
  bindet nichts: Die Zeile trägt die Buchungen der Anmeldung ab heute und
  den Tag des Plans (`ApplicationBookings`, `ProvedOn`), und die Anmeldung
  der Schule bestätigt sie unter ihren Sperren (Abschnitte 2 und 3).
- **Ein abgebrochener Lauf wird auch nach dem Ende des letzten Moduls
  beendet.** Die Schule hat Buchungen bis zum 30.06. gespeichert, der Lauf
  brach vor der Bindung ab, und am 01.07. verspricht der Vertrag nichts
  mehr: Abgeleitet wird nichts (`care_ends`). Hat das Kind in der laufenden
  Phase der Module genau eine angenommene Anmeldung ohne Vertrag, ist die
  Zeile trotzdem bereit, mit dieser Anmeldung. Der Beweis ist derselbe wie
  für einen laufenden Vertrag, nur über die Zeit des Vertrags statt ab
  heute, weil ab heute nichts mehr zu vergleichen ist: Die Anpassung
  schreibt keine Version; ab dem ersten Tag, an dem der Vertrag in der
  Phase Betreuung versprach, läuft keine Buchung, die er nicht versprach;
  und am letzten Tag, an dem er Betreuung versprach, sind die Buchungen
  genau diese Betreuung (Wochentag, Modul, Endzeit). Der letzte Teil ist
  nötig, weil die Vergangenheit sonst nur so weit zählt, wie sie gebucht
  ist, und eine Anmeldung mit weniger Betreuung durchginge. `ProvedOn` ist
  dann dieser erste Tag, und `ApplicationBookings` sind alle Buchungen der
  Anmeldung in der Phase: Die Anmeldung der Schule bestätigt das Ganze,
  nicht einen leeren Rest. Ein eigener Grund (`enrolled_unbound`) für einen
  späteren Schritt wurde verworfen: Der Beweis gelingt, und die Zeile ginge
  denselben Weg über Bestätigung und Bindung. Eine Anmeldung, die den
  Beweis nicht besteht, hält die Zeile als `has_application` zurück; ohne
  Anmeldung und nach dem Ende der Phase bleibt es bei `care_ends`. Hat der
  Vertrag eine Version, die erst nach heute beginnt, heißt eine solche
  Zeile `planned_change`: Das ist es, was der Anmeldung fehlt.
- **Die Phase des abgebrochenen Laufs kommt aus der gespeicherten
  Anmeldung.** Nennt die geltende Version auch ein längst beendetes Modul
  und hat die Schule dessen Phase seither verlängert, laufen heute zwei
  Phasen unter den Modulen des Vertrags. Der Plan fragt deshalb jede dieser
  Phasen: Bereit ist die Zeile in der Phase, in der das Kind die Anmeldung
  hat, die den Beweis besteht. Besteht keine, antwortet die erste Phase mit
  einer Anmeldung, zurückgehalten. Vorher blieb der Vertrag bei zwei
  laufenden Phasen für immer `care_ends`.
- **Eine stille Anmeldung ohne Vertrag wird genannt.** Der Plan liest die
  Herkunft der angenommenen Anmeldungen (`Application.ContractImport`) und
  den Vertrag, für den die stille Anmeldung angelegt wurde
  (`Application.ImportContractID`; die Anmeldung speichert ihn in
  `source_metadata.contract_id`). Hat die Kinderakte eines Vertrags, der
  nicht erledigt ist, eine Anmeldung der Herkunft `contract_import` ohne
  Vertrag, **die für genau diesen Vertrag angelegt wurde**, nennt die Zeile
  sie (`EnrollmentChildID`), in welcher Phase auch immer. Die verwaiste
  Anmeldung eines anderen Vertrags des Kindes zählt nicht: Ein
  zurückgehaltener Folgevertrag heißt nicht „hängt“, weil die Anmeldung
  seines Vorgängers ohne Vertrag geblieben ist. Eine bereite Zeile
  bindet sie. Bleibt die Zeile zurück, kann der Vertrag nicht mehr an sie
  gebunden werden: Die Phase ist beendet, oder ihre Buchungen bestehen den
  Beweis nicht mehr. Der Workflow zeigt eine solche Zeile mit eigenem Status
  (Abschnitt 4, „hängt“).
- **Ein Vertrag hat eine stille Anmeldung.** Solange die für ihn angelegte
  Anmeldung ohne Vertrag ist, ist seine Zeile nur bereit, um genau diese
  Anmeldung zu bestätigen und zu binden. Sie meldet das Kind nie neu an und
  bindet keine andere Anmeldung. Der Fall: Die Schule hat in Phase A
  angemeldet, die Bindung blieb aus, und das Büro hat den ungebundenen
  Vertrag auf ein Modul einer überlappenden Phase B berichtigt. In Phase B
  hat das Kind keine Anmeldung; der Plan hätte es dort neu angemeldet, und
  die genehmigte Anmeldung aus Phase A wäre daneben geblieben. Die Zeile
  bleibt stattdessen zurück (`has_application`), nennt die Anmeldung und
  hängt, bis das Büro den Vertrag zurück auf ein Modul der Phase A
  berichtigt; der nächste Lauf bindet dann (Abschnitt 4, „hängt“). Die
  Anmeldung der Schule hält dieselbe Regel unter ihren Sperren
  (`enrolled_elsewhere`, Abschnitt 2).
- **Ein deaktiviertes Modul hält eine neue Anmeldung zurück**
  (`offering_inactive`), mit demselben Grund wie in der Anmeldung
  (Abschnitt 2). An eine bestehende Anmeldung, die das Modul schon bucht,
  wird trotzdem gebunden.
- **Zwei importierte Verträge eines Kindes nacheinander in einer Phase.**
  Vertrag A endet am 31.12. und ist an die Anmeldung des Kindes gebunden,
  Vertrag B beginnt am 01.01. Ein Kind einer Anmeldung hat einen Vertrag,
  also bleibt B zurück, mit eigenem Grund: `follows_contract` und der
  Kennung von A (`FollowsContractID`). Das Büro behandelt den Fall als
  Vertragsänderung; einen Weg dafür bietet der Folge-PR an.
- **`has_application` heißt auf beiden Seiten dasselbe, die Anmeldung
  entscheidet.** Der Plan liest nur angenommene Anmeldungen, aus denen ein
  Vertrag entstehen kann. Die Schule sieht mehr: eine Anmeldung, die auf
  eine Entscheidung wartet, und eine, die das Büro der Kinderakte zugeordnet
  hat (`matched_by_office`). Für jede davon antwortet
  `EnrollContractChildren` mit `has_application`. Diese Antwort gilt: Eine
  Zeile, die der Plan bereit nennt, bekommt dann weder Anmeldung noch
  Bindung, und der Workflow zeigt sie als zurückgehalten.
- **Die Zeile trägt, worauf sie bewiesen wurde.** Je Buchung die Endzeiten
  des Moduls an den gebuchten Wochentagen, seine angebotenen Tage und ob sie
  fest sind; je Zeile Betreuungsbeginn und -ende der Phase. Der Plan liest
  nur Angebote, die als Betreuung zählen; jede Buchung der Zeile setzt das
  voraus. Die Anmeldung vergleicht das unter ihren Sperren (Abschnitt 2).
- Ein Vertrag ohne Kinderakte wird nur genannt („ohne Kinderakte“); das Büro
  verknüpft ihn zuerst (ADR 0307). Ein gebundener Vertrag gilt als erledigt.
- Der Plan zeigt dem Träger-Büro Kinderakten und Anmeldungen der Schule. Er
  läuft nur in der Tenant-Transaktion genau dieser Schule (ein Lesen einer
  anderen Schule wird abgelehnt), und der Workflow schreibt das Lesen in
  derselben Transaktion ins Zugriffsprotokoll der Schule (ADR 0084 §7).
- **Der Plan liest nur, was er braucht.** Er fragt Enrollment nach den
  angenommenen Anmeldungen der Kinderakten, mit denen die ungebundenen
  Verträge verknüpft sind (`AcceptedStudentApplications`), und nach keiner
  anderen: Die Anmeldungen der übrigen Familien der Schule werden nicht
  geladen. Die Bindung im Root reicht davon das Anmeldekind, die Kinderakte
  und die Herkunft weiter, keine Angabe der Erziehungsberechtigten. Die
  erste Fassung las alle angenommenen Anmeldungen der Schule samt
  Erziehungsberechtigten und filterte danach.

### 2. Die stille Anmeldung (Enrollment)

`enrollment.ContractEnrollments.EnrollContractChildren` legt in der
Tenant-Transaktion der Schule je Kind eine Anmeldung mit der Herkunft
`contract_import` an: ohne Erziehungsberechtigte, ohne Adresse, ohne Konto,
ohne Einwilligungen und ohne Rechtsnachweis, mit einem genehmigten Kind, das
auf die bestehende Kinderakte zeigt, mit den Buchungen des Plans und den
Rostern, die eine Genehmigung daraus ableitet. `reviewed_at` trägt den
Zeitpunkt, den der Vertrag als Annahme liest.

Sie ändert weder Kinderakte noch Erziehungsberechtigte, Beziehungen, Konten,
Einwilligungen oder Wochenpläne und schreibt keine Mail, keinen Push und
keine Einladung. Was aus den Buchungen folgt, wird wie nach jeder
Genehmigung neu abgeleitet: Eine kommende Abhol-Ausnahme des Kindes behält
Tag, Zeit und Grund; ihre automatische Entschuldigung, die entschuldigten
Blöcke und die Aufgabe des Personals für den Tag richten sich danach an der
gebuchten Endzeit aus (`ResyncFutureExceptions`). Holt jemand das Kind an
einem Montag um 13:00 ab und endet die Buchung um 14:30, ist es danach ab
13:00 entschuldigt. Weil die Anmeldung keine Adresse trägt, findet sie kein
Elternkonto im Elternportal. Sie ruft bewusst nicht auf: die Abgabe
(`Submit`), die Entscheidung mit Mail und Einladung (`Decide`,
`DecideAndInvite`), die Verlängerung der Kinderakte, alles zu
Erziehungsberechtigten, die Formularfelder, den Wochenplan und die
Bekanntgabe der Abholzeiten, die die Erziehungsberechtigten im Elternportal
erreicht.

- Wiederholbar: Ein Kind, das die Anmeldung dieser Herkunft in der Phase
  schon hat, wird mit ihr beantwortet. Verglichen werden die Wochentage, die
  eine Buchung wirksam hält, und ihr Zeitraum, nicht nur die angekreuzten
  Tage. Hat eine Korrektur des Büros seit dem ersten Lauf einen Tag
  mitgebucht (eine Mitbuchungs-Regel), ist die Anmeldung nicht mehr die des
  Plans: `bookings_differ`. Was nur eine neue Anmeldung verhindert, lehnt
  die Wiederholung nicht ab (`roster_bound`, `window_too_short`,
  `offering_inactive`, ein Beginn nach heute, `care_ends_earlier`): Für die
  gespeicherte Anmeldung wird nichts geschrieben. Hat das Büro nach einem
  abgebrochenen Lauf das Angebot direkt mit einem Roster verknüpft oder
  deaktiviert, antwortet der nächste Lauf `existing`, und der Vertrag wird
  gebunden.
- Ein Kind mit einer anderen Anmeldung in der Phase bekommt keine
  (`has_application`). Gemeint ist jedes Kind einer Anmeldung der Phase, das
  die Kinderakte hält und weder abgelehnt noch zurückgezogen ist.
- **Ein Vertrag hat eine stille Anmeldung, auch über Phasen und
  gleichzeitige Läufe hinweg** (`enrolled_elsewhere`). Der Plan hält die
  Zeile eines Vertrags zurück, dessen stille Anmeldung in einer anderen
  Phase steht (Abschnitt 1), aber er liest vor den Sperren: Lauf A meldet
  das Kind für Vertrag C in Phase A an und hat noch nicht abgeschlossen, das
  Büro berichtigt den ungebundenen Vertrag auf ein Modul der überlappenden
  Phase B, Lauf B plant Phase B, ohne die Anmeldung von A zu sehen, und
  wartet an den Sperren der Genehmigung. Die Anmeldungen der Phase B allein
  zeigen sie ihm auch danach nicht. Die Anmeldung liest deshalb unter den
  Sperren, im selben Statement wie die Anmeldungen der Phase, auch die
  Anmeldungen der Herkunft `contract_import` der Kinderakten in jeder
  anderen Phase, mit dem Vertrag, für den sie angelegt wurden
  (`source_metadata.contract_id`). Nennt eine davon den Vertrag der Zeile
  und ist sie weder abgelehnt noch zurückgezogen, wird die Zeile abgelehnt,
  nennt diese Anmeldung, und nichts wird geschrieben, in
  `CheckContractChildren` wie im Lauf. Die Anmeldung eines anderen Vertrags
  des Kindes hält nichts zurück. Die Regel gilt der neuen Anmeldung; eine
  Zeile, die eine Anmeldung der eigenen Phase nur bestätigt, schreibt
  nichts und wird nicht danach gefragt. **Was die Läufe ordnet:** Die
  Sperren der Genehmigung (`LockApprovalGates`: die Sperre der
  Klassenzuordnungen und die der Wiederholungen,
  `schedule.TenantRecurrenceLockKey`) gelten je Schule, nicht je Phase, und
  bis zum Ende der Transaktion. Zwei Läufe einer Schule laufen deshalb
  nacheinander, auch für verschiedene Phasen; die Sperre je Phase
  (`AcquireExistingStudentMatchLock`) allein ordnete sie nicht.
- **Ein überholter Plan wird abgelehnt** (`changed`). Unter den Sperren der
  Genehmigung vergleicht die Anmeldung, was die Zeile vom Plan mitbringt,
  mit der Schule: Betreuungsbeginn und -ende der Phase, je Buchung
  Endzeiten, angebotene Tage und Tagesmodus des Moduls, und dass das Modul
  noch als Betreuung zählt (`CountsAsCare`): Die Vertragsanpassung liest nur
  solche Angebote, ein anderes fiele nach der Bindung aus dem Vertrag. Hat
  die Schule zwischen Plan und Anmeldung etwas davon geändert, schreibt die
  Anmeldung nichts: Die Buchungen wurden gegen eine Schule bewiesen, die es so nicht
  mehr gibt. Der nächste Lauf plant neu.
- **Angelegt wird die Kinderakte, die das Büro bestätigt hat.** Die stille
  Anmeldung speichert Vornamen, Nachnamen und Geburtsdatum der Kinderakte
  in ihrem Anmeldekind. Der Lauf prüft den Fingerabdruck, bevor die
  Anmeldung die Kinderakte unter ihren Sperren liest; ändert das Personal
  dazwischen Namen oder Geburtsdatum, stünde die neue Angabe unter der
  alten Bestätigung. Jede Zeile trägt deshalb die Kinderakte, wie die
  Vorschau sie zeigte (`ContractEnrollment.Confirmed`), und die Anmeldung
  vergleicht sie mit der gelesenen. Weicht sie ab, antwortet sie `changed`
  und schreibt nichts, auch nicht für eine Anmeldung, die sie nur
  bestätigen würde. Eine Kinderakte, die die Vorschau nicht zeigen konnte,
  geht als leere Angabe mit, nie als keine.
- **Eine bewiesene Anmeldung wird bestätigt, nicht angelegt.** Nennt die
  Zeile das Kind einer Anmeldung (`RequestChildID`), prüft die Anmeldung
  unter denselben Sperren: Dieses genehmigte Kind ist das einzige der
  Phase, das die Kinderakte hält, das Büro hat es nicht zugeordnet, und
  seine gespeicherten Buchungen ab dem Tag des Plans sind die, die der Plan
  bewiesen hat (Angebot, Wochentage, Zeitraum, mit Phase und Modul wie
  gelesen). Dann antwortet sie `existing` mit dieser Kennung, sonst
  `changed`, bei einer weiteren Anmeldung des Kindes `has_application`.
  Ändert das Büro zwischen Plan und Anmeldung die Wochentage der Anmeldung,
  ist die Antwort `changed`. Geschrieben wird dafür nichts.
- **Eine Bestätigung gilt nur für eine aktive Kinderakte.** Bestätigt wird
  eine Anmeldung, um den Vertrag an sie zu binden. Ist die Kinderakte
  inzwischen nicht mehr aktiv oder gibt es sie nicht mehr, antwortet die
  Anmeldung `refused` mit `student_inactive` oder `student_missing` und
  nennt die Anmeldung, die es gibt, auch für die gespeicherte Anmeldung
  dieser Herkunft eines abgebrochenen Laufs. An die Anmeldung eines Kindes,
  das die Schule verlassen hat, wird kein Vertrag gebunden: Das Büro beendet
  den Vertrag oder die Schule aktiviert die Kinderakte wieder. Sonst
  wiederholt die Bestätigung nichts, wofür nur eine neue Anmeldung abgelehnt
  wird (Betreuungsende, OGS-Platz, Roster, Fenster).
- **Kinderakten werden ohne Sperre gelesen.** Status und Betreuungsende
  (`enrolled_until`) liest die Anmeldung unter den Sperren der Genehmigung,
  aber die Kinderakte selbst sperrt sie nicht: People Directory bietet
  Enrollment dafür keine Sperre, und die übliche Genehmigung hält auch
  keine. Deaktiviert die Schule die Kinderakte oder trägt sie ein
  Betreuungsende ein, während der Lauf die Kinder anmeldet, kann ein Kind
  angemeldet werden, das der Lauf einen Moment später abgelehnt hätte.
  Bekannte Lücke; das Ergebnis ist dasselbe wie nach einer Genehmigung, auf
  die ein Betreuungsende folgt, und Care Plan kappt die Roster dann am
  Betreuungsende.
- **Eine Schule ohne abgeleitete Betreuung wird abgelehnt**
  (`care_offerings_off`). Ist `enrollment.care_offerings_enabled` für die
  Schule aus, schreibt eine Genehmigung kein Roster; die Anmeldung gäbe dem
  Kind Buchungen, die die tägliche Betreuung nie zeigt.
  `CheckContractChildren` und `EnrollContractChildren` lehnen dann jede
  Zeile ab, bevor sie etwas lesen, sperren oder schreiben.
- Abgelehnt je Zeile, ohne etwas zu schreiben: Kinderakte fehlt, ist nicht
  aktiv, hat keinen Betreuungsplatz oder kein Geburtsdatum; Angebot gehört
  nicht zur Phase; Tag wird nicht angeboten; Buchungen beginnen vor dem
  Betreuungsbeginn der Phase, nach heute oder nicht am selben Tag
  (`booking_window`); eine befristete Buchung auf einem direkt verknüpften
  Roster (`roster_bound`), ein Betreuungsende der Kinderakte vor dem Ende
  der Buchungen (`care_ends_earlier`) und ein Fenster ohne einen gebuchten
  Wochentag (`window_too_short`), alle drei siehe unten; ein deaktiviertes
  Angebot (`offering_inactive`).
- **Ein deaktiviertes Angebot bekommt keine neue Anmeldung**
  (`offering_inactive`). Ein Roster mit mehreren Quellen lässt eine
  deaktivierte Quelle aus (`acceptOfferingSources`). Bucht der Vertrag nur
  dieses Angebot, wäre das Kind genehmigt und sein Vertrag gebunden, aber
  auf keinem Roster. Die Anmeldung lehnt die Zeile deshalb ab, in
  `CheckContractChildren` wie im Lauf, bevor etwas geschrieben wird.
- **Der erste Tag der Buchungen liegt nie nach heute.** Der Plan bucht nur
  einen Vertrag und eine Phase, die begonnen haben. Die Anmeldung lehnt
  einen späteren Beginn ab (`booking_window`), statt sich darauf zu
  verlassen: Eine Korrektur des Büros ohne Datum liest die Buchungen am
  heutigen Tag und fände eine künftige Buchung nicht als die geltende.
- **Ein eingetragenes Betreuungsende hält die Zeile zurück**
  (`care_ends_earlier`). Nennt die Kinderakte einen letzten Betreuungstag
  (`enrolled_until`) vor dem letzten Tag einer Buchung, schreibt die
  Anmeldung nichts: Care Plan kappt die Roster am Betreuungsende, die
  Buchungen stünden darüber hinaus, und der Vertrag verspräche Betreuung,
  die die Schule beendet hat. Gelesen wird die Kinderakte unter den Sperren
  der Genehmigung. Das Büro klärt Vertragsende oder Betreuungsende.
- **Ein zu kurzes Fenster bricht den Lauf nicht ab** (`window_too_short`).
  Care Plan prüft für ein direkt verknüpftes Roster, dass jeder gebuchte
  Wochentag im Fenster vorkommt, und antwortet sonst mit einem Fehler. Mit
  dem Fenster ab dem ersten Tag des Vertrags wäre das der Abbruch für alle
  Zeilen des Aufrufs: Vertrag ab Donnerstag, 29.07., Phase bis 31.07.,
  Angebot montags und freitags. Die Anmeldung prüft deshalb vorab je
  Buchung, ob jeder ihrer Wochentage in ihrem Zeitraum liegt, und lehnt nur
  diese Zeile ab, in `CheckContractChildren` wie im Lauf.
- **Das Roster beginnt mit der Buchung.** Care Plan liest die Buchungen
  einer Genehmigung am ersten Tag des Fensters, das es bekommt, und beginnt
  die Roster-Zeilen dort (`MaterializeApprovedBookings`,
  `ResyncMultiSourceTemplatesForChild`). Am Betreuungsbeginn der Phase
  gelesen, hätte ein Kind mit späterem Vertragsbeginn keine Buchung und
  bekäme kein Roster. Die übliche Genehmigung kennt den Fall nicht: Sie
  bucht immer die ganze Phase, auch mitten im Jahr, und einen späteren
  Beginn schreibt nur die Stichtagsänderung (`AdjustOfferings`), die die
  Erziehungsberechtigten erreicht. Die stille Anmeldung gibt den
  Bausteinen deshalb die Phase ab dem ersten Tag der Buchungen. Geprüft für
  beide Wege zum Roster (direkte Verknüpfung und Quellregel): Zeile ab dem
  ersten Tag des Vertrags, kein Termin davor. Alle Buchungen eines Kindes
  beginnen deshalb am selben Tag.
- **Geplante Änderungen bleiben zurück** (`planned_change`). Eine datierte
  Änderung der Buchungen eines genehmigten Kindes läuft über Care Plans
  `AdjustOfferings`, und die endet in der Bekanntgabe an die
  Erziehungsberechtigten im Elternportal. Die stille Anmeldung schreibt
  deshalb keine. Das Kind wird angemeldet, sobald die geplante Version gilt.
  Der Plan hält solche Zeilen selbst zurück (Abschnitt 1); die Anmeldung
  lehnt sie zusätzlich ab.
- **Eine befristete Buchung auf einem direkt verknüpften Roster bleibt
  zurück** (`roster_bound`). Benennt ein Angebot sein Roster über die
  direkte Verknüpfung `ActivityGroupID`, schreibt Care Plan die Roster-Zeile
  des Kindes bis zum Ende der Phase, auch wenn die Buchung früher endet
  (Modul mit letztem Tag, Vertrag mit Ende). Das Kind bliebe auf dem Roster
  und seinen Terminen. Die stille Anmeldung lehnt deshalb jedes Kind ab, das
  eine solche Buchung vor dem Betreuungsende der Phase beendet, in
  `CheckContractChildren` wie im Lauf, bevor etwas geschrieben wird. Zwei
  Buchungen eines Kindes auf einem solchen Roster mit verschiedenem Ende
  sind derselbe Fall: Eine davon endet vor der Phase. Der Fehler in Care
  Plan besteht für jede Genehmigung mit befristeter Buchung und bleibt in
  diesem PR bestehen (siehe „Bekannte Grenze“).
- **Eine Korrektur des Büros ohne Datum behält den ersten Tag.** Die
  Korrektur (`UpdateChildOfferings` ohne `effective_from`) ersetzt die
  Buchungen ab dem Betreuungsbeginn der Phase und leitet die Roster von
  dort neu ab. Ein ab dem 04.01. still angemeldetes Kind wäre danach ab
  August gebucht und auf dem Roster. Für Kinder einer Anmeldung der
  Herkunft `contract_import` beginnt die Korrektur deshalb am ersten Tag
  ihrer gespeicherten Buchungen, wenn er nach dem Betreuungsbeginn liegt,
  und die Roster werden ab diesem Tag neu abgeleitet. Care Plan liest dafür
  ein Kennzeichen der Anmeldung (`StartsWithFirstBooking`), das die Bindung
  im Root aus der Herkunft setzt; ein zusätzliches Statement gibt es nicht.
  Die Regel liest die Herkunft, weil sie sonst bestehende Kinder träfe:
  Ein Kind, das ohne Angebot genehmigt wurde und seine erste Buchung über
  eine Stichtagsänderung mitten im Jahr bekam, wird von einer Korrektur
  ohne Datum heute ab dem Betreuungsbeginn gebucht. Das ist derselbe Fehler
  und bleibt für bestehende Kinder unverändert (siehe „Bekannte Grenze“).
- **Ansichten des Personals aktualisieren sich nicht von selbst.** Die
  Bekanntgabe der Abholzeiten (`ReconcileOfferingPickupForStudents`) weckt
  in einem Aufruf die Erziehungsberechtigten im Elternportal und das
  Personal (Abholplan der Schule, Hinweise des Tagesplans, #5498). Care
  Plan hat keine Fähigkeit nur für den Teil des Personals; eine neue wäre
  eine eigene Schnittstelle samt Bindung und kein kleiner Aufruf. Die
  stille Anmeldung lässt den Aufruf deshalb ganz weg. Bekannte Grenze:
  Offene Ansichten des Personals zeigen die neuen Kinder nach dem Neuladen.
- **Die Zahl der Statements der Anmeldung selbst wächst nicht mit den
  Kindern.** Enrollment liest und schreibt in Mengen: Kinderakten und
  Personen, Angebote, Anmeldungen der Phase und deren Buchungen je einmal;
  Anmeldungen, Kinder und Wahlen in je einem Insert, die Genehmigungen in
  einem Update.
  **Rest:** Was aus den Buchungen eines Kindes entsteht, schreibt Care Plan
  mit den Bausteinen einer Genehmigung je Kind: Buchungen
  (`RecordCareOfferingBookings`), Roster (`MaterializeApprovedBookings`) und
  Roster mit mehreren Quellen (`ResyncMultiSourceTemplatesForChild`). Die
  Entschuldigungen der Abholzeiten sind ein Aufruf für alle Kinder, den
  Care Plan ebenfalls Kind für Kind abarbeitet: Kinderakte sperren, kommende
  Abhol-Ausnahmen lesen, jede unter der Sperre ihres Tages neu ableiten.
  Gemessen in der Zusammensetzung der Produktion (mit
  `ResyncFutureExceptions`), mit einem Angebot, einem Roster und je Kind
  einer kommenden Abhol-Ausnahme, die eine Entschuldigung bekommt:
  46 Statements für ein Kind, 31 je weiteres Kind (3 + 9 + 3 + 16; ohne
  kommende Ausnahme 2 statt 16). Die erste Fassung dieses ADR nannte 30 und
  15; ihr Test hatte den Aufruf für die Entschuldigungen nicht gebunden. Eine Mengenform wäre ein Umbau des
  Roster-Schreibers, den auch `Decide` und die Verlängerung nutzen, kein
  Zusatz zu diesem Lauf. Das Query-Budget
  `services.enrollment.contract_enrollments.enroll` hält beide Zahlen fest;
  der Rest ist dort exakt geprüft.
  **Dazu kommt ein Glied je Phase**, nicht je Kind: Jede Phase eines Aufrufs
  wird gesperrt (`AcquireExistingStudentMatchLock`), und ihre Angebote und
  die Anmeldungen, die ihre Kinder halten, werden je Phase einmal gelesen.
  Gemessen: 2 Statements je weitere Phase in `CheckContractChildren`
  (Angebote, Halter), 3 in `EnrollContractChildren` (dazu die Sperre); hat
  eine Phase Halter, deren Buchungen verglichen werden, kommt deren Lesen
  dazu. Der Test des Budgets prüft beide Zahlen mit zwei Phasen. Bereit ist
  eine Zeile nur in einer Phase, deren Betreuung heute läuft; eine Schule
  hat davon selten mehr als eine.
- **Buchungen einer bestehenden Anmeldung werden nicht überschrieben**
  (`bookings_differ`). Die Roster eines genehmigten Kindes werden einmal
  abgeleitet; das Büro ändert die Buchungen auf dem üblichen Weg.
- Ein genehmigtes Kind dieser Herkunft belegt seinen Platz wie jedes andere.
  Eine Kapazitätsprüfung gibt es nicht: Die Kinder werden schon betreut.

Die Herkunft `contract_import` gilt überall als vom Büro eingetragen: keine
Unterschrift der Eltern, kein Annahmenachweis für einen Vertragsabschluss,
und eine spätere Änderung hält keine Elternidentität fest. In Listen des
Büros heißt sie „Aus importiertem Vertrag“.

### 3. Die Bindung (Care Contract)

`BindApplications` setzt `request_child_id` eines importierten Vertrags, in
der Träger-Transaktion, unter der Sperre der Verknüpfungen (ADR 0307) und den
Zeilensperren der Verträge. Es prüft erneut: importiert, aktiv, ungebunden,
dieselbe Kinderakte, dieselbe Zeitleiste wie im Plan, und das Kind der
Anmeldung hat noch keinen Vertrag. Die Kinderakte der Bindung ist die, für
die die Anmeldung der Schule geantwortet hat
(`ContractEnrollmentResult.StudentID`): Der Aufrufer reicht die Antwort
weiter und ordnet sie über Vertrag und Kinderakte zu, nie über die Position
im Aufruf. Die Bindung traut dem nicht und vergleicht unter den Sperren mit
der Kinderakte, mit der der Vertrag verknüpft ist; eine Antwort für eine
andere Kinderakte oder für keine ist `changed`, auch bei einem schon
gebundenen Vertrag. Ein Vertrag, der sich geändert hat, bleibt
ungebunden (`changed`). Die Bindung schreibt in den Verlauf
(`bind_application`) und sonst nichts: keine Version, kein Dokument, kein
Versand. Eine wiederholte Bindung ändert nichts. Nennt ein Aufruf einen
Vertrag zweimal, bekommt jede Zeile ihre Antwort; der Aufruf scheitert nicht.

**Gebunden wird nur, was die Anmeldung unter ihren Sperren bestätigt hat.**
Es gibt eine Regel, keine zwei: Jede Zeile, die gebunden werden soll, geht
in der Transaktion der Schule durch `EnrollContractChildren`, und
`BindApplications` bindet nur auf dessen Antwort `enrolled` oder `existing`
(`ApplicationBinding.Enrollment`). Ohne diese Antwort ist jede Bindung
`changed`.

- Nennt die Zeile ein Kind einer Anmeldung (die bewiesene bestehende
  Anmeldung), bestätigt die Anmeldung der Schule genau dieses Kind
  (Abschnitt 2) und antwortet `existing`. Das Kind wird nicht angemeldet.
  Das Kennzeichen der Zeile (`Token`) hält dieses Kind fest: Eine Bindung an
  ein anderes ist `changed`.
- Nennt sie keines, meldet die Anmeldung das Kind an (`enrolled`) oder
  findet die Anmeldung dieser Herkunft mit denselben Buchungen
  (`existing`); gebunden wird an das Kind dieser Antwort.

Der Beweis des Plans allein bindet nie: Der Plan liest die Buchungen einer
Anmeldung in einem früheren Statement, und das Büro kann sie bis zu den
Sperren der Anmeldung ändern. Auf `has_application`, `changed` oder eine
Ablehnung der Anmeldung folgt nie eine Bindung. Eine Anmeldung, die auf
eine Entscheidung wartet, eine später abgelehnte und eine vom Büro
zugeordnete werden deshalb nie gebunden.

**Das verbleibende Fenster.** Zwischen der Transaktion der Schule
(Bestätigung) und der Träger-Transaktion (Bindung) hält keine Transaktion
beide Scopes (ADR 0105). In dieser einen Anfrage kann die Schule eine
bestätigte Anmeldung noch ablehnen oder ihre Buchungen ändern. Der Vertrag
stünde dann an einer abgelehnten Anmeldung, oder die Vertragsanpassung
schriebe für die geänderten Buchungen eine Version, wie für jede genehmigte
Buchungsänderung nach der Bindung. Beides bleibt als bekannte Lücke stehen;
der Weg zurück (Bindung lösen, siehe unten) ist auch dafür gedacht.

Für den Zustand „beide Ursprünge gesetzt“ gilt:

- Der Vertrag folgt seinen Buchungen (`AmendableContracts`); die
  Zusammenfassung sagt es (`follows_bookings`). `imported` und `taken_over`
  bleiben wahr.
- **Die Vertragsanpassung folgt keinen Buchungen, von denen der Vertrag
  gelöst wurde.** `AmendFromBookings` liest die gebundenen Verträge, dann
  die Buchungen der Schule, und schreibt erst danach unter der Zeilensperre
  des Vertrags. Löst das Büro die Bindung dazwischen, vergleicht die
  Anpassung unter der Sperre das Anmeldekind des Vertrags mit dem, dessen
  Buchungen sie gelesen hat (`lockedTimeline`), und schreibt bei einer
  Abweichung nichts. Bindung und Lösen nehmen dieselbe Zeilensperre.
  Das Anmeldekind allein zeigt nicht, wenn das Büro dazwischen gelöst und
  wieder an dasselbe Kind gebunden hat: Die Anpassung hat eine neue
  Donnerstag-Buchung gelesen, das Büro löst, die Schule nimmt den Donnerstag
  zurück, das Büro bindet nach dem Beweis neu, und der alte Plan schriebe
  den Donnerstag doch in eine Version. Die Anpassung vergleicht deshalb
  unter der Sperre auch den Stand der Vertragszeile (`updated_at`) mit dem,
  den `AmendableContracts` gelesen hat. Der Trigger der Tabelle setzt ihn
  bei jeder Änderung der Zeile, und Bindung wie Lösen ändern die Zeile. Bei
  einer Abweichung schreibt die Anpassung nichts; der nächste Lauf liest
  neu. Das gilt auch nach jeder anderen Änderung der Zeile dazwischen.
- Die Verknüpfung mit der Kinderakte lässt sich nicht mehr lösen
  (`care_contract.child_link_bound`, 409): Anmeldung und Buchungen gehören zu
  dieser Kinderakte. Eine falsche Verknüpfung aus Teil 1 lässt sich nach
  der Bindung deshalb nur über den Weg zurück berichtigen: Bindung lösen
  (siehe „Der Weg zurück“ in Abschnitt 4), dann die Verknüpfung lösen und
  neu setzen. Damit es selten dazu kommt, zeigt die Vorschau des Workflows
  je Zeile das Kind des Vertrags neben der Kinderakte, bevor etwas läuft,
  und das Büro bestätigt diese Vorschau.
- **`request_child_id` ändert sich nur auf zwei Wegen.** Die Request-Rolle
  darf die Spalte seit der Bindung setzen. Ein Trigger
  (`guard_contract_application_child`, Migration `20261123090000`) lässt
  nur zu, was die Anwendung tut: Ein importierter Vertrag wird gebunden
  (leer zu einem Wert) oder gelöst (ein Wert zu leer). Das Anmeldekind
  eines Vertrags aus einer Anmeldung ändert sich nie, und ein gebundener
  Vertrag wechselt nicht in einem Schritt zu einem anderen Anmeldekind.
  Ein Einfügen prüft der Trigger nicht: Ein gebundener importierter Vertrag
  trägt beide Ursprünge zu Recht, und ein Wiedereinspielen der Daten des
  Trägers fügt ihn so ein. Die Anwendung legt Verträge nur mit einem
  Ursprung an. Der Trigger schützt die Form des Übergangs, nicht welches
  Anmeldekind genannt wird: Das prüft das Kommando `BindApplications` unter
  seinen Sperren. Eine Prüfung gegen das Schema der Anmeldung gibt es mit
  Absicht nicht (Schule und Träger, ADR 0105).
- **Der Vertrag schützt weiter vor einem zweiten Vertrag.** Er zählt für
  die Anmeldung, an die er gebunden ist, über seinen Schlüssel. Für jede
  andere Anmeldung des Kindes, deren Betreuung in seine Laufzeit fällt,
  bleibt er, was er vor der Bindung war: ein importierter Vertrag, der sie
  deckt (`runningImports`, `importCovers`). Ein gebundener Vertrag ohne Ende
  hält deshalb die Anmeldung der nächsten Phase als Kandidat zurück
  (`imported_contract`), statt dass ein zweiter Vertrag neben ihm entsteht
  und beide abgerechnet werden. Das Büro beendet ihn durch Kündigung; dann
  bekommt das Kind seinen Vertrag für die nächste Phase (ADR 0153). Nur die
  Anmeldung, an die er gebunden ist, deckt er nicht: Sie ist seine eigene.
- Angebotskorrekturen aus einer Datei (ADR 0306) lehnen ihn als
  `follows_bookings` ab. Korrekturen der Vertragsangaben (#7767) bleiben
  möglich.

Zwischen Anmeldung und Bindung entsteht weder ein zweiter Vertrag noch eine
Mail: Der ungebundene Vertrag deckt das neue Kind der Anmeldung über die
Kinderakte (ADR 0307 Punkt 6), das Anlegen von Hand prüft unter der Sperre,
und der Abschluss bei der Annahme findet keinen Annahmenachweis.

### 4. Der Lauf ist ein Workflow (`contract-enrollment`)

Der Lauf schreibt in zwei Scopes: in der Tenant-Transaktion der Schule
(Anmeldung, Zugriffsprotokoll) und in der Träger-Transaktion (Bindung). Keine
Transaktion hält beide (ADR 0105). Er braucht ein eigenes Protokoll: die
Reihenfolge der Transaktionen, das erneute Lesen des Vertrags unter Sperren
und einen Wiederanlauf nach einem Abbruch. Nach dem Nachtrag zu
[ADR 0067](0067-principle-owners-meet-through-contracts-and-write-together-in-workflows.md#addendum-2026-10-23-command-participation-and-coordination-4538)
ist das Koordination, kein teilnehmendes Kommando. Der neue Owner
`contract-enrollment` unter `workflows/contractenrollment/` koordiniert, nach
dem Muster von `traeger-catalog-rollout`:

1. Träger-Transaktion: Verträge lesen (`EnrollmentContracts`).
2. Tenant-Transaktion der Schule: Plan (`EnrollmentPlans`), dann jede
   bereite Zeile an `EnrollContractChildren`: Kinder ohne Anmeldung werden
   angemeldet, eine bewiesene bestehende Anmeldung wird bestätigt (mit
   `RequestChildID`, `ApplicationBookings` und `ProvedOn` der Zeile). Dazu
   der Eintrag ins Zugriffsprotokoll der Schule (ADR 0084 §7). **Das Protokoll
   ist Pflicht des Workflows**: Plan und Anmeldung schreiben es nicht selbst,
   und kein Lauf, auch keine Vorschau, liest die Schule ohne den Eintrag in
   derselben Transaktion.
3. Träger-Transaktion: Bindung (`BindApplications`) der Zeilen, die die
   Anmeldung mit `enrolled` oder `existing` beantwortet hat, nach der Regel
   aus Abschnitt 3. Der Workflow führt die Antworten von Plan und Anmeldung
   zusammen; die Antwort der Anmeldung geht vor.

Bricht der Lauf zwischen 2 und 3 ab, gibt es die Anmeldung, und der Vertrag
ist ungebunden. Der nächste Lauf bindet; nichts entsteht doppelt.

- **Ports** (`workflows/contractenrollment/ports`): `Contracts`
  (`carecontract.ContractEnrollments`), `SchoolEnrollments`
  (`enrollment.ContractEnrollments`), `Schools` (die Schulen des Trägers
  und das Halten einer Schule in ihrer Transaktion, Organisation &
  Tenancy), `Children` (die Kinderakten der Schule mit Namen
  und Geburtsdatum, People Directory), `Access` (Zugriffsprotokoll der
  Schule), `Runtime` (Träger- und Tenant-Transaktion). Den Fingerabdruck
  bildet Security Runtime.
- **Routen** im Träger-Portal, Recht „Verträge verwalten“
  (`TraegerRightContractsManage`), je Aufruf eine Schule:
  - `POST /traeger/contract-enrollments/preview` mit `{school_id}`: die
    Vorschau. Sie schreibt nur den Verlauf des Trägers und das
    Zugriffsprotokoll der Schule.
  - `POST /traeger/contract-enrollments/` mit `{school_id, fingerprint}`:
    der Lauf.
  - `DELETE /traeger/contract-enrollments/{contractId}?request_child_id=…`:
    der Weg zurück.
  Eine Schule eines anderen Trägers wird abgelehnt, bevor eine Transaktion
  beginnt (`care_contract.school_outside_traeger`, 403).
- **Die Schule gehört dem Träger, solange ihre Transaktion läuft.** Die
  Prüfung vor der ersten Transaktion reicht nicht: Die Tenant-Transaktion
  ist nur über die Schule gebunden, und ein Operator kann die Schule
  inzwischen einem anderen Träger geben (`UpdateSchool`). Der Workflow hält
  die Schule deshalb als Erstes in ihrer Tenant-Transaktion unter der
  Lesesperre von Organisation & Tenancy (`FindSchoolForShare`,
  `platform.lock_tenant_school_for_share`, #6305) und prüft dort ihren
  Träger, in Vorschau und Lauf; sonst dieselbe Ablehnung, und nichts von
  der Schule wird gelesen, protokolliert oder geschrieben. Der Wechsel des
  Trägers schreibt dieselbe Zeile und wartet auf das Ende der Transaktion.
  Das ist das Protokoll des Katalog-Rollouts (`lockSchool`,
  `workflows/traegercatalog/internal/application/school.go:123-137`,
  aufgerufen in `rollout.go:140-144` und `preview.go:87-89`).
  **Rest, wie dort:** Zwischen der Transaktion der Schule und der
  Träger-Transaktion der Bindung hält keine Sperre. Wechselt die Schule
  genau dann den Träger, bindet der frühere Träger noch seinen eigenen
  Vertrag: Die Bindung läuft unter seiner RLS und schreibt nur
  `request_child_id` seines Vertrags und seinen Verlauf, nichts an der
  Schule. Der Vertrag bleibt ohnehin bei ihm, wie jeder seiner Verträge an
  dieser Schule nach einem Wechsel; er zeigt dann auf eine Anmeldung, die
  die Schule in seiner Zeit angelegt hat. Der Katalog-Rollout schreibt nach
  dem Commit der Schule ebenso weiter (Tarife und Vorlagen,
  `rollout.go:137-139`). Ein Schloss über beide Owner, das dieses Fenster
  schlösse, gibt es nicht und ist hier nicht gebaut.
- **Transaktionen.** Vorschau: Träger-Transaktion (Verträge lesen, Verlauf),
  dann Tenant-Transaktion der Schule (Plan, `CheckContractChildren`,
  Kinderakten, Zugriffsprotokoll). Lauf: dieselben zwei, in der
  Tenant-Transaktion danach `EnrollContractChildren`, dann eine zweite
  Träger-Transaktion mit `BindApplications`. Keine ist in eine andere
  geschachtelt. Einen exklusiven Abschnitt je Träger wie der Katalog-Rollout
  braucht der Lauf nicht: Zwei Läufe derselben Schule warten an den Sperren
  der Genehmigung, die je Schule gelten, auch wenn sie verschiedene Phasen
  anmelden. Der zweite findet die Anmeldung des ersten (`existing`, in
  einer anderen Phase `enrolled_elsewhere`, Abschnitt 2), und die Bindung
  unter der Sperre der Verknüpfungen antwortet ihm „schon gebunden“.
- **Zugriffsprotokoll.** Jede Tenant-Transaktion des Workflows schreibt
  einen Eintrag in `audit.data_access_log` der Schule: Verträge als
  Ressource, Ansicht `contract_enrollment`, die gezeigten Verträge und
  Kinderakten. Lehnt der Lauf die Vorschau ab, rollt der Eintrag mit der
  Transaktion zurück; die Antwort zeigt dann auch nichts.
- **Die Vorschau** führt je Vertrag die Antwort des Plans und, für bereite
  Zeilen, die der Anmeldung zusammen. Eine Zeile trägt: Vertrag, Schule, das
  Kind, wie der Vertrag es nennt, die Kinderakte mit Kennung, Namen und
  Geburtsdatum, wie die Schule sie hat, Phase, die Module mit Wochentagen,
  Beginn und Ende (halboffen) und geplante Änderungen, Status, Grund und die
  Kennungen der Anmeldung und des Vertrags, dem dieser folgt. Dazu Zähler je
  Status und der Fingerabdruck über den Plan (mit dem, worauf jede bereite
  Zeile bewiesen wurde) und die Zeilen samt Kinderakten.
- **Eine Zeile, die bindet, zeigt, woran gebunden wird.** Für eine bereite
  Zeile mit der Anmeldung, die der Plan bewiesen hat (`bind`), sind die
  Module der Zeile die gespeicherten Buchungen dieser Anmeldung ab dem Tag
  des Plans (`ApplicationBookings`), nicht die aus dem Vertrag
  abgeleiteten: Geschrieben wird für sie nichts, und der Vertrag folgt nach
  der Bindung genau diesen Buchungen. Eine geplante Änderung steht dann in
  diesen Buchungen und nicht daneben. Alle anderen Zeilen zeigen die
  abgeleiteten Buchungen. Die Zeile nennt die Wochentage, die eine Buchung
  wirksam hält: Die Buchung eines Moduls mit festen Tagen speichert keine,
  die Zeile zeigt dann alle Tage des Moduls, wie eine Zeile, die anmeldet.
  Sonst stünde nach dem Lösen einer Bindung ein Modul Montag bis Mittwoch
  ohne Tage in der Vorschau. Der Plan behält die gespeicherte Auswahl
  (`ApplicationBookings`): Sie ist, was die Anmeldung der Schule vergleicht.
- **Status einer Zeile**: `ready` (der Lauf handelt: `action` `enroll`
  meldet an und bindet, `bind` bindet an die Anmeldung, die es gibt), `done`
  (gebunden; nach einem Lauf sagt `action`, was er getan hat), `unlinked`
  (ohne Kinderakte), `held` (zurückgehalten, mit dem Grund des Plans oder der
  Anmeldung), `stuck` (hängt, siehe unten) und `changed` (nur nach einem
  Lauf: Die Anmeldung oder die Bindung fand Schule oder Vertrag nicht mehr
  so vor wie der Plan; nichts wurde gebunden). In der Vorschau heißt eine
  Anmeldung, die nicht mehr ist, was der Plan bewiesen hat, `held` mit dem
  Grund `changed`: Plan und Prüfung lesen die Schule in einer Transaktion.
- **Der Lauf übernimmt nur die bestätigte Vorschau.** Er plant in der
  Tenant-Transaktion neu, bildet den Fingerabdruck und schreibt nichts an
  der Schule, wenn er nicht der bestätigte ist
  (`care_contract.enrollment_preview_changed`, 409). Der Eintrag im Verlauf
  des Trägers über das Lesen der Verträge bleibt, wie nach einer Vorschau;
  der Eintrag im Zugriffsprotokoll der Schule rollt mit zurück. Die
  Antworten der Anmeldung ordnet er den Zeilen über Vertrag und Kinderakte
  zu, nie über die Position. Ein zweiter Lauf braucht eine neue Vorschau;
  sie zeigt die Zeilen des ersten als `done`.
- **Eine Vorschau gilt, solange der Plan dasselbe sagt; für manche Zeilen
  ist das ihr Tag.** Der Lauf vergleicht den Fingerabdruck, kein Datum. Der
  Plan rechnet mit dem heutigen Tag, aber nicht jede Zeile trägt ihn:
  - Eine Zeile, die an die Anmeldung eines laufenden Vertrags bindet, trägt
    den Tag des Plans (`ProvedOn`) samt den Buchungen ab diesem Tag. Nach
    Mitternacht ist ihr Fingerabdruck immer ein anderer.
  - Die Zeile eines abgebrochenen Laufs nach dem Ende des letzten Moduls
    (Abschnitt 1) trägt als `ProvedOn` den ersten Tag, an dem der Vertrag in
    der Phase Betreuung versprach, und alle Buchungen der Anmeldung in der
    Phase. Beides liegt in der Vergangenheit: Ihr Fingerabdruck bleibt über
    Mitternacht gleich, solange die Phase läuft.
  - Jede andere Zeile (anmelden, zurückgehalten, erledigt, ohne Kinderakte)
    trägt den Tag nicht. Sie ändert sich über Mitternacht nur, wenn der
    neue Tag den Plan ändert: Eine Version, ein Modul, ein Vertrag oder
    eine Phase beginnt oder endet.
  Eine Vorschau ohne Zeile der ersten Art kann der Lauf also auch am
  nächsten Tag übernehmen; er plant ohnehin neu und schreibt nur, was dann
  gilt. Ist der Fingerabdruck ein anderer, antwortet der Lauf
  `care_contract.enrollment_preview_changed`. Das ist kein Fehler des Büros:
  Die Seite lädt die Vorschau dann still neu und zeigt sie zur Bestätigung,
  ohne Fehlermeldung.
- **Angemeldet wird nur, was die Vorschau bereit nannte.** An
  `EnrollContractChildren` gehen nur die Zeilen, die in der bestätigten
  Vorschau `ready` waren, zugeordnet über Vertrag und Kinderakte. Eine
  Zeile, die der Plan bereit nennt, die Prüfung der Anmeldung aber
  zurückgehalten hat (`held`), geht nicht mit: Die Prüfung liest ohne
  Sperren, die Anmeldung danach unter Sperren. Lehnt die Schule dazwischen
  eine wartende Anmeldung ab oder aktiviert sie eine Kinderakte wieder,
  hätte der Lauf sonst ein Kind angemeldet und gebunden, das das Büro in
  der Vorschau als zurückgehalten gesehen hat. Die Zeile bleibt in der
  Antwort, wie die Vorschau sie zeigte; die nächste Vorschau nennt sie
  bereit.
- **Ein Fehler einer Zeile bricht den Lauf der Schule ab.** Ablehnungen
  sind Antworten je Zeile. Ein Fehler dagegen (ein Baustein von Care Plan
  scheitert an den Daten eines Kindes) rollt die Tenant-Transaktion der
  Schule zurück: Kein Kind der Schule ist angemeldet, nichts wird gebunden,
  die Antwort ist ein Fehler. Der Weg heraus: Das Büro löst die Verknüpfung
  dieses Vertrags (ADR 0307); die Zeile ist dann `unlinked`, und der Lauf
  nimmt die übrigen mit.
- **Scheitert die Bindung nach der Anmeldung, antwortet der Lauf mit einem
  Fehler, obwohl die Schule geschrieben hat.** Die Transaktion der Schule
  ist dann abgeschlossen: Die Kinder sind angemeldet, die Verträge
  ungebunden. Das ist der Zustand eines abgebrochenen Laufs; nichts ist
  verloren und nichts entsteht doppelt. Die nächste Vorschau zeigt die
  Zeilen als `ready` mit `bind`, der nächste Lauf bindet. Die Seite des
  Büros im nächsten PR muss das sagen: Nach einem Fehler des Laufs zeigt
  sie die neue Vorschau und nennt, dass Kinder schon angemeldet sein
  können und der Lauf wiederholt werden muss.
- **Eine hängende stille Anmeldung** (`stuck`). Bricht ein Lauf nach der
  Anmeldung ab und läuft der nächste erst, nachdem die Betreuung der Phase
  geendet hat, oder besteht die gespeicherte Anmeldung den Beweis nicht mehr
  (das Büro hat ihre Buchungen geändert, der Vertrag hat eine neue Version,
  die Kinderakte ist nicht mehr aktiv), bleibt die Anmeldung ohne Vertrag.
  Die Zeile heißt dann `stuck` statt `held`, nennt die Anmeldung
  (`request_child_id`) und behält den Grund, der sie zurückhält. Der Weg
  heraus liegt bei dem, was der Grund nennt: Das Büro berichtigt den Vertrag,
  oder die Schule berichtigt die Buchungen der Anmeldung auf dem üblichen
  Weg, bis sie der Vertrag sind; der nächste Lauf bindet dann. Ist die Phase
  beendet, bleibt die Anmeldung als angenommene Anmeldung ohne Vertrag
  stehen. Der Vertrag deckt sie weiter über die Kinderakte (ADR 0307
  Punkt 6), solange er läuft und verknüpft ist; ein zweiter Vertrag entsteht
  für sie nicht. Hängt die Zeile, weil das Büro den Vertrag auf ein Modul
  einer anderen Phase berichtigt hat (Abschnitt 1), berichtigt das Büro den
  Vertrag zurück; der nächste Lauf bindet dann. Die Seite des Büros muss
  das sagen. **Offen:** Beendet stattdessen die Schule die stille Anmeldung
  (alle Module heraus, siehe „Der Weg zurück“), löst das die Zeile in diesem
  PR nicht: Die Anmeldung bleibt genehmigt, der Plan nennt sie weiter
  (`unboundEnrollment` fragt nicht nach ihren Buchungen), und die Anmeldung
  der Schule lehnt die neue Phase weiter ab (`enrolled_elsewhere`). Ob eine
  stille Anmeldung ohne Buchungen ab heute den Vertrag freigibt, ist nicht
  entschieden.
- **Der Weg zurück: Bindung lösen** (`UnbindApplication`). Das Büro nimmt
  das Anmeldekind, das es an einem gebundenen importierten Vertrag sieht,
  wieder ab: in einer Träger-Transaktion, unter der Sperre der
  Verknüpfungen und der Zeilensperre des Vertrags, mit dem Eintrag `unbind`
  im Verlauf. Geschrieben wird `request_child_id` und sonst nichts. Der
  Vertrag ist danach, was er vor der Bindung war: importiert, mit der
  Kinderakte verknüpft, er folgt den Buchungen nicht mehr, und seine
  Verknüpfung lässt sich lösen und neu setzen (ADR 0307). Ist der Vertrag
  nicht (mehr) an das genannte Anmeldekind gebunden, wird abgelehnt
  (`care_contract.enrollment_binding_changed`, 409); ein Vertrag, der kein
  importierter des Trägers ist, wird nicht gefunden (404). Das gilt für jede
  Anmeldung, an die ein importierter Vertrag gebunden ist, nicht nur für die
  stille: Auch eine falsche Verknüpfung, die an die Anmeldung der Eltern
  eines anderen Kindes gebunden wurde, muss sich lösen lassen. Versionen,
  die nach der Bindung aus Buchungsänderungen entstanden sind, bleiben.
- **Was der Weg zurück nicht tut: die stille Anmeldung zurückziehen.** Die
  Schule liest und schreibt er nicht. Die Anmeldung der Herkunft
  `contract_import` bleibt genehmigt, mit Buchungen und Rostern. Geprüft
  wurde, ob es einen stillen Baustein gibt, der eine genehmigte Anmeldung
  beendet: Es gibt keinen. Der Rückzug der Eltern lehnt ein genehmigtes Kind
  ab (`ErrWithdrawNotAllowed`), das Löschen einer Anmeldung lehnt ab, solange
  die Kinderakte besteht (`ErrEnrollmentDeletionStudentExists`), und das
  Betreuungsende (`careexit`) gilt der Kinderakte, nicht einer Anmeldung: Es
  nimmt das Kind von allen Rostern ab einem Tag, auch von denen, die nicht
  aus dieser Anmeldung stammen. Ein eigener Rückzug nur für diese Anmeldung
  wäre ein halber Baustein neben dem Betreuungsende und ist deshalb nicht
  gebaut. Was das Büro stattdessen tut:
  - Nach dem Lösen zeigt die nächste Vorschau die Zeile als `ready` mit
    `bind`: Die Anmeldung gibt es noch, ein Lauf bände wieder. War die
    Verknüpfung richtig, ist das der Weg zurück zum gebundenen Vertrag.
  - War die Verknüpfung falsch, löst das Büro nach der Bindung auch die
    Verknüpfung und setzt sie auf die richtige Kinderakte; der nächste Lauf
    meldet das richtige Kind an. Die stille Anmeldung der falschen
    Kinderakte bleibt an der Schule und gehört zu keinem Vertrag mehr; in
    den Listen der Schule heißt sie „Aus importiertem Vertrag“. Die Vorschau
    des Workflows zeigt sie nicht mehr, weil kein Vertrag auf diese
    Kinderakte zeigt. Die Schule beendet ihre Betreuung auf einem ihrer
    üblichen Wege: Sie nimmt in der Anmeldung alle Module heraus (die
    Korrektur des Büros mit bestätigtem vollständigem Rückzug,
    `UpdateChildOfferings` mit `CompleteWithdrawalConfirmed`), oder sie trägt
    für ein Kind, das gar nicht betreut wird, das Betreuungsende der
    Kinderakte ein. Beide Wege sind nicht still: Der erste endet in der
    Bekanntgabe an die Erziehungsberechtigten dieser Kinderakte im
    Elternportal, der zweite gilt der ganzen Kinderakte. Deshalb entscheidet
    das die Schule und nicht der Weg zurück.
- **Fehlercodes**: `care_contract.enrollment_preview_changed` und
  `care_contract.enrollment_binding_changed` (beide 409).
- **Nutzungsanalyse**: Der Lauf zählt als Kernaktion
  `contract_children_enrolled`, wenn er etwas geschrieben hat: Die Schule
  hat mindestens ein Kind angemeldet, oder mindestens ein Vertrag wurde
  gebunden (`changed` in der Antwort). Ein Lauf, der alles erledigt
  vorfindet, zählt nicht. Die Antwort nennt jeden Vertrag der Schule und
  wird damit länger als die 64 KiB, die die Middleware von einer Antwort
  hält; `changed` steht deshalb vor den Zeilen und wird für diese Route
  aus dem Anfang der Antwort gelesen (`leadingFlagEvent`). Vorschau und Weg
  zurück zählen nicht. **In Produktion wird das Ereignis noch nicht
  gesendet:** Die Route ist eingestuft, aber eine Sitzung des Träger-Büros
  nennt keine Schule und ergibt deshalb keinen Akteur der Nutzungsanalyse
  (`analytics.ActorOf`, `backend/analytics/actor.go`: `TenantID == 0`), wie
  bei allen Routen des Träger-Portals
  (`backend/analytics/core_actions_traeger.go`). Gezählt wird erst, wenn es
  eine Erhebungsentscheidung für den Träger gibt; die Tests der Einstufung
  setzen den Akteur selbst.
- **Seed**: Der Seed verknüpft den Vertrag einer Kinderakte der Demo-Schule,
  ruft Vorschau und Lauf über diese Routen auf und versucht es mit dem
  nächsten Kind, bis ein Vertrag gebunden ist (höchstens fünf). Die vier
  importierten Kinder ohne Kinderakte bleiben unverknüpft.

Die Seite des Büros („Anmeldungen nachtragen“ unter den Verträgen) folgt im
nächsten PR. Bis dahin sind die Routen nur über die API erreichbar.

### 5. Der Schritt für die Eltern

Der Auslöser bleibt die bestehende Sammeleinladung der Schule
(`POST /guardians/bulk-invite`). Sie lädt wie bisher alle
Erziehungsberechtigten ohne Konto ins Elternportal ein. Neu ist eine Mail an
Erziehungsberechtigte, die schon ein Konto haben
(`guardian-care-visible.html`, Schalter `NotifyActive` der Sammeleinladung):
Die Betreuung ihres Kindes ist jetzt im Elternportal sichtbar. Der Lauf aus
Abschnitt 4 löst diesen Schritt nie selbst aus.

### 6. Die Verlängerung ins nächste Schuljahr

Die Verlängerung (`CreatePhaseFromSource`) übernimmt jedes genehmigte Kind
in die neue Phase. Für ein Kind der stillen Anmeldung hätte sie die leeren
Angaben der Erziehungsberechtigten kopiert, die Herkunft nicht (also
`public`), und keine Mail verschickt. Danach hätte im Modus Opt-in die Frist
das Kind zurückgezogen, weil niemand zugestimmt hat, und im Modus Opt-out
wäre eine Anmeldung ohne Erziehungsberechtigte ungesehen verlängert worden.

Regel: Die Verlängerung einer Anmeldung der Herkunft `contract_import`
geht in die Prüfung der Schule, denn keine Eltern können sie beantworten.
Die Regel liest nur die Herkunft. Eine Anmeldung anderer Herkunft, die
weder Adresse noch Konto der Erziehungsberechtigten nennt, wird verlängert
wie bisher: Für Schulen ohne Anmeldungen der neuen Herkunft ändert sich an
der Verlängerung nichts.

- Das neue Kind entsteht in `pending_admin_review` mit dem Grund
  `no_guardian`, in beiden Modi. Die Vorschau der Verlängerung zählt es
  unter diesem Grund; Vorschau und Lauf teilen die Regel.
- Die neue Anmeldung trägt die Herkunft `contract_import` weiter.
- Es geht keine Mail, und die Frist lässt die Prüfung in Ruhe: Sie zieht
  nur `pending_renewal` zurück und befördert nur `auto_renewed`.
- Die Schule entscheidet in der bestehenden Prüfliste der Verlängerung
  (behalten, entfernen, zurückstellen). Die Liste zeigt den Grund als
  „Keine Erziehungsberechtigten hinterlegt“.

Offen bleibt, was „behalten“ für eine solche Anmeldung tut. Nachgelesen:
„Behalten“ setzt das Kind auf `auto_renewed` (`DecideReview`), die Frist
befördert es zu `submitted`, und die Schule genehmigt es dann in der
üblichen Liste. Diese Genehmigung einer Verlängerung gleicht die
Erziehungsberechtigten der Anmeldung mit der Kinderakte ab
(`reconcileRenewalGuardian`) und überträgt die Formularfelder samt
Einwilligungen (`syncRenewalTargetedFields`, eine nicht angekreuzte
Einwilligung gilt dort als widerrufen). Was das für eine Anmeldung ohne
Erziehungsberechtigte und ohne Angaben bewirkt, ist nicht festgelegt und in
diesem PR nicht geändert. Seit dem Lauf aus Abschnitt 4 gibt es Kinder
dieser Herkunft; die Verlängerung trifft sie erst mit der Phase des nächsten
Schuljahrs. Die Regel dafür, der Schritt für die Eltern (Abschnitt 5) und die
Bindung des Folgevertrags gehören zu den Folge-PRs und müssen vor der ersten
Verlängerung einer Schule mit solchen Kindern entschieden sein.

## Register

Die Entscheidung ändert diese Register (ADR 0057 Punkt 5, ADR 0070):

- **Kommando-Effekte** (`backend/architecture/command-effects/`): neu für
  `enrollment.ContractEnrollments.EnrollContractChildren` die Sperre
  `timetable.RecurrenceWriteLock.LockRecurrenceWrites` und die Änderung
  `careplan.PickupAutoExcusal.ResyncFutureExceptions`, beide als bekannte
  Koordinationsschuld wie bei `Decide`, mit diesem ADR als Freigabe, sowie
  das Lesen `securityruntime.FillRandom`. `CheckContractChildren` hat keinen
  Effekt. Dazu das Lesen der Kinderakten und ihrer Personen als Menge
  (`peopledirectory.ListStudentsByID`, `ListPersonsByID`) über die Bindung
  `EnrollmentContractStudents`, als Abfrage eingestuft.
- **Query-Budget** (`backend/test/query-budgets/`): neu
  `services.enrollment.contract_enrollments.enroll`, 46 Statements für ein
  Kind mit einer kommenden Abhol-Ausnahme; der Test prüft dazu exakt 31 je
  weiteres Kind und je weitere Phase 2 (Prüfung) und 3 (Lauf)
  (Abschnitt 2).
- **Compose-Budgets** (`backend/test/module_legacy_budget_ratchet_test.go`):
  `modules/carecontract/compose` 188 → 195 (Konstruktor
  `NewContractEnrollments` und der Typ seiner Ports). Der Konstruktor baut
  nur seinen Owner (ADR 0068).
- **Verlauf**: `chk_contract_events_action` kennt `bind_application`,
  `chk_contracts_origin` verlangt mindestens einen Ursprung, die Request-Rolle
  darf `request_child_id` setzen (Migration `20261122202100`).
- **Herkunft**: `chk_enrollment_requests_submission_source` kennt
  `contract_import` (Migration `20261122202200`).
- **Fehlercode**: `care_contract.child_link_bound`.
- **Ablehnungsgrund der Anmeldung**: `enrolled_elsewhere` (Abschnitt 2).
  Das Lesen der Anmeldungen einer Phase (`ContractEnrollmentHolders`) liest
  die stillen Anmeldungen der anderen Phasen mit; die Query-Budgets bleiben,
  wie sie sind (46; 2 und 3 je weitere Phase; 28 und 72 der Routen).
- **Prüfgrund der Verlängerung**: `no_guardian` (Abschnitt 6).

Mit dem Workflow (Abschnitt 4) kommen dazu:

- **Policy** (`backend/architecture/policy.json`): Owner
  `contract-enrollment` (Workflow), `policy_epoch` 106 → 107; neues Fragment
  `policy/contract-enrollment.json` mit fünf Paketen und 13 Regeln (auf Care
  Contract, Enrollment, die eigenen Ports, Tenant Runtime und `api/common`).
- **Compose-Budgets**: neu `workflows/contractenrollment/compose` 0 → 34
  (Konstruktor und die Laufzeit für Träger- und Tenant-Transaktion).
- **Pass-through** (`backend/architecture/passthrough/`): vier neue
  Port-Adapter der Wurzel, 3679 → 3683 Stellen:
  `api/contractEnrollmentSchools.TraegerSchoolIDs`,
  `api/contractEnrollmentSchools.HoldTraegerSchool`,
  `api/contractEnrollmentChildren.SchoolChildren`,
  `api/contractEnrollmentAccessLog.RecordAccess`; alle übersetzen (ADR 0067,
  ADR 0075).
- **Kommando-Effekte**: die Bindung
  `api.careContractApplications.AcceptedApplications` reicht jetzt die
  Herkunft der Anmeldung und den Vertrag weiter, für den sie angelegt wurde
  (geänderter Digest, weiter eine Abfrage). Neu für den Plan die Bindungen
  `api.careContractApplications.AcceptedStudentApplications` und
  `NamePhases` über `carecontract.StudentApplications`, beide Abfragen.
  Die Ports des Workflows sind die öffentlichen Fähigkeiten selbst und
  bringen keine neue Bindung.
- **Query-Budgets**: neu `api.traeger.contract_enrollments.preview`, exakt
  28 Statements, unabhängig von der Zahl der Verträge; neu
  `api.traeger.contract_enrollments.run`, 72 Statements für ein Kind ohne
  kommende Abhol-Ausnahme. Beide enthalten das Halten der Schule (Sperre
  und Lesen, 2 Statements); ohne es waren es 26 und 70. Der Test prüft
  dazu exakt 20 je weiteres Kind (Buchungen 3, Roster des direkt
  verknüpften Angebots mit seinen Terminen 11, Roster mit mehreren
  Quellen 4, Entschuldigungen 2): der Rest aus Abschnitt 2, in der Zusammensetzung der Route gemessen. Alles andere am
  Lauf wächst nicht mit den Kindern.
- **Verlauf**: `chk_contract_events_action` kennt `unbind`; Trigger
  `guard_contract_application_child` auf `care_contract.contracts`
  (Migration `20261123090000`).
- **Fehlercodes**: `care_contract.enrollment_preview_changed`,
  `care_contract.enrollment_binding_changed`.
- **Kernaktion**: `contract_children_enrolled`, nur bei `changed`.
- **Transaktionsgrenzen** (`backend/test/transaction_boundaries.json`,
  `traeger_transaction.go`): kein neuer Eintrag. Das Register zählt Workflows
  nicht auf, und Care Contract öffnet für Plan, Bindung und Lösen keine
  Transaktion selbst.

## Was sich für bestehende Schulen jetzt ändert

Ohne einen Lauf nichts. Plan, stille Anmeldung und Bindung ruft nur der
Workflow aus Abschnitt 4 auf, und den löst das Träger-Büro je Schule aus,
bis zur Seite im nächsten PR nur über die API. Die Herkunft
`contract_import` trägt erst danach eine Anmeldung, und die Regel der
Verlängerung (Abschnitt 6) und die der Korrektur ohne Datum (Abschnitt 2)
greifen nur für diese Herkunft. Care Plan leitet Roster für bestehende
Kinder unverändert ab.

## Bekannte Grenze: befristete Buchungen und späte erste Buchungen in Care Plan

Drei Fehler in Care Plan bestanden vor diesem PR. Die ersten beiden gehören
in das Folge-Issue
[#7908](https://github.com/moto-ogs/project-phoenix/issues/7908); der dritte
ist mit [#7909](https://github.com/moto-ogs/project-phoenix/issues/7909)
behoben.

1. **Die Roster-Zeile eines direkt verknüpften Angebots endet nicht mit der
   Buchung.** `booking_drafts.go` verwirft für Angebote mit
   `ActivityGroupID` das Ende der Buchung; die Zeile läuft bis zum Ende der
   Phase, und das Kind bleibt nach einer befristeten Buchung auf dem Roster
   und seinen Terminen. Eine frühere Fassung dieses PR hat das behoben und
   ist zurückgenommen: Die Behebung brach einen gemischten Fall. Angebot A
   benennt ein Roster direkt und endet im Januar, dasselbe Roster nennt
   Angebot B als einzige Quelle bis Juli, das Kind bucht beide. Die Zeile
   der direkten Verknüpfung ersetzt die der Quelle; endet sie mit A, fällt
   das Kind im Februar vom Roster, obwohl B es weiter bucht. Richtig
   behoben braucht der Fall je Kind und Roster das späteste Ende aller
   Wege, die es speisen, und damit einen Umbau der Roster-Entwürfe, der
   jede Genehmigung bestehender Schulen ändert. Die stille Anmeldung meidet
   den Fehler, statt ihn zu beheben: `roster_bound` (Abschnitt 2).
2. **Eine Korrektur ohne Datum bucht ab dem Betreuungsbeginn der Phase**,
   auch wenn die erste Buchung des Kindes später begann (Stichtagsänderung
   für ein Kind ohne Buchung). Für die Herkunft `contract_import` ist das
   behoben (Abschnitt 2), für alle anderen nicht. Dasselbe gilt für ein
   einzelnes Angebot, das später als die übrigen begann: Die Korrektur
   bucht es ab dem ersten Tag des Kindes.
3. **Behoben (#7909): Eine Korrektur ohne Datum behält das Ende einer
   Buchung.** Bleibt ein Angebot gewählt, behält seine Buchung ihr
   gespeichertes Ende (`keepBookingEnds`); eine Mitbuchung endet mit ihrem
   letzten Auslöser. Ein neu gewähltes Angebot endet mit der Phase oder dem
   früheren Betreuungsende der Kinderakte. Ein Ende, an dem eine andere
   gespeicherte Buchung des Kindes beginnt, ist der Beginn einer geplanten
   Änderung; die Korrektur plant sie neu ein, und sie schließt die Buchung
   dort. Eine Korrektur, die die Betreuung nicht ändert, erzeugt für einen
   gebundenen Vertrag keine Version mehr. Offen: Eine Änderung mit Stichtag
   verwirft das Ende weiterhin
   ([#7928](https://github.com/moto-ogs/project-phoenix/issues/7928)).
   **Nachtrag (#7929):** Das Büro verlängert ein Ende ausdrücklich. In der
   Korrektur steht unter einem Angebot, dessen Buchung vor der Betreuung des
   Kindes endet, „Gebucht bis …“ und „Bis … verlängern“
   (`extend_to_phase_end`). Die Korrektur ohne Datum bucht das Angebot dann
   wie ein neues bis zum Ende der Phase oder bis zum früheren Betreuungsende;
   Mitbuchungen folgen, Roster und Termine laufen mit, und ein gebundener
   Vertrag bekommt ab dem alten Ende eine Version. Den Tag nennt die
   Detailansicht (`extends_until`); an einem Ende, an dem eine geplante
   Änderung beginnt, gibt es nichts zu verlängern. Eine Änderung mit
   Stichtag lehnt die Verlängerung ab. Ein freies Enddatum gibt es nicht:
   Kürzen ist die Änderung mit Stichtag oder das Betreuungsende.

## Verworfene Optionen

- **Manuelle Anmeldung mit `ExistingStudentID`.** Setzt `matched_by_office`;
  solche Kinder liest der Vertrag bewusst nicht.
- **Phase für bestehende Kinder mit `send_notification: false`.** Verschickt
  nichts, ändert aber Angaben der Eltern und kann einem Elternkonto Zugang
  geben.
- **Buchungen direkt in Care Plan schreiben, ohne Anmeldung.** Die tägliche
  Betreuung, die Kapazität und die Verlängerung ins nächste Jahr hängen am
  genehmigten Kind der Anmeldung.
- **Abweichende Endzeiten still übernehmen.** Erzeugt bei der ersten
  Anpassung eine Version, die niemand beschlossen hat.
- **Geplante Änderungen über `AdjustOfferings` schreiben.** Erreicht die
  Erziehungsberechtigten im Elternportal und ist damit nicht still.
- **Buchungen eines schon angemeldeten Kindes ersetzen.** Die Roster einer
  Genehmigung werden nur eingefügt, nie neu abgeleitet; ersetzte Buchungen
  ließen alte Roster stehen.
- **Ein Kommando statt eines Workflows.** Der Lauf wechselt zwischen zwei
  Scopes und braucht den Wiederanlauf; das ist Koordination (ADR 0067).
- **An eine vom Büro zugeordnete Anmeldung binden** (`matched_by_office`).
  Verträge lesen solche Anmeldungen bewusst nicht (#6053): Wer sie abgegeben
  hat, ist nicht Vertragspartei der Kinderakte. Das Kind bleibt zurück
  (`has_application`).
- **Ein gebundener Vertrag deckt keine andere Anmeldung mehr.** So stand es
  zuerst hier. Ein Vertrag ohne Ende hätte dann in der nächsten Phase einen
  zweiten Vertrag neben sich bekommen, und beide wären abgerechnet worden.
- **Eine Zeile mit geplanter Änderung bereit nennen und erst die Anmeldung
  ablehnen lassen.** Plan und Anmeldung widersprächen sich, und die Vorschau
  verspräche, was der Lauf nicht tut.
- **Die Roster je Lauf als Menge schreiben.** Verlangt einen zweiten
  Roster-Schreiber neben dem der Genehmigung; der Rest von 15 Statements je
  Kind ist für einen Lauf je Schule tragbar (Abschnitt 2).
- **Jede Anmeldung ohne Adresse und Konto in die Prüfung der Verlängerung
  schicken.** So stand es zuerst in Abschnitt 6. Das hätte die Verlängerung
  bestehender Schulen geändert, bevor es ein Kind der neuen Herkunft gibt.
- **Buchungen ab dem Betreuungsbeginn der Phase, egal wann der Vertrag
  begann.** So stand es zuerst hier, weil das Roster am Betreuungsbeginn
  gelesen wird. Das Kind wäre vor seinem Vertrag gebucht und auf dem Roster
  gewesen.
- **Einen späteren Beginn über `AdjustOfferings` schreiben.** Erreicht die
  Erziehungsberechtigten im Elternportal.
- **Eine vom Plan bewiesene Anmeldung ohne Anmeldung der Schule binden.**
  So stand es zuerst in Abschnitt 3 (zwei Regeln). Zwischen Beweis und
  Bindung konnte das Büro die Buchungen ändern, ohne dass es jemand prüft.
- **Die Roster-Zeile der direkten Verknüpfung in diesem PR mit der Buchung
  enden lassen.** So stand es zuerst hier. Die Änderung traf jede
  Genehmigung bestehender Schulen und ließ ein Kind vom Roster fallen, das
  dasselbe Roster über ein zweites Angebot als Quelle weiter bucht (siehe
  „Bekannte Grenze“).
- **Die Korrektur ohne Datum für alle Kinder am ersten Tag der Buchungen
  beginnen lassen.** Ändert die Korrektur für bestehende Kinder, deren
  erste Buchung eine Stichtagsänderung war.
- **Einen zu kurzen Zeitraum als Fehler des Aufrufs stehen lassen.** Ein
  Vertrag kurz vor Phasenende bräche die Anmeldung aller Kinder der Schule
  ab.
- **Kinder der stillen Anmeldung von der Verlängerung ausnehmen.** Sie
  verlören ihre Betreuung im nächsten Jahr, ohne dass es jemand entscheidet.
- **Beim Lösen der Bindung die stille Anmeldung still zurückziehen.**
  Enrollment und Care Plan haben keinen Baustein, der eine genehmigte
  Anmeldung beendet, ohne die Kinderakte zu treffen (Abschnitt 4). Ein
  eigener wäre ein zweiter, halber Weg neben dem Betreuungsende.
- **Die Bindung nur für die Herkunft `contract_import` lösen.** Eine falsche
  Verknüpfung kann auch an die Anmeldung der Eltern eines anderen Kindes
  gebunden worden sein; gerade dann muss der Vertrag von ihr weg.
- **Ein exklusiver Abschnitt je Träger für den Lauf.** Die Sperren der
  Genehmigung, der Phase und der Verknüpfungen reichen (Abschnitt 4).
- **Den Fingerabdruck nur über den Plan bilden.** Eine Zeile, die die
  Vorschau wegen der Antwort der Anmeldung zurückhält, könnte der Lauf dann
  anmelden, ohne dass das Büro es gesehen hat.

## Folgen

- Ein gebundener Vertrag ist für seine Anmeldung ein Vertrag mit Anmeldung:
  Er folgt den Buchungen und erscheint an der Anmeldung der Schule. Für jede
  andere Anmeldung des Kindes bleibt er ein laufender importierter Vertrag,
  der sie zurückhält, bis er endet.
- Ein importierter Vertrag ohne Ende bleibt nach dem Schuljahr bestehen. Die
  Anpassung nennt ihn je Lauf als übersprungen (`care_ends`); beendet wird er
  über die Kündigung.
- Zeilen mit geplanter Änderung, abweichender Endzeit oder anderen Buchungen
  bleiben zurück, bis das Büro sie berichtigt oder die geplante Version gilt.
  Der Lauf ist wiederholbar und nimmt sie dann mit.
- Ändert die Schule zwischen Vorschau und Lauf ein Modul oder die Phase,
  meldet der Lauf die betroffenen Kinder als geändert und schreibt für sie
  nichts.
- Kinder der stillen Anmeldung erscheinen bei der Verlängerung in der
  Prüfliste der Schule statt in der Frist der Eltern.
- Ein Kind, dessen Vertrag in der laufenden Phase begann, ist ab dem ersten
  Tag des Vertrags gebucht und auf dem Roster, nicht davor.
- Folgt in einer Phase ein importierter Vertrag auf einen gebundenen,
  bleibt er zurück (`follows_contract`), bis das Büro ihn als
  Vertragsänderung behandelt.
- Eine Schule mit ausgeschalteten Betreuungsangeboten bekommt keine stille
  Anmeldung.
- Kinder mit einer befristeten Buchung auf einem direkt verknüpften Roster,
  mit einem Betreuungsende vor dem Ende ihrer Buchungen oder mit einem
  Zeitraum ohne einen gebuchten Wochentag bleiben zurück, bis das Büro
  Vertrag, Kinderakte oder Angebot berichtigt oder Care Plan befristete
  Buchungen auf direkt verknüpften Rostern beendet (#7908).
- Korrigiert das Büro die Wochentage eines still angemeldeten Kindes ohne
  Datum, bleibt der erste Tag seiner Buchungen und Roster bestehen.
- Eine gebundene falsche Verknüpfung lässt sich berichtigen: Bindung lösen,
  Verknüpfung lösen, neu verknüpfen, neu laufen lassen. Die stille Anmeldung
  der falschen Kinderakte beendet die Schule.
- Eine stille Anmeldung, an die sich der Vertrag nicht mehr binden lässt,
  steht in der Vorschau als „hängt“, mit ihrem Grund.
- An die Anmeldung einer nicht mehr aktiven Kinderakte wird nicht gebunden.
- Die Rücknahme der Migration löst die Bindung importierter Verträge wieder;
  die Anmeldungen bleiben an der Schule und heißen dann „von Hand
  eingetragen“.

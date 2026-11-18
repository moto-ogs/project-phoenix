---
status: proposed
---

# Der Träger stellt eine Person ein, und jeder Einsatzort legt sie in seiner Transaktion an

Vorschlag vom 16.11.2026 für
[#7206](https://github.com/moto-ogs/project-phoenix/issues/7206), Spec
[#4611](https://github.com/moto-ogs/project-phoenix/issues/4611), Stories 101
und 124. Er ergänzt
[ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
§1, §3 und §5 um den Fall, den §5 offenließ: eine Person, die noch an keiner
Schule des Trägers arbeitet.

## Kontext

- Eine Personalakte entsteht bisher nur aus Personal, das eine Schule schon
  angelegt hat: über einen Vorschlag, über „Ohne Akte“ oder über den Import
  (ADR 0089 §5). Für eine Neueinstellung braucht die Personalverwaltung
  deshalb erst die Schule oder die Rolle „Schulzugang“.
- Personalnummer, Stammdaten und Arbeitsvertrag gehören nach ADR 0089 §3 dem
  Träger. Personensatz, Transponder, Rolle und Zugang gehören der Schule.
- Ein Arbeitsvertrag braucht das Soll mindestens eines Einsatzorts (ADR 0089
  §1). Eine Akte ohne Einsatzort ist eine Person, die nirgends einchecken
  kann und nirgends eingeplant wird.
- Einen Personensatz legt das People Directory an, eine Beschäftigung School
  Membership. Beide laufen in der Tenant-Transaktion der Schule. Workforce
  schreibt die Akte in der Träger-Transaktion. Keine Transaktion trägt beides
  ([ADR 0105](0105-traeger-und-tenant-transaktionen-laufen-nie-ineinander.md)).

## Entscheidung

1. **Die Rolle „Personal“ stellt ein.** `POST /traeger/staff-records/hire`
   verlangt das Recht `traeger_staff:manage` und die Freigabe „Personal beim
   Träger“. Der Träger kommt aus der Sitzung. Eine Schule, die nicht zum
   Träger gehört, ist kein Einsatzort. Das Schreiben in die Schule folgt ADR
   0084 §2: je Schule eine Tenant-Transaktion, über den Owner der Daten.
2. **Erst prüfen, dann anlegen.** Vor dem ersten Schreiben prüft Workforce:
   die Eingabe, die Personalnummer bei allen Akten des Trägers und bei allen
   Beschäftigungen jedes Einsatzorts, und ob es die Person schon gibt
   (Punkt 6). Eine abgelehnte Einstellung legt nichts an. Die Prüfung hält
   keine Sperre über Schulen hinweg. Vergibt jemand die Nummer zwischen
   Prüfung und Schreiben, greift der eindeutige Index der Akten (Punkt 5).
3. **Workforce stößt an, die Owner legen an.** Je Einsatzort ruft Workforce
   in dessen Tenant-Transaktion zwei Ports: `TraegerHirePersons` und
   `TraegerHireEmployments`. Die Wurzel bindet sie an
   `peopledirectory.Command.CreatePerson` und
   `schoolmembership.Command.CreateStaff`. Das sind geführte Kommandos nach
   [ADR 0067](0067-principle-owners-meet-through-contracts-and-write-together-in-workflows.md)
   (Nachtrag vom 23.10.2026): Sie laufen in der Transaktion des Aufrufers,
   jeder Owner prüft und schreibt selbst, und es gibt keine gemeinsame
   Sperrreihenfolge und keine gemeinsame Prüfung. Die beiden Bindungen
   übersetzen nur die Eingabe von Workforce in die des Owners und geben die ID
   zurück. Danach schreibt Workforce in derselben Transaktion Eintritt,
   Vertragsende, E-Mail und Telefon in die Stammdaten der Schule
   (`users.staff_master_data`, eigene Tabelle), jeden Wert mit einem Eintrag
   „Vom Träger eingestellt“ im Verlauf der Schule.
4. **Danach eine Träger-Transaktion.** Sie speichert die Akte, ihre
   Einsatzorte, den Arbeitsvertrag mit dem Soll je Einsatzort und den Verlauf.
   Dann bekommt jeder Einsatzort die Personalnummer und das Soll, auf dem Weg,
   den Verknüpfen und Vertrag schon gehen (ADR 0233 §6, ADR 0237 §4). Erreicht
   moto dabei eine Schule nicht, ist die Einstellung trotzdem gespeichert. Die
   Antwort nennt die Schule, und die nächste Änderung der Akte holt sie nach.
5. **Ein Abbruch sagt, was es schon gibt.** Scheitert eine spätere Schule
   oder die Träger-Transaktion, bleiben die Personen der Schulen davor
   bestehen, denn keine Transaktion reicht über zwei Schulen. moto antwortet
   dann mit `workforce.traeger_staff_hire_incomplete` und nennt diese Schulen
   und, falls schon gespeichert, die Akte. Das Formular zeigt statt eines
   neuen Versuchs: Die Person steht unter „Ohne Akte“, dort legt die
   Personalverwaltung die Akte an. Ein neuer Versuch trifft zusätzlich die
   Rückfrage aus Punkt 6, weil das Geburtsdatum Pflicht ist. moto räumt die
   Schulen nicht selbst auf: Dafür müsste Workforce Personen und
   Beschäftigungen anderer Owner löschen.
6. **Dubletten: die Nummer sperrt, der Name fragt.** Eine vergebene
   Personalnummer lehnt die Einstellung ab (ADR 0089 §4). Gibt es beim Träger
   eine Akte oder an einer seiner Schulen eine Person ohne Akte mit demselben
   Vornamen, Nachnamen und Geburtsdatum, hält moto die Einstellung an und
   nennt die Akte oder die Schule. Die Personalverwaltung bricht ab oder
   bestätigt, dass es zwei Personen sind. Das Geburtsdatum ist bei der Einstellung
   Pflicht, denn ein Name ohne Geburtsdatum ist kein Treffer, wie bei den
   Vorschlägen (ADR 0089 §5). Nichts wird von selbst zusammengelegt. Nennt
   die Rückfrage eine Person einer Schule, steht das vorher im
   Zugriffsprotokoll dieser Schule (ADR 0084 §7, Ansicht `staff_hire_check`).
   Eine bestätigte Einstellung zeigt niemanden und schreibt keinen Eintrag.
7. **Zugang, Transponder und Rolle bleiben bei der Schule.** Die Einstellung
   legt kein Konto an, vergibt keine Rolle und verschickt keine Einladung. Die
   Schule lädt die Person ein, wie jede Person ohne Konto. Die E-Mail-Adresse
   aus dem Formular steht dafür in den Stammdaten der Schule.
8. **Der Kontakt liegt am Einsatzort.** `workforce.staff_records` hat keine
   Spalten für E-Mail und Telefon. Die Einstellung schreibt beide an jeden
   Einsatzort, wo die Leitung sie nach ADR 0089 §6 sieht und zum Einladen
   braucht.
9. **Einsatzorte statt Haupteinsatzort.** Der Vertrag speichert noch keinen
   Haupteinsatzort (ADR 0089, Nachtrag vom 14.11.2026, Punkt 6). Das Formular
   fragt deshalb nach den Einsatzorten, mindestens einem, und zeichnet keinen
   aus.

## Verschoben

- **Kontakt am Personalstamm** (ADR 0089 §3 nennt ihn beim Träger). Er
  braucht Spalten, eine Löschfrist und einen Platz in der Akte.
- **Ein Hinweis an die Schule** „neu, Zugang fehlt noch“. Die Person steht
  sofort in der Personalliste der Schule, ohne Konto.
- **Eine Einladung durch den Träger.** Sie braucht eine Rolle an der Schule,
  und die vergibt die Schule.
- **Der Haupteinsatzort am Vertrag.**

## Verworfene Optionen

- **Eine Transaktion über Träger und Schulen.** ADR 0105 schließt sie aus.
- **Erst die Akte, dann die Schulen.** Scheitert eine Schule, bleibt eine
  Akte ohne Einsatzort und ohne Vertrag. Der gewählte Weg lässt im
  Fehlerfall nur Personen zurück, für die es „Ohne Akte“ schon gibt.
- **Ein Workflow unter `workflows/`.** ADR 0067 verlangt ihn für eine
  gemeinsame Sperrreihenfolge oder eine gemeinsame Prüfung unter Sperren.
  Beides gibt es hier nicht: Die Prüfung liest ohne Sperre, jede Schule
  schreibt für sich, und die Reihenfolge ist die, die Verknüpfen und Vertrag
  in Workforce schon haben (ADR 0233, ADR 0237).
- **`EnsureSchoolIdentityChain` wie beim Springer (ADR 0251).** Die Kette
  hängt an einem Konto und einer Rolle. Beides gibt es bei einer
  Neueinstellung noch nicht.
- **Eine Bindung der Wurzel, die beide Owner ruft.** Die Wurzel verdrahtet
  und entscheidet nichts (ADR 0068). Die Reihenfolge gehört Workforce.
- **Name und Geburtsdatum als harte Sperre.** Zwei Personen können beides
  teilen. Die Personalverwaltung entscheidet.

## Folgen

- Die Durchreicher-Register führen die zwei Bindungen
  `api/traegerHirePersons.CreateSchoolPerson` und
  `api/traegerHireEmployments.CreateSchoolEmployment` mit dieser ADR, die
  Kommando-Register als Blatt-Kommandos nach ADR 0067.
- `workforce.TraegerStaffHires` ist eine eigene Fähigkeit neben
  `TraegerStaffRecords`, wie Import, Nachweise und Pool.
- Keine neue Tabelle, keine neue Spalte, keine Migration.
- Der Seed stellt eine erfundene Person ein, damit die Route im Seed-Lauf
  geprüft wird.

## Nachtrag vom 18.11.2026: Name ohne Geburtsdatum und E-Mail fragen auch (#7378)

Beim Test hat jemand eine Person eingestellt, die unter „Ohne Akte“ schon
stand: gleicher Name, gleiche E-Mail, aber ohne Geburtsdatum an der Schule.
Punkt 6 fragte deshalb nicht. Personal an Schulen hat oft kein
Geburtsdatum. Punkt 6 gilt nun so:

1. **Drei Gründe für die Rückfrage.** moto hält die Einstellung an, wenn
   eine Akte des Trägers oder eine Person ohne Akte an einer seiner Schulen
   - denselben Vornamen, Nachnamen und dasselbe Geburtsdatum hat,
   - denselben Vornamen und Nachnamen hat und kein Geburtsdatum, oder
   - an einer Schule unter der E-Mail-Adresse der Einstellung erreichbar
     ist: in den Stammdaten der Schule, als Anmeldeadresse ihres Kontos oder
     in einer unbenutzten Einladung. Auch eine abgelaufene Einladung zählt:
     Sie verbindet die Person der Schule mit der Adresse, wie beim Import
     (`identityaccess.SchoolEmailQuery`).

   Namen vergleicht moto ohne Groß- und Kleinschreibung und ohne doppelte
   Leerzeichen, Adressen ohne Groß- und Kleinschreibung. Ein anderes
   Geburtsdatum unterscheidet zwei Personen. Eine Akte hat keine Adresse
   (Punkt 8), ihre Einsatzorte haben sie; eine Person mit Akte ist der
   Treffer ihrer Akte.
2. **Der gleiche Name allein fragt.** Namensgleichheit ist häufig. Die
   Rückfrage kostet einen Klick, eine doppelte Person dagegen eine
   Bereinigung an jeder Schule. Die Rückfrage sagt deshalb je Treffer den
   Grund, und „Trotzdem einstellen“ bleibt.
3. **Die Antwort nennt die Person.** Jeder Treffer an einer Schule nennt
   Schule, Beschäftigung (`staff_id`), Namen und Gründe; eine Akte ihre ID,
   Namen und Grund. Das Formular führt damit direkt zu „Akte anlegen“ für
   diese Person unter „Ohne Akte“. Das Zugriffsprotokoll der Schule nennt
   wie bisher jede gezeigte Beschäftigung (Ansicht `staff_hire_check`).
4. **Adressen kommen vom Owner.** Konten und Einladungen gehören Identity &
   Access. Workforce fragt sie in der Tenant-Transaktion der Schule über
   den Port `TraegerSchoolEmails`, den die Wurzel an
   `identityaccess.SchoolEmailQuery` bindet, wie der Import der Schule. Die
   Stammdaten liest Workforce selbst. Je Schule kommen zwei Abfragen hinzu,
   unabhängig von der Zahl der Personen, und nur, wenn die Einstellung eine
   Adresse hat.

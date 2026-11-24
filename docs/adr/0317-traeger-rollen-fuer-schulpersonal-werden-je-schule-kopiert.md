---
status: accepted
---

# Träger-Rollen für das Schulpersonal werden je Schule kopiert

Entscheidung vom 2026-11-24 für
[#4810](https://github.com/moto-ogs/project-phoenix/issues/4810) (Modulkatalog
„Zentrale Verwaltung“). Das Issue legt das Verhalten fest: Eine Träger-Rolle
erscheint in jeder Schule des Trägers als Rolle „vom Träger“, auch in später
hinzukommenden Schulen; die Schule weist sie zu, ändert und löscht sie aber
nicht. Diese ADR hält fest, wie das gebaut ist. Sie baut auf
[ADR 0084](0084-traeger-portal-liest-ueber-eine-projektion-und-schreibt-in-der-schule.md)
Abschnitt 2 und
[ADR 0105](0105-ferienzeitraum-liegt-beim-traeger-in-der-traeger-transaktion.md)
auf und folgt dem Muster der Abwesenheitsarten des Trägers
([ADR 0236](0236-abwesenheitsarten-des-traegers-gehen-in-die-schulen-und-eine-datenbankfunktion-prueft-das-kontingent.md)).
Sie führt keinen Owner und keine Policy-Regel ein.

## Kontext

- Eine Schulrolle ist eine Zeile in `auth.roles` mit `tenant_id`, ihre Rechte
  stehen in `auth.role_permissions`, ihre Zuweisungen in
  `auth.account_roles`. Anmeldung und Sitzungserneuerung lesen die Rechte
  über die Zuweisung. Einladungen (`auth.invitation_tokens`) und
  Ordnerfreigaben zeigen per Fremdschlüssel auf die Rolle.
- Plattformrollen haben `tenant_id NULL` und `is_system`. Die
  Tenant-Policy von `auth.roles` zeigt sie jeder Schule.
- ADR 0084 schließt eine zweite Policy-Familie auf Schultabellen aus und
  verlangt, dass jedes Schreiben an Daten einer Schule in deren
  Tenant-Transaktion läuft. Die Rollen des Träger-Büros selbst
  (`auth.organization_account_roles`) sind ein anderes System und bleiben
  unberührt.

## Entscheidung

### 1. Datenmodell

- **Träger-Rolle:** `auth.traeger_school_roles` (Name, Beschreibung, „Gilt
  als“ `admin` oder `user`) und `auth.traeger_school_role_permissions`. Beide
  tragen `organization_id`, eine Policy auf `app.current_org_id` und
  `FORCE ROW LEVEL SECURITY`. Owner ist Identity & Access. Keine Schule liest
  sie.
- **Kopie:** eine gewöhnliche Zeile in `auth.roles` der Schule mit
  `traeger_role_id`. Die Spalte ist kein Fremdschlüssel, wie die übrigen
  Träger-Bezüge. Ein eindeutiger Index `(tenant_id, traeger_role_id)`
  verhindert eine zweite Kopie. Zuweisung, Anmeldung, Erneuerung, Einladung
  und Ordnerfreigabe lesen die Kopie ohne Änderung.
- Rollennamen bleiben je Schule eindeutig. Eine Träger-Rolle darf nicht wie
  eine Plattformrolle heißen.

### 2. Schreiben

1. Das Träger-Büro speichert die Träger-Rolle in der Träger-Transaktion.
2. Danach schreibt Identity & Access sie in jede Schule des Trägers, je
   Schule in einer eigenen Tenant-Transaktion, nie ineinander (ADR 0105). Die
   Root bindet die beiden Transaktionen und die Schulliste von Organisation &
   Tenancy an Ports von Identity & Access. Ein Workflow-Owner ist nicht
   nötig: Träger-Rolle und Kopie gehören demselben Owner.
3. Die Kopie nimmt die Sperren der Rollenverwaltung: erst die Konten der
   Personen mit der Rolle in ID-Reihenfolge, dann die Rollenzeile.
4. Fällt ein Recht weg, enden die Sitzungen aller Personen mit der Rolle an
   dieser Schule, wie bei jeder Rechteänderung einer Schulrolle. Ein neues
   Recht kommt bei der nächsten Sitzungserneuerung an.
5. Scheitert eine Schule, bleibt sie beim alten Stand. Die Liste im
   Träger-Portal zeigt sie als „nicht übertragen“; die nächste Änderung der
   Rolle versucht es wieder. Teilfehler über mehrere Schulen sind nicht
   atomar (ADR 0067).
6. Die Schule ändert an der Kopie nichts: Stammdaten, Rechte und Löschen
   antworten 403 `identity.role_from_traeger`. Zuweisen darf sie wie jede
   eigene Rolle. Eigene Rollen legt sie weiter an.

### 3. Später hinzukommende Schulen

Ein Trigger auf `platform.schools` (`AFTER INSERT` und
`AFTER UPDATE OF organization_id`) legt die Kopien der Träger-Rollen in der
Anweisung an, die die Schule anlegt oder umhängt. So wartet keine Schule auf
die nächste Änderung im Träger-Büro, und Organisation & Tenancy hängt nicht
von Identity & Access ab (wie ADR 0195 Abschnitt 8).

- Wechselt eine Schule den Träger, bleiben ihre bisherigen Kopien als eigene
  Rollen der Schule stehen (`traeger_role_id` wird NULL). Niemand verliert
  durch den Wechsel ein Recht.
- Hat die Schule schon eine eigene Rolle mit dem Namen, bleibt diese
  unverändert. Die Träger-Rolle gilt dort als nicht übertragen, mit dem Grund
  „Name vergeben“. Beim Anlegen und Umbenennen lehnt das Träger-Portal einen
  solchen Namen mit `traeger.school_role_name_used_at_school` ab und nennt
  die Schulen.

### 4. Entfernen

- `GET /traeger/school-roles/{id}/removal-preview` zeigt je Schule die
  Personen mit der Rolle und einen Token über Rolle, Schulen und Konten.
- `POST /traeger/school-roles/{id}/removal` verlangt diesen Token. Ohne ihn
  oder nach einer Änderung der Zuweisungen passiert nichts
  (`general.changed_since_read`, ADR 0311). Jede Schule prüft ihre Personen
  unter ihren Sperren noch einmal.
- Je Schule: Sitzungen der Personen beenden, Zuweisungen, Rechte und Kopie
  löschen. Zuletzt die Träger-Rolle in der Träger-Transaktion.
- Nennt eine Einladung der Schule die Rolle, lässt sie sich nicht löschen
  (`ON DELETE RESTRICT`). Die Kopie bleibt dann als eigene Rolle der Schule
  mit ihren Personen stehen; die Vorschau sagt das vorher.

### 5. Rechte und Katalog

- Alle Routen unter `/traeger/school-roles` verlangen das Träger-Recht
  „Einstellungen“ (`traeger_settings:manage`), wie die übrigen Vorgaben des
  Trägers für seine Schulen.
- Der Katalog nennt die Rechte der Schule ohne die gesperrten
  Plattformrechte (#4574). Ein gesperrtes Recht in einer Anfrage antwortet
  400 `identity.role_platform_permission`.
- Zwei Vorauswahlen, gebaut wie die Vorlagen der Schule: „Betreuung“ (Rechte
  der Plattformrolle `user`) und „Verwaltung“ (ganzer Katalog). Rechte, die
  eine Schule nur bewusst vergibt, sind in keiner.

### 6. Audit

Jede Änderung an einer Kopie steht in `audit.auth_events` der Schule, in
derselben Tenant-Transaktion: Ereignis `traeger_role_changed` mit
`level: traeger`, dem Träger, der handelnden Person des Träger-Büros, der
Rolle und der Aktion (`created`, `updated`, `removed`, `released`).
Scheitert der Eintrag, rollt die Änderung dieser Schule zurück. Beendete
Sitzungen stehen wie bisher als `token_revoked` mit `role_changed` daneben.

## Verworfene Optionen

- **Träger-Rolle als Zeile in `auth.roles` mit `organization_id`:** die zweite
  Policy-Familie auf einer Schultabelle, die ADR 0084 und ADR 0195 (Option B)
  verwerfen. Ein Fehler in der Lese-Policy zeigte die Rollen eines fremden
  Trägers.
- **Live-Auflösung wie bei den Einstellungen (ADR 0086):** Zuweisungen,
  Einladungen und Ordnerfreigaben zeigen per Fremdschlüssel auf
  `auth.roles`. Ohne Kopie bräuchte jede dieser Stellen einen zweiten Weg,
  und Anmeldung und Erneuerung müssten zwei Quellen vereinen.
- **Nachziehen erst bei der nächsten Änderung** (wie ADR 0236): Das Issue
  verlangt die Rolle auch in später hinzukommenden Schulen. Eine neue Schule
  bräuchte sonst einen Klick im Träger-Büro, den niemand kennt.
- **Übernahme einer gleichnamigen Schulrolle** (wie bei den
  Abwesenheitsarten): Sie änderte still die Rechte der Personen mit dieser
  Rolle.
- **Eigener Workflow-Owner:** Ein Workflow verbindet mehrere Owner. Hier
  schreibt ein Owner seine eigenen Tabellen.
- **Eigene Audit-Tabelle:** Das Ledger der Schule trägt schon die
  Rollenwechsel durch das moto-Team (`tenant_role_changed`) mit Träger und
  Schule; ein weiterer Ereignistyp reicht.

## Folgen in den Registern

- `policy/identity-access.json`: `data_objects`
  `auth.traeger_school_roles` und `auth.traeger_school_role_permissions`.
- `command-effects`: die Root-Bindungen der drei Ports (Schulen, Namen,
  Transaktionen) als Lesezugriffe und Plattform-Teilnahme (ADR 0098).
- Kein neuer Eintrag in `transaction_boundaries.json`: Die Transaktionen
  öffnet die vorhandene Root-Bindung `traegerDocumentRuntime`.
- Route-Golden, Analytics-Klassifikation (`notCaptured`), Abfragebudget
  `api.traeger.school_roles` und Scope-Matrix für die neuen Routen.
- Seed: Der Demo-Träger bekommt eine Träger-Rolle.

## Nicht entschieden

- Ein eigener Eintrag im Zugriffsprotokoll des Trägers. Die Änderung steht
  im Ledger jeder Schule; eine Ansicht im Träger-Portal folgt bei Bedarf.
- Vorgaben des Trägers für die Rollen des Träger-Büros selbst.

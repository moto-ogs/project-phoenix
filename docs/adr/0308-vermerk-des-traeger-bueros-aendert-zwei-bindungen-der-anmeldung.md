---
status: proposed
---

# Vermerk des Träger-Büros ändert zwei Bindungen der Anmeldung

Entscheidung vom 2026-11-22 für
[#7818](https://github.com/moto-ogs/project-phoenix/issues/7818) nach
[ADR 0084](0084-traeger-portal-liest-ueber-eine-projektion-und-schreibt-in-der-schule.md),
zweiter Nachtrag vom 22.11.2026. Sie genehmigt neue Digests zweier bestehender
Command-Effect-Bindungen. Sie ändert keinen Effekt, keine Klassifikation,
keinen Owner, keine Policy-Regel und keine Sperre.

## Kontext

Gibt eine Schulsitzung aus dem Träger-Portal eine Anmeldung mit Bring- oder
Abholzeiten frei, schreibt die Anmeldung diese Zeiten über ihre beiden Ports
in die Betreuungszeiten. Die Person hat an der Schule keinen
Personal-Datensatz; die Zeile trägt dann `entered_by_traeger` statt eines
Personal-Urhebers. Die Ports und ihre Bindung an Timetable reichten bisher nur
den Personal-Urheber durch und brauchen dafür einen weiteren Wert. Das ändert
ihren Digest.

| Port | Ziel | Digest |
|---|---|---|
| `enrollment/internal/application.WeeklyArrivalSchedules.CreateArrivalSchedule` | `timetable/internal/application.EnrollmentArrivalSchedules.CreateArrivalSchedule` | `a6dd49be8614154d9299260a38973937` |
| `enrollment/internal/application.WeeklyPickupSchedules.UpsertPickupSchedule` | `timetable/internal/application.EnrollmentPickupSchedules.UpsertPickupSchedule` | `d348edf38f4a0820e5b8934db86f9f7d` |

## Entscheidung

Beide Bindungen schreiben dieselbe Zeile im selben Schreibvorgang wie zuvor
und reichen zusätzlich durch, ob das Träger-Büro die Zeit eingetragen hat.
Ihre Review-Einträge nennen diese ADR als `approval_adr`. Die Einstufung E1
aus ADR 0067, Transaktion, Sperrreihenfolge und Fehlerpfad bleiben
unverändert.

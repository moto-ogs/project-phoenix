//go:build testhooks

package notifications_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

// Frozen full wire catalogues from the seed contract, not the live registry.
var preferenceScheduleCatalogues = map[string]string{
	"staff":  `[{"key":"pickup_upcoming","label":"Anstehende Abholung","description":"Kurz bevor ein Kind abgeholt wird, das du gerade betreust.","group":"abholung","enabled":false,"available":true},{"key":"pickup_overdue","label":"Überfällige Abholung","description":"Wenn ein Kind nach seiner Abholzeit noch da ist.","group":"abholung","enabled":false,"available":false},{"key":"activity_start","label":"Aktivität in deinem Raum","description":"Kurz bevor eine geplante Aktivität in einem Raum startet, den du gerade beaufsichtigst.","group":"aktivitaeten","enabled":false,"available":true},{"key":"activity_overdue","label":"Aktivität nicht gestartet","description":"Wenn eine geplante Aktivität überfällig ist und noch niemand sie gestartet hat.","group":"aktivitaeten","enabled":false,"available":true},{"key":"activity_running_over","label":"AG dauert länger","description":"Wenn eine gestartete Aktivität in einem Raum deiner Aufsicht nach dem geplanten Ende noch läuft.","group":"aktivitaeten","enabled":false,"available":true},{"key":"my_activity_starting","label":"Dein nächster Einsatz","description":"Kurz bevor ein Einsatz aus deinem Betreuungsplan beginnt, auch wenn du gerade keine Aufsicht führst.","group":"aktivitaeten","enabled":false,"available":true},{"key":"student_absence_reported","label":"Krankmeldung eines Kindes","description":"Wenn für ein Kind aus deinen Gruppen eine Krankmeldung oder Entschuldigung für heute eingetragen wird.","group":"kinder","enabled":false,"available":true},{"key":"staff_parent_message","label":"Nachrichten von Eltern","description":"Wenn Eltern der OGS eine neue Nachricht schreiben.","group":"mitteilungen","enabled":false,"available":true},{"key":"staff_message","label":"Nachrichten von Kolleginnen und Kollegen","description":"Wenn dir jemand aus dem Team eine Nachricht im Team-Chat schreibt.","group":"mitteilungen","enabled":false,"available":false},{"key":"staff_survey","label":"Umfragen der Einrichtung","description":"Wenn die Einrichtung eine Umfrage an das Team veröffentlicht oder an eine offene Umfrage erinnert.","group":"mitteilungen","enabled":false,"available":true},{"key":"staff_qualification_own_expiry","label":"Eigene Nachweise","description":"Wenn einer deiner Nachweise bald abläuft und am Ablauftag. Eine E-Mail bekommst du in jedem Fall.","group":"mitteilungen","enabled":false,"available":true}]`,
	"school": `[{"key":"school_class_absence_reported","label":"Krankmeldungen meiner Klassen","description":"Wenn ein Kind aus deinen Klassen für heute krankgemeldet oder entschuldigt wird.","group":"kinder","enabled":false,"available":true},{"key":"class_timetable_changed","label":"Stundenplan deiner Klassen: heute und morgen","description":"Wenn sich der Unterrichtsschluss einer Klasse, der du zugeordnet bist oder deren Kinder in deiner Gruppe sind, für heute oder morgen ändert. Der Hinweis in moto kommt immer.","group":"kinder","enabled":true,"available":true},{"key":"class_timetable_changed_ahead","label":"Stundenplan deiner Klassen: spätere Tage","description":"Mitteilung aufs Handy auch, wenn sich der Unterrichtsschluss einer deiner Klassen in 2 bis 14 Tagen ändert. Der Hinweis in moto kommt immer.","group":"kinder","enabled":false,"available":true},{"key":"staff_message","label":"Nachrichten von Kolleginnen und Kollegen","description":"Wenn dir jemand aus dem Team eine Nachricht im Team-Chat schreibt.","group":"mitteilungen","enabled":false,"available":false},{"key":"instance_cancelled","label":"Absage eines Termins","description":"Wenn ein Termin oder Angebot abgesagt wird, für den du eingeplant bist. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur bei Absagen in den nächsten 14 Tagen.","group":"termine","enabled":true,"available":true},{"key":"school_parent_conference_booking","label":"Buchungen am Elternsprechtag","description":"Wenn Eltern einen Termin an deinem Elternsprechtag buchen, verschieben oder absagen.","group":"termine","enabled":false,"available":true},{"key":"instance_room_changed","label":"Raumänderung heute oder morgen","description":"Wenn ein Termin, für den du eingeplant bist, heute oder morgen in einem anderen Raum stattfindet. Der Hinweis in moto kommt immer.","group":"termine","enabled":true,"available":true},{"key":"instance_room_changed_later","label":"Raumänderung an späteren Tagen","description":"Wenn ein Termin, für den du eingeplant bist, ab übermorgen in einem anderen Raum stattfindet. Der Hinweis in moto kommt immer. Die Mitteilung aufs Handy kommt nur, wenn du sie einschaltest, und nur für die nächsten 14 Tage.","group":"termine","enabled":false,"available":true}]`,
}

func preferenceScheduleExpected(t *testing.T, pair preferenceGatePair, schedule string) string {
	t.Helper()
	var rows []map[string]any
	require.NoError(t, json.Unmarshal([]byte(preferenceScheduleCatalogues[pair.portal]), &rows))
	if pair.portal == "school" {
		closingDay := map[string]any{"key": "school_closing_day_changed", "label": "Schließtage", "description": "Wenn ein Schließtag eingetragen, geändert oder gelöscht wird. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur bei Schließtagen in den nächsten 14 Tagen.", "group": "termine", "enabled": true, "available": true}
		for i, row := range rows {
			if row["key"] == "instance_room_changed" {
				rows = append(rows[:i+1], append([]map[string]any{closingDay}, rows[i+1:]...)...)
				break
			}
		}
	}
	for _, row := range rows {
		if row["key"] == pair.firstType {
			row["enabled"] = true
			row["available"] = schedule != "stable_new"
		}
		if row["key"] == pair.secondType {
			row["enabled"] = true
			// One shared gate read (#5699, decision E2): a pair committed
			// after it is visible on neither gate, so between_reads shows the
			// old pair like stable_old instead of mixing old and new.
			row["available"] = schedule == "stable_new"
		}
	}
	body, err := json.Marshal(map[string]any{"status": "success", "message": "Notification preferences retrieved successfully", "data": map[string]any{"tenant_enabled": true, "types": rows}})
	require.NoError(t, err)
	return string(body)
}

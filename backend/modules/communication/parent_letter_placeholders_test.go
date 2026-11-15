package communication_test

import (
	"reflect"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/communication"
)

func TestFillParentLetterWritesEachChildsOwnValues(t *testing.T) {
	t.Parallel()
	body := "Liebe Eltern von {{vorname}} {{nachname}},\n\n{{vorname}} geht in die {{klasse}} und in die Gruppe {{gruppe}}.\nGebuchte Tage: {{betreuungstage}}\nAbholzeit: {{abholzeit}}"
	lina := communication.ParentLetterChild{
		FirstName: "Lina", LastName: "Muster", SchoolClass: "3a", Group: "Füchse",
		CareDays: "Montag, Dienstag und Donnerstag", PickupTime: "15:30 Uhr",
	}
	got := communication.FillParentLetter(body, lina)
	want := "Liebe Eltern von Lina Muster,\n\nLina geht in die Klasse 3a und in die Gruppe Füchse.\nGebuchte Tage: Montag, Dienstag und Donnerstag\nAbholzeit: 15:30 Uhr"
	if got != want {
		t.Fatalf("filled letter:\n%q\nwant\n%q", got, want)
	}
}

func TestFillParentLetterLeavesOutALineWhoseValuesAreAllEmpty(t *testing.T) {
	t.Parallel()
	body := "Hallo {{vorname}},\nAbholzeit: {{abholzeit}}\nGruppe {{gruppe}}, {{klasse}}\nBis bald"
	got := communication.FillParentLetter(body, communication.ParentLetterChild{FirstName: "Ben", SchoolClass: "2b"})
	want := "Hallo Ben,\nGruppe , Klasse 2b\nBis bald"
	if got != want {
		t.Fatalf("filled letter:\n%q\nwant\n%q", got, want)
	}
}

func TestFillParentLetterKeepsTheWordsOfASentenceAroundAnEmptyValue(t *testing.T) {
	t.Parallel()
	body := "Bitte morgen Sportsachen mitbringen. Abholzeit: {{abholzeit}}\nWir holen {{vorname}} ab."
	got := communication.FillParentLetter(body, communication.ParentLetterChild{})
	want := "Bitte morgen Sportsachen mitbringen. Abholzeit: \nWir holen  ab."
	if got != want {
		t.Fatalf("filled letter:\n%q\nwant\n%q", got, want)
	}
}

func TestFillParentLetterKeepsTextWithoutPlaceholders(t *testing.T) {
	t.Parallel()
	body := "Liebe Eltern,\n\nam Freitag ist Sommerfest.\n"
	if got := communication.FillParentLetter(body, communication.ParentLetterChild{}); got != body {
		t.Fatalf("got %q, want the text unchanged", got)
	}
}

func TestParentLetterPlaceholderProblemsNameUnknownAndBrokenOnes(t *testing.T) {
	t.Parallel()
	got := communication.UnknownParentLetterPlaceholders("{{vorname}} {{ Klasse }} {{geburtstag}} {nachname}} {{allergien}}")
	want := []string{"allergien", "geburtstag", "{nachname}}"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unknown placeholders = %v, want %v", got, want)
	}
	if got := communication.UnknownParentLetterPlaceholders("{{ vorname }} und {{abholzeit}}"); len(got) != 0 {
		t.Fatalf("known placeholders reported unknown: %v", got)
	}
}

func TestParentLetterPlaceholdersExcludeHealthData(t *testing.T) {
	t.Parallel()
	names := map[string]bool{}
	for _, p := range communication.ParentLetterPlaceholders() {
		names[p.Name] = true
		if p.Label == "" || p.Example == "" {
			t.Fatalf("placeholder %q needs a label and an example", p.Name)
		}
	}
	want := map[string]bool{"vorname": true, "nachname": true, "klasse": true, "gruppe": true, "betreuungstage": true, "abholzeit": true}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("placeholders = %v, want exactly %v", names, want)
	}
	if !communication.HasParentLetterPlaceholders("Hallo {{vorname}}") || communication.HasParentLetterPlaceholders("Hallo Familie") {
		t.Fatal("HasParentLetterPlaceholders misreads a text")
	}
}

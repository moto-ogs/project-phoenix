package enrollment_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// The privacy text of a new registration says that the Träger keeps the
// customer number of the Gemeinde for later registrations and when it goes
// (#6692): a new wording, so a new version that every new registration
// agrees to again. The wording of version 4 stays as the parents agreed to
// it.
func TestConsentTextsNameTheKeptDebtorNumberFromVersionFive(t *testing.T) {
	t.Parallel()
	current, ok := enrollment.HolidayConsentTextsOf(enrollment.HolidayConsentVersionDebtorNumber, 365)
	require.True(t, ok)
	assert.Equal(t, 5, current.Version)
	assert.Equal(t, 365, current.RetentionDays)
	assert.Contains(t, current.PrivacyConsent, "Er löscht sie 365 Tage nach den Ferien.")
	assert.Contains(t, current.PrivacyConsent, "Kundennummer der Gemeinde (Debitorennummer)")
	assert.Contains(t, current.PrivacyConsent, "Er löscht sie am Ende des dritten Jahres nach der letzten Anmeldung.")
	assert.NotEmpty(t, current.CustodyConfirmed)

	previous, ok := enrollment.HolidayConsentTextsOf(4, 365)
	require.True(t, ok)
	assert.Equal(t, 4, previous.Version)
	assert.NotContains(t, previous.PrivacyConsent, "Debitorennummer", "version 4 keeps its wording")
	assert.Equal(t, previous.PrivacyConsent, current.PrivacyConsent[:len(previous.PrivacyConsent)],
		"version 5 adds to the text of version 4")
}

// The name sentence addresses the parent with Du from version 6 on (#7687,
// ADR 0294): a new wording, so a new version that every new registration
// agrees to. Versions 3 to 5 keep the sentence the parents agreed to.
func TestConsentTextsGiveTheNameSentenceInDuFromVersionSix(t *testing.T) {
	t.Parallel()
	current, ok := enrollment.HolidayConsentTextsOf(enrollment.HolidayConsentVersionInformalDeclaration, 365)
	require.True(t, ok)
	assert.Equal(t, 6, current.Version)
	assert.Equal(t, "Mit deinem Namen gibst du die Erklärungen oben ab.", current.DeclarationName)

	previous, ok := enrollment.HolidayConsentTextsOf(enrollment.HolidayConsentVersionDebtorNumber, 365)
	require.True(t, ok)
	previous.Version, previous.DeclarationName = current.Version, current.DeclarationName
	assert.Equal(t, previous, current, "version 6 changes only the name sentence")

	for _, version := range []int{3, 4, 5} {
		texts, ok := enrollment.HolidayConsentTextsOf(version, 365)
		require.True(t, ok)
		assert.Equal(t, "Mit Ihrem Namen geben Sie die Erklärungen oben ab.", texts.DeclarationName,
			"version %d keeps its wording", version)
	}
}

// The privacy and health texts name the team that cares for the child from
// version 7 on (#8136): a school may call its care "der Hort", so "die OGS"
// is wrong for it. A new wording, so a new version that every new
// registration agrees to. Versions 2 to 6 keep the words the parents agreed
// to.
func TestConsentTextsNameTheCareTeamFromVersionSeven(t *testing.T) {
	t.Parallel()
	assert.Equal(t, 7, enrollment.HolidayConsentVersionCurrent, "the changed recipient wording is a new version")

	current, ok := enrollment.HolidayConsentTextsOf(enrollment.HolidayConsentVersionCurrent, 365)
	require.True(t, ok)
	assert.Equal(t, 7, current.Version)
	assert.NotContains(t, current.PrivacyConsent+current.HealthConsent, "OGS")
	assert.Contains(t, current.PrivacyConsent, "Das Team, das mein Kind in einer Ferienwoche betreut, sieht Name und Telefon")
	assert.Contains(t, current.PrivacyConsent, "Er löscht sie 365 Tage nach den Ferien. Gesundheitsangaben löscht er schon 92 Tage nach den Ferien.")
	assert.Contains(t, current.PrivacyConsent, "Kundennummer der Gemeinde (Debitorennummer)")
	assert.Equal(t, "Ich bin einverstanden: Der Träger und das Betreuungsteam sehen die Gesundheitsangaben meiner Kinder. "+
		"Es geht um das Team, das ein Kind in einer Ferienwoche betreut. "+
		"Es sieht die Angaben ab der Bestätigung bis zum letzten Tag der Woche.", current.HealthConsent)

	previous, ok := enrollment.HolidayConsentTextsOf(enrollment.HolidayConsentVersionInformalDeclaration, 365)
	require.True(t, ok)
	assert.Equal(t, "Ich bin einverstanden, dass der Träger die Angaben für die Ferienbetreuung nutzt. "+
		"Er löscht sie 365 Tage nach den Ferien. Gesundheitsangaben löscht er schon 92 Tage nach den Ferien. "+
		"Die OGS, die mein Kind in einer Ferienwoche betreut, "+
		"sieht Name und Telefon der zweiten sorgeberechtigten Person. Sie sieht auch die Antworten, "+
		"die der Träger für sie freigibt. Gesundheitsangaben sieht sie nur, wenn ich zustimme. "+
		"Die OGS sieht das schon vor der Ferienwoche. So kann sie sich vorbereiten. "+
		"Die Liste der Kinder sieht sie bis zum letzten Tag der Woche. "+
		"Name, Telefon und Antworten kann sie danach höchstens 7 Tage lesen. Dann werden sie gelöscht. "+
		"Bekommt meine Rechnung eine Kundennummer der Gemeinde (Debitorennummer), behält der Träger sie für spätere Anmeldungen. "+
		"Er löscht sie am Ende des dritten Jahres nach der letzten Anmeldung. "+
		"Muss er Rechnungen länger aufbewahren, löscht er sie danach.", previous.PrivacyConsent, "version 6 keeps its wording word for word")
	assert.Equal(t, "Ich bin einverstanden: Der Träger und die OGS sehen die Gesundheitsangaben meiner Kinder. "+
		"Es geht um die OGS, die ein Kind in einer Ferienwoche betreut. "+
		"Sie sieht die Angaben ab der Bestätigung bis zum letzten Tag der Woche.", previous.HealthConsent, "version 6 keeps its wording word for word")
	previous.Version, previous.PrivacyConsent, previous.HealthConsent = current.Version, current.PrivacyConsent, current.HealthConsent
	assert.Equal(t, previous, current, "version 7 changes only the privacy and the health text")

	_, ok = enrollment.HolidayConsentTextsOf(8, 365)
	assert.False(t, ok, "no texts for a version that does not exist yet")
}

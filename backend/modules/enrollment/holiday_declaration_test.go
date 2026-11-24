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
	assert.Equal(t, 6, enrollment.HolidayConsentVersionCurrent, "the changed name sentence is a new version")

	current, ok := enrollment.HolidayConsentTextsOf(enrollment.HolidayConsentVersionCurrent, 365)
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
		assert.Equal(t, "Mit Ihrem Namen geben Sie die Erklärungen oben ab.", texts.DeclarationName, // sie-anrede-erlaubt (ADR 0294): Wortlaut der Versionen 3 bis 5
			"version %d keeps its wording", version)
	}
	_, ok = enrollment.HolidayConsentTextsOf(7, 365)
	assert.False(t, ok, "no texts for a version that does not exist yet")
}

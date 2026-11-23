package messaging

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The sharing token covers what a choice depends on (ADR 0311): a choice
// made before the school switched family protection on or off must be
// refused, so the token changes with the protection alone. Order and names
// change no choice and leave it alone.
func TestRequestSharingVersion_ChangesWithFamilyProtection(t *testing.T) {
	t.Parallel()
	recipients := []RequestSharingRecipient{
		{GuardianProfileID: 7, FirstName: "Mara", LastName: "Muster"},
		{GuardianProfileID: 3, FirstName: "Jonas", LastName: "Teiler", Selected: true},
	}
	open := requestSharingVersion(false, recipients)

	assert.NotEqual(t, open, requestSharingVersion(true, recipients), "family protection switched on")
	assert.Equal(t, open, requestSharingVersion(false, []RequestSharingRecipient{
		{GuardianProfileID: 3, FirstName: "Jona", LastName: "Teiler", Selected: true},
		{GuardianProfileID: 7, FirstName: "Mara", LastName: "Muster-Neu"},
	}), "reordered and renamed")
	assert.NotEqual(t, open, requestSharingVersion(false, []RequestSharingRecipient{
		{GuardianProfileID: 7, Selected: true},
		{GuardianProfileID: 3, Selected: true},
	}), "another guardian chosen")
}

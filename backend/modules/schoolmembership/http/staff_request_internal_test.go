package staff

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The staff body arrives through the catalog proxy as the browser sent it
// (#7563); Bind trims the free-text fields the route file used to trim.
func TestStaffRequestBindTrimsFreeText(t *testing.T) {
	t.Parallel()
	req := &StaffRequest{PersonID: 7, StaffNotes: "  notiz \n", Specialization: " Sport ", Role: " Leitung ", Qualifications: " Erzieherin "}
	require.NoError(t, req.Bind(nil))
	assert.Equal(t, "notiz", req.StaffNotes)
	assert.Equal(t, "Sport", req.Specialization)
	assert.Equal(t, "Leitung", req.Role)
	assert.Equal(t, "Erzieherin", req.Qualifications)

	require.Error(t, (&StaffRequest{}).Bind(nil), "a body without a person stays refused")
}

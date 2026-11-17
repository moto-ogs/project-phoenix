package api

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// kioskRosterUsers serves a fixed school roster; every other read is unused.
type kioskRosterUsers struct {
	deviceScanUserRows
	roster []peopledirectory.StudentRosterEntry
}

func (u kioskRosterUsers) GetAllStudentsWithGroups(context.Context) ([]peopledirectory.StudentRosterEntry, error) {
	return u.roster, nil
}

// TestKioskRosterLeavesOutChildrenWithoutCarePlace keeps a child without an
// OGS place (#4803) off the kiosk: it never checks in at the OGS.
func TestKioskRosterLeavesOutChildrenWithoutCarePlace(t *testing.T) {
	t.Parallel()
	person := func(first string) *peopledirectory.DirectoryPersonSnapshot {
		return &peopledirectory.DirectoryPersonSnapshot{FirstName: first, LastName: "Kiosk"}
	}
	withPlace := &peopledirectory.StudentState{ID: 1, SchoolClass: "1a", Person: person("Mit")}
	withoutPlace := &peopledirectory.StudentState{ID: 2, SchoolClass: "1a", Person: person("Ohne"), WithoutCarePlace: true}
	people := DeviceScanPeople{Users: kioskRosterUsers{roster: []peopledirectory.StudentRosterEntry{
		{Record: withPlace}, {Record: withoutPlace},
	}}}

	students, err := people.Students(context.Background(), nil)

	require.NoError(t, err)
	require.Len(t, students, 1)
	assert.Equal(t, withPlace.ID, students[0].StudentID)
}

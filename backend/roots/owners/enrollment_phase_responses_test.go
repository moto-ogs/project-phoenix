package owners

import (
	"context"
	"testing"

	peopledirectory "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type phaseResponseRosterQuery struct {
	peopledirectory.StudentRosterQuery
	entries []peopledirectory.StudentRosterEntry
}

func (q phaseResponseRosterQuery) ListStudentRoster(context.Context, string) ([]peopledirectory.StudentRosterEntry, error) {
	return q.entries, nil
}

// TestPhaseResponsesLeaveOutChildrenWithoutCarePlace asks only OGS families
// in an Anmeldephase (#4803 review): a child without an OGS place never
// shows up as a child whose family has not answered.
func TestPhaseResponsesLeaveOutChildrenWithoutCarePlace(t *testing.T) {
	t.Parallel()
	withPlace := &peopledirectory.StudentState{Status: peopledirectory.StudentStatusActive}
	withoutPlace := &peopledirectory.StudentState{Status: peopledirectory.StudentStatusActive, WithoutCarePlace: true}
	withPlace.ID, withoutPlace.ID = 1001, 1002
	roster := phaseResponseRoster{query: phaseResponseRosterQuery{entries: []peopledirectory.StudentRosterEntry{
		{Record: withPlace, FirstName: "Mit"},
		{Record: withoutPlace, FirstName: "Ohne"},
	}}}

	students, err := roster.ListRunningStudents(context.Background(), "2026-09-09")

	require.NoError(t, err)
	require.Len(t, students, 1)
	assert.Equal(t, withPlace.ID, students[0].ID)
}

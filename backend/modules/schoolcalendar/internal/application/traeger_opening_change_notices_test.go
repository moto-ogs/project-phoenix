package application

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type recordedTraegerOpeningChangeNotices map[int64][2]schoolcalendar.OpeningChangeNotice

func (n recordedTraegerOpeningChangeNotices) NotifySchool(_ context.Context, schoolID int64, notice, retraction schoolcalendar.OpeningChangeNotice) error {
	n[schoolID] = [2]schoolcalendar.OpeningChangeNotice{notice, retraction}
	return nil
}

func TestTraegerOpeningChangeNoticeUsesPreviousReasonForRemovedSchool(t *testing.T) {
	t.Parallel()
	const (
		remainingSchool = 101
		removedSchool   = 102
	)
	notices := recordedTraegerOpeningChangeNotices{}
	changes := &TraegerOpeningChanges{
		notices: notices,
		today:   func() string { return "2030-06-01" },
	}
	previous := domain.TraegerOpeningChange{
		SchoolIDs: []int64{remainingSchool, removedSchool}, StartDate: calendar.Date("2030-06-12"), EndDate: calendar.Date("2030-06-12"),
		OpensAt: "07:30", ClosesAt: "12:00", Reason: "Personalversammlung",
	}
	current := traegercalendar.OpeningChange{
		SchoolIDs: []ident.ID{ident.ID(remainingSchool)}, StartDate: calendar.Date("2030-06-12"), EndDate: calendar.Date("2030-06-12"),
		OpensAt: "07:30", ClosesAt: "13:00", Reason: "Fortbildung",
	}

	require.NoError(t, changes.notify(context.Background(), 55, &previous, &current))
	require.Len(t, notices, 2)
	assert.Equal(t, "Fortbildung", notices[remainingSchool][0].Reason)
	assert.NotNil(t, notices[remainingSchool][0].Current)
	assert.Equal(t, "Personalversammlung", notices[removedSchool][0].Reason)
	assert.Nil(t, notices[removedSchool][0].Current)

	// The retraction tells each school the version that stands again.
	remaining := notices[remainingSchool][1]
	assert.Equal(t, "Personalversammlung", remaining.Reason)
	assert.Equal(t, "12:00", remaining.Current.ClosesAt)
	assert.Equal(t, "13:00", remaining.Previous.ClosesAt)
	assert.True(t, remaining.Traeger)
	removed := notices[removedSchool][1]
	assert.Equal(t, "Personalversammlung", removed.Reason)
	assert.Nil(t, removed.Previous, "the removed school reads the change again")
	assert.NotNil(t, removed.Current)
}

func TestTraegerOpeningChangeRetractionOfANewChangeTellsItsEnd(t *testing.T) {
	t.Parallel()
	notices := recordedTraegerOpeningChangeNotices{}
	changes := &TraegerOpeningChanges{notices: notices, today: func() string { return "2030-06-01" }}
	current := traegercalendar.OpeningChange{
		SchoolIDs: []ident.ID{101}, StartDate: calendar.Date("2030-06-12"), EndDate: calendar.Date("2030-06-12"),
		OpensAt: "07:30", ClosesAt: "12:00", Reason: "Personalversammlung",
	}

	require.NoError(t, changes.notify(context.Background(), 56, nil, &current))
	retraction := notices[101][1]
	assert.Equal(t, int64(56), retraction.OpeningChangeID)
	assert.Equal(t, "Personalversammlung", retraction.Reason)
	assert.NotNil(t, retraction.Previous)
	assert.Nil(t, retraction.Current, "a new change that did not commit no longer applies")
	assert.True(t, retraction.Push, "it pushes like the notice it retracts")
}

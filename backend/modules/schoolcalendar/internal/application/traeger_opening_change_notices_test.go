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

type recordedTraegerOpeningChangeNotices map[int64]schoolcalendar.OpeningChangeNotice

func (n recordedTraegerOpeningChangeNotices) NotifySchool(_ context.Context, schoolID int64, notice schoolcalendar.OpeningChangeNotice) error {
	n[schoolID] = notice
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
	assert.Equal(t, "Fortbildung", notices[remainingSchool].Reason)
	assert.NotNil(t, notices[remainingSchool].Current)
	assert.Equal(t, "Personalversammlung", notices[removedSchool].Reason)
	assert.Nil(t, notices[removedSchool].Current)
}

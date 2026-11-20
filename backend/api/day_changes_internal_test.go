package api

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type invisibleDayChangesCaller struct{}

func (invisibleDayChangesCaller) CurrentStaffID(context.Context) (int64, bool, error) {
	return 0, false, nil
}

func (invisibleDayChangesCaller) MyGroupIDs(context.Context) ([]int64, error) {
	return nil, errors.New("must not resolve groups for a non-staff account")
}

type unavailableDayChangesWorkforce struct {
	handoversRead bool
	absencesRead  bool
}

func (w *unavailableDayChangesWorkforce) ListStaffAbsences(context.Context, workforce.StaffAbsenceFilter) ([]workforce.StaffAbsence, error) {
	w.absencesRead = true
	return nil, errors.New("staff absences unavailable")
}

func (w *unavailableDayChangesWorkforce) ListGroupSubstitutions(context.Context, workforce.GroupSubstitutionFilter) ([]workforce.GroupSubstitution, error) {
	w.handoversRead = true
	return nil, errors.New("group substitutions unavailable")
}

type directDayChangesIsolation struct{}

func (directDayChangesIsolation) Run(ctx context.Context, read func(context.Context) error) error {
	return read(ctx)
}

func (directDayChangesIsolation) IsFatal(error) bool { return false }

func TestDayChangesInvisibleAccountSkipsUnavailableWorkforce(t *testing.T) {
	t.Parallel()
	workforceSource := &unavailableDayChangesWorkforce{}
	view, err := daychangesview.New(daychangesview.Dependencies{
		Today:     func() calendar.Date { return calendar.NewDate(2026, 9, 9) },
		Isolation: directDayChangesIsolation{},
		Staff: dayChangesStaff{sources: DayChangesSources{
			Caller:    invisibleDayChangesCaller{},
			Workforce: workforceSource,
		}},
	})
	require.NoError(t, err)

	overview, err := view.Today(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []daychangesview.SourceStatus{{Source: daychangesview.SourceStaff, Status: daychangesview.SourceLoaded}}, overview.Sources)
	assert.Empty(t, overview.Entries)
	assert.False(t, workforceSource.handoversRead)
	assert.False(t, workforceSource.absencesRead)
}

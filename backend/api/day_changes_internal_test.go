package api

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type invisibleDayChangesCaller struct{}

func (invisibleDayChangesCaller) CurrentStaffID(context.Context) (int64, bool, error) {
	return 0, false, nil
}

func (invisibleDayChangesCaller) MyTeacherGroupIDs(context.Context) ([]int64, error) {
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
		// Without users:read the notice source answers before reading.
		Notices: dayChangesNotices{},
		Closing: dayChangesClosingDays{},
	})
	require.NoError(t, err)

	overview, err := view.Today(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []daychangesview.SourceStatus{
		{Source: daychangesview.SourceStaff, Status: daychangesview.SourceLoaded},
		{Source: daychangesview.SourceNotices, Status: daychangesview.SourceLoaded},
		{Source: daychangesview.SourceClosingDays, Status: daychangesview.SourceLoaded},
	}, overview.Sources)
	assert.Empty(t, overview.Entries)
	assert.False(t, workforceSource.handoversRead)
	assert.False(t, workforceSource.absencesRead)
}

func TestDayChangesLinksRequireDestinationAccess(t *testing.T) {
	t.Parallel()
	restricted := newStaffEntryBuilder(staffViewer{
		groups: map[int64]bool{3: true},
		team:   map[int64]bool{2: true},
	}, calendar.NewDate(2026, 9, 9))
	restricted.absence(staffAbsenceSpan{staffID: 2, start: "2026-09-09", end: "2026-09-09"})
	restricted.handover(workforce.GroupSubstitution{
		GroupID: 3, SubstituteStaffID: 4, StartDate: "2026-09-09", EndDate: "2026-09-09",
	})
	restricted.appendCount(daychangesview.KindStaffAbsentCount, 1, daychangesview.LinkStaffList, false)
	restricted.appendCount(daychangesview.KindGroupSubstitutionCount, 1, daychangesview.LinkGroupHandovers, false)

	require.Len(t, restricted.entries, 4)
	for _, entry := range restricted.entries {
		assert.Nil(t, entry.Link, "every destination requires its accepted role or permission")
	}

	allowed := newStaffEntryBuilder(staffViewer{
		staffRecords: true, groupHandovers: true,
		groups: map[int64]bool{3: true}, team: map[int64]bool{2: true},
	}, calendar.NewDate(2026, 9, 9))
	allowed.absence(staffAbsenceSpan{staffID: 2, start: "2026-09-09", end: "2026-09-09"})
	allowed.handover(workforce.GroupSubstitution{
		GroupID: 3, SubstituteStaffID: 4, StartDate: "2026-09-09", EndDate: "2026-09-09",
	})
	allowed.appendCount(daychangesview.KindStaffAbsentCount, 1, daychangesview.LinkStaffList, true)
	allowed.appendCount(daychangesview.KindGroupSubstitutionCount, 1, daychangesview.LinkGroupHandovers, true)

	require.Len(t, allowed.entries, 4)
	assert.Equal(t, daychangesview.LinkStaffMember, allowed.entries[0].Link.Target)
	assert.Equal(t, daychangesview.LinkGroupHandovers, allowed.entries[1].Link.Target)
	assert.Equal(t, daychangesview.LinkStaffList, allowed.entries[2].Link.Target)
	assert.Equal(t, daychangesview.LinkGroupHandovers, allowed.entries[3].Link.Target)
}

func TestDayChangesViewerMatchesDestinationAccess(t *testing.T) {
	t.Parallel()
	viewer := dayChangesViewer(t, nil, []string{"custom"})
	assert.False(t, viewer.staffRecords)
	assert.False(t, viewer.groupHandovers)

	for _, permission := range []string{
		permissions.UsersRead,
		permissions.StaffManage,
		permissions.StaffStammdaten,
		permissions.TimeTrackingManage,
	} {
		t.Run(permission, func(t *testing.T) {
			viewer = dayChangesViewer(t, []string{permission}, []string{"custom"})
			assert.True(t, viewer.staffRecords)
			assert.False(t, viewer.groupHandovers)
		})
	}

	for _, role := range []string{"user", "teacher"} {
		t.Run(role, func(t *testing.T) {
			viewer = dayChangesViewer(t, nil, []string{role})
			assert.False(t, viewer.staffRecords)
			assert.True(t, viewer.groupHandovers)
		})
	}

	viewer = dayChangesViewer(t, []string{permissions.SubstitutionsRead}, []string{"custom"})
	assert.False(t, viewer.staffRecords)
	assert.True(t, viewer.groupHandovers)
}

func dayChangesViewer(t *testing.T, permissions, roles []string) staffViewer {
	t.Helper()
	ctx := context.WithValue(context.Background(), sessiontoken.CtxPermissions, permissions)
	ctx = context.WithValue(ctx, sessiontoken.CtxClaims, sessiontoken.AppClaims{Roles: roles})
	viewer, err := (dayChangesStaff{sources: DayChangesSources{Caller: invisibleDayChangesCaller{}}}).viewer(ctx)
	require.NoError(t, err)
	return viewer
}

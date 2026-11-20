// These unit tests use in-memory repository stubs and do not open a database.
package presence

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type supervisionQueryStub struct {
	PresenceQueries
	query  func(context.Context, studentpresence.GroupSupervisionFilter) ([]studentpresence.GroupSupervision, error)
	groups func(context.Context, []int64) ([]studentpresence.LiveGroup, error)
}

func (s supervisionQueryStub) ListLiveGroups(ctx context.Context, ids []int64) ([]studentpresence.LiveGroup, error) {
	return s.groups(ctx, ids)
}

func (s supervisionQueryStub) QueryGroupSupervisions(ctx context.Context, filter studentpresence.GroupSupervisionFilter) ([]studentpresence.GroupSupervision, error) {
	return s.query(ctx, filter)
}

func TestSessionSupervisorsPreserveExistenceGate(t *testing.T) {
	t.Parallel()
	storageErr := errors.New("storage unavailable")
	today := calendar.NewDate(2026, time.January, 15)
	supervision := studentpresence.GroupSupervision{ID: 8, GroupID: 7, StaffID: 9, StartDate: today.String()}
	for _, tc := range []struct {
		name                              string
		found                             bool
		groupErr, supervisionErr, wantErr error
	}{
		{name: "missing", wantErr: studentpresence.ErrGroupNotFound},
		{name: "lookup failure", found: true, groupErr: storageErr, wantErr: studentpresence.ErrGroupNotFound},
		{name: "supervision failure", found: true, supervisionErr: storageErr, wantErr: studentpresence.ErrDatabaseOperation},
		{name: "found", found: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			queried := false
			rs := &Resource{runtime: RequestRuntime{Now: time.Now}, Presence: supervisionQueryStub{
				groups: func(got context.Context, ids []int64) ([]studentpresence.LiveGroup, error) {
					assert.Same(t, ctx, got)
					assert.Equal(t, []int64{7}, ids)
					if tc.found {
						return []studentpresence.LiveGroup{{ID: 7}}, tc.groupErr
					}
					return nil, tc.groupErr
				},
				query: func(got context.Context, filter studentpresence.GroupSupervisionFilter) ([]studentpresence.GroupSupervision, error) {
					queried = true
					assert.Same(t, ctx, got)
					day := today.String()
					assert.Equal(t, studentpresence.GroupSupervisionFilter{GroupIDs: []int64{7}, ActiveOn: &day}, filter)
					return []studentpresence.GroupSupervision{supervision}, tc.supervisionErr
				},
			}}
			rows, err := rs.presenceSessionSupervisors(ctx, 7, today)
			assert.Equal(t, tc.found && tc.groupErr == nil, queried)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, rows)
				return
			}
			require.NoError(t, err)
			require.Len(t, rows, 1)
			assert.Equal(t, supervision.ID, rows[0].ID)
			assert.Equal(t, supervision.StaffID, rows[0].StaffID)
		})
	}
}

func TestPresenceSupervisionResponseDateContract(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.January, 15, 12, 0, 0, 0, time.UTC)
	day := calendar.NewDate(2026, time.January, 15)
	today := day.String()
	yesterday := "2026-01-14"
	tomorrow := "2026-01-16"
	for _, tc := range []struct {
		name, start     string
		end             *string
		active, invalid bool
	}{
		{name: "open", start: yesterday, active: true},
		{name: "starts today", start: today, active: true},
		{name: "future", start: tomorrow},
		{name: "ends today", start: yesterday, end: &today},
		{name: "ends tomorrow", start: yesterday, end: &tomorrow, active: true},
		{name: "invalid start", start: "invalid", invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := studentpresence.GroupSupervision{ID: 7, StaffID: 8, GroupID: 9, StartDate: tc.start, EndDate: tc.end, CreatedAt: now, UpdatedAt: now}
			row, err := presenceSupervisionResponse(input, day)
			if tc.invalid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.active, row.IsActive)
			assert.Equal(t, tc.start+"T00:00:00Z", row.StartTime.Format(time.RFC3339))
			assert.Equal(t, input.ID, row.ID)
			assert.Equal(t, input.StaffID, row.StaffID)
			assert.Equal(t, input.GroupID, row.ActiveGroupID)
			assert.Equal(t, now, row.CreatedAt)
			assert.Equal(t, now, row.UpdatedAt)
			if tc.end == nil {
				assert.Nil(t, row.EndTime)
			} else {
				require.NotNil(t, row.EndTime)
				assert.Equal(t, *tc.end+"T00:00:00Z", row.EndTime.Format(time.RFC3339))
			}
		})
	}
}

func TestSupervisionReadsPreserveErrorEnvelopes(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		rows []studentpresence.GroupSupervision
		err  error
	}{
		{name: "missing"},
		{name: "partial query failure", rows: []studentpresence.GroupSupervision{{ID: 7, StartDate: "2026-01-01"}}, err: errors.New("database unavailable")},
		{name: "invalid stored date", rows: []studentpresence.GroupSupervision{{ID: 7, StartDate: "invalid"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			filter := studentpresence.GroupSupervisionFilter{IDs: []int64{7}}
			rs := resourceForTest(Resource{Presence: supervisionQueryStub{query: func(got context.Context, gotFilter studentpresence.GroupSupervisionFilter) ([]studentpresence.GroupSupervision, error) {
				assert.Same(t, ctx, got)
				assert.Equal(t, filter, gotFilter)
				return tc.rows, tc.err
			}}})
			row, err := rs.presenceSupervisor(ctx, 7)
			require.ErrorIs(t, err, studentpresence.ErrGroupSupervisorNotFound)
			assert.Equal(t, SupervisorResponse{}, row)
			rows, err := rs.presenceSupervisionResponses(ctx, filter, "ListGroupSupervisors")
			if len(tc.rows) == 0 && tc.err == nil {
				require.NoError(t, err)
				assert.Empty(t, rows)
			} else {
				require.ErrorIs(t, err, studentpresence.ErrDatabaseOperation)
				assert.Nil(t, rows)
			}
		})
	}
}

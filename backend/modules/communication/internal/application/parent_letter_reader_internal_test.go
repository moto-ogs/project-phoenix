package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/communication/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type mockLetterStudents struct {
	students func(context.Context, []int64) ([]ports.ParentLetterStudent, error)
	names    func(context.Context, []int64) ([]ports.ParentLetterStudentName, error)
}

func (s mockLetterStudents) ListStudentsByID(ctx context.Context, ids []int64) ([]ports.ParentLetterStudent, error) {
	return s.students(ctx, ids)
}

func (s mockLetterStudents) ListStudentNamesByID(ctx context.Context, ids []int64) ([]ports.ParentLetterStudentName, error) {
	return s.names(ctx, ids)
}

type mockLetterPickups func(context.Context, []int64, calendar.Date) ([]*ports.ParentLetterPickup, error)

func (s mockLetterPickups) GetWeeklySchedulesByStudentIDsForDate(ctx context.Context, ids []int64, date calendar.Date) ([]*ports.ParentLetterPickup, error) {
	return s(ctx, ids, date)
}

type mockLetterArrivals func(context.Context, []int64, calendar.Date) ([]*ports.ParentLetterArrival, error)

func (s mockLetterArrivals) GetWeeklySchedulesByStudentIDsForDate(ctx context.Context, ids []int64, date calendar.Date) ([]*ports.ParentLetterArrival, error) {
	return s(ctx, ids, date)
}

func TestParentLetterReaderJoinsTenantValuesInBatches(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	ids := []int64{101, 102, 999}
	groupID := int64(201)
	calls := map[string]int{}
	check := func(got context.Context, gotIDs []int64, source string) {
		require.Equal(t, ctx, got, "keep the caller's tenant transaction")
		require.Equal(t, ids, gotIDs, "read the whole child set at once")
		calls[source]++
	}
	sources := ports.ParentLetterSources{
		Students: mockLetterStudents{
			students: func(c context.Context, ids []int64) ([]ports.ParentLetterStudent, error) {
				check(c, ids, "students")
				return []ports.ParentLetterStudent{{ID: 101, SchoolClass: " 3a ", GroupID: &groupID}, {ID: 102}}, nil
			},
			names: func(c context.Context, ids []int64) ([]ports.ParentLetterStudentName, error) {
				check(c, ids, "names")
				return []ports.ParentLetterStudentName{{StudentID: 102, FirstName: "Ben"}, {StudentID: 101, FirstName: "Lina", LastName: "Muster"}}, nil
			},
		},
		Groups: func(c context.Context, ids []int64) (map[int64]string, error) {
			require.Equal(t, ctx, c)
			require.Equal(t, []int64{groupID}, ids)
			calls["groups"]++
			return map[int64]string{groupID: "Bären"}, nil
		},
		Pickups: mockLetterPickups(func(c context.Context, ids []int64, date calendar.Date) ([]*ports.ParentLetterPickup, error) {
			check(c, ids, "pickups")
			require.Equal(t, calendar.NewDate(2026, time.November, 16), date)
			pickup := letterPickup(1, 15, 30)
			pickup.StudentID = 101
			return []*ports.ParentLetterPickup{nil, pickup}, nil
		}),
		Arrivals: mockLetterArrivals(func(c context.Context, ids []int64, date calendar.Date) ([]*ports.ParentLetterArrival, error) {
			check(c, ids, "arrivals")
			require.Equal(t, calendar.NewDate(2026, time.November, 16), date)
			return []*ports.ParentLetterArrival{nil, {StudentID: 101, Weekday: 3}}, nil
		}),
	}
	reader := NewParentLetterChildren(sources, func() time.Time { return time.Date(2026, 11, 15, 23, 30, 0, 0, time.UTC) })
	children, err := reader.ParentLetterChildren(ctx, ids)
	require.NoError(t, err)
	require.Equal(t, []communication.ParentLetterChild{
		{StudentID: 101, FirstName: "Lina", LastName: "Muster", SchoolClass: "3a", Group: "Bären", CareDays: "Montag und Mittwoch", PickupTime: "15:30 Uhr"},
		{StudentID: 102, FirstName: "Ben"},
	}, children, "omit absent children and leave missing values empty")
	require.Equal(t, map[string]int{"students": 1, "names": 1, "groups": 1, "pickups": 1, "arrivals": 1}, calls)
	children, err = reader.ParentLetterChildren(ctx, nil)
	require.NoError(t, err)
	require.Empty(t, children)
	require.Equal(t, 5, len(calls))
	for _, count := range calls {
		require.Equal(t, 1, count, "an empty set needs no source reads")
	}
}

func TestParentLetterReaderPropagatesSourceErrors(t *testing.T) {
	t.Parallel()
	for _, source := range []string{"students", "names", "groups", "pickups", "arrivals"} {
		t.Run(source, func(t *testing.T) {
			t.Parallel()
			failure := errors.New("source unavailable")
			failAt := func(name string) error {
				if source == name {
					return failure
				}
				return nil
			}
			groupID := int64(201)
			sources := ports.ParentLetterSources{
				Students: mockLetterStudents{
					students: func(context.Context, []int64) ([]ports.ParentLetterStudent, error) {
						return []ports.ParentLetterStudent{{ID: 101, GroupID: &groupID}}, failAt("students")
					},
					names: func(context.Context, []int64) ([]ports.ParentLetterStudentName, error) {
						return nil, failAt("names")
					},
				},
				Groups: func(context.Context, []int64) (map[int64]string, error) {
					return nil, failAt("groups")
				},
				Pickups: mockLetterPickups(func(context.Context, []int64, calendar.Date) ([]*ports.ParentLetterPickup, error) {
					return nil, failAt("pickups")
				}),
				Arrivals: mockLetterArrivals(func(context.Context, []int64, calendar.Date) ([]*ports.ParentLetterArrival, error) {
					return nil, failAt("arrivals")
				}),
			}
			reader := NewParentLetterChildren(sources, func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) })
			children, err := reader.ParentLetterChildren(context.Background(), []int64{101})
			require.ErrorIs(t, err, failure)
			require.Nil(t, children, "do not publish partial letter values on a failed read")
		})
	}
}

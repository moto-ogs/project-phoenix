package compose_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/classday"
	"github.com/moto-ogs/project-phoenix/modules/classday/compose"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// handoverMonday is the school day of the handover tests: 9:00 on a Monday.
var handoverMonday = time.Date(2099, time.March, 2, 9, 0, 0, 0, calendar.Berlin)

// handoverRoster is the class of the day: both children have the Monday's
// offering, so both stay in the OGS unless the day says otherwise.
type handoverRoster struct{ students []int64 }

func (r handoverRoster) ClassRosterDay(context.Context, string, calendar.Date) (*compose.DayRoster, error) {
	roster := &compose.DayRoster{PhaseNames: []string{"Schuljahr"}}
	for _, id := range r.students {
		roster.Rows = append(roster.Rows, compose.DayRosterRow{StudentID: id, OfferingsByDay: map[string][]string{"mon": {"Lernzeit"}}})
	}
	return roster, nil
}

func (r handoverRoster) SchoolRosterDay(ctx context.Context, date calendar.Date) (*compose.DayRoster, error) {
	return r.ClassRosterDay(ctx, "", date)
}

// handoverDayFacts serves the status days and care days entered so far and
// no deviating times.
type handoverDayFacts struct {
	statuses []compose.StatusDayEntry
	careDays map[int64]careplan.CareDayStatus
}

func (f *handoverDayFacts) StandingStatusDays(context.Context, []int64, calendar.Date) ([]compose.StatusDayEntry, error) {
	return f.statuses, nil
}

func (f *handoverDayFacts) ResolveForDate(context.Context, []int64, calendar.Date) (map[int64]careplan.CareDayStatus, error) {
	return f.careDays, nil
}

func (*handoverDayFacts) GetBulkEffectivePickupTimesForDate(context.Context, []int64, calendar.Date) (map[int64]*careplan.EffectivePickupTime, error) {
	return nil, nil
}

func (*handoverDayFacts) GetBulkEffectiveArrivalTimesForDate(context.Context, []int64, calendar.Date) (map[int64]*careplan.EffectiveArrivalTime, error) {
	return nil, nil
}

func (*handoverDayFacts) GetBulkDayDepartureModesForDate(context.Context, []int64, calendar.Date) (map[int64]string, error) {
	return nil, nil
}

// A sick report, a cancelled or unbooked care day, or a morning absence
// entered after the Lehrkraft read the class view changes what the handover
// dialog lists: the child leaves it or is prefilled "nicht da". Her stale
// dialog, which still hands the child over "da", is refused and stores
// nothing; read again, the handover goes through (ADR 0311).
func TestClassHandoverRefusesADialogReadBeforeTheDayChanged(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	presence, err := presenceCompose.New(presenceCompose.Dependencies{DB: db, Observe: func(presenceCompose.Observation) {}})
	require.NoError(t, err)
	staff := testpkg.CreateTestStaff(t, db, "Lehr", "Kraft")
	changes := map[string]func(t *testing.T, svc classday.ClassDay, facts *handoverDayFacts, class string, child int64){
		"sick report": func(_ *testing.T, _ classday.ClassDay, facts *handoverDayFacts, _ string, child int64) {
			facts.statuses = append(facts.statuses, compose.StatusDayEntry{StudentID: child, Status: "sick"})
		},
		"care day cancelled": func(_ *testing.T, _ classday.ClassDay, facts *handoverDayFacts, _ string, child int64) {
			facts.careDays[child] = careplan.CareDayCancelled
		},
		"care day removed": func(_ *testing.T, _ classday.ClassDay, facts *handoverDayFacts, _ string, child int64) {
			facts.careDays[child] = careplan.CareDayNotScheduled
		},
		"morning absence": func(t *testing.T, svc classday.ClassDay, _ *handoverDayFacts, class string, child int64) {
			require.NoError(t, svc.RecordMorningAttendance(testpkg.Ctx(t), classday.MorningAttendanceWrite{
				SchoolClass: class, Date: "2099-03-02", RecordedBy: staff.ID,
				Marks: []classday.MorningAttendanceMark{{StudentID: child, Status: classday.MorningAttendanceAbsent}},
			}))
		},
	}
	i := 0
	for name, change := range changes {
		class := fmt.Sprintf("ho%d", i)
		i++
		t.Run(name, func(t *testing.T) {
			ctx := testpkg.Ctx(t)
			child := testpkg.CreateTestStudent(t, db, "Kim", "Kind", class).ID
			classmate := testpkg.CreateTestStudent(t, db, "Ben", "Kind", class).ID
			facts := &handoverDayFacts{careDays: map[int64]careplan.CareDayStatus{}}
			open := func(context.Context) (bool, error) { return true, nil }
			svc := compose.NewClassDay(compose.ClassDayDependencies{
				Caller: struct{ compose.CallerReader }{}, Rosters: handoverRoster{students: []int64{child, classmate}},
				StatusDays: facts, PickupTimes: facts, ArrivalTimes: facts, CareDays: facts,
				MorningAttendanceDependencies: compose.MorningAttendanceDependencies{
					Store: presence, Scope: open, Now: func() time.Time { return handoverMonday },
				},
				ClassHandoverDependencies: compose.ClassHandoverDependencies{Handovers: presence, HandoverScope: open},
			})
			read := func() string {
				report, err := svc.DayReport(ctx, class, "2099-03-02", classday.Actor{AccountID: 42, Roles: "lehrkraft"})
				require.NoError(t, err)
				require.True(t, report.CanHandOver)
				return report.HandoverVersion
			}
			handOver := func(version string, present ...int64) error {
				return svc.ChangeClassHandover(ctx, classday.ClassHandoverChange{
					SchoolClass: class, Date: "2099-03-02", HandedOverBy: staff.ID, PresentStudentIDs: present, ExpectedVersion: version,
				})
			}
			stored := func() []studentpresence.ClassHandover {
				var mine []studentpresence.ClassHandover
				handovers, err := presence.ClassHandoversOn(ctx, calendar.NewDate(2099, 3, 2))
				require.NoError(t, err)
				for _, handover := range handovers {
					if handover.SchoolClass == class {
						mine = append(mine, handover)
					}
				}
				return mine
			}

			stale := read()
			change(t, svc, facts, class, child)
			require.ErrorIs(t, handOver(stale, child, classmate), readstate.ErrChanged)
			assert.Empty(t, stored(), "the stale dialog stores nothing")

			current := read()
			assert.NotEqual(t, stale, current)
			require.NoError(t, handOver(current, classmate))
			assert.Len(t, stored(), 1)
		})
	}
}

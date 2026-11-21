package daychangesviewhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// activityWire is the part of an entry the Stundenplan source fills.
type activityWire struct {
	Kind     string     `json:"kind"`
	Section  string     `json:"section"`
	AllDay   bool       `json:"all_day"`
	StartsAt *time.Time `json:"starts_at"`
	EndsAt   *time.Time `json:"ends_at"`
	Activity *struct {
		Title string `json:"title"`
	} `json:"activity"`
	Room *struct {
		Name string `json:"name"`
	} `json:"room"`
	PreviousRoom *struct {
		Name string `json:"name"`
	} `json:"previous_room"`
	People []wirePerson `json:"people"`
	Link   *struct {
		Target string `json:"target"`
	} `json:"link"`
}

// activityLines renders the activity entries of an answer as
// "section kind title start-end @room <-previous names ->link".
func activityLines(t *testing.T, body string) []string {
	t.Helper()
	var envelope struct {
		Data struct {
			Entries []activityWire `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	lines := []string{}
	for _, entry := range envelope.Data.Entries {
		if entry.Activity == nil {
			continue
		}
		assert.False(t, entry.AllDay, "an activity has a time of day")
		require.NotNil(t, entry.StartsAt)
		require.NotNil(t, entry.EndsAt)
		line := fmt.Sprintf("%s %s %s %s-%s", entry.Section, entry.Kind, entry.Activity.Title,
			entry.StartsAt.In(calendar.Berlin).Format("15:04"), entry.EndsAt.In(calendar.Berlin).Format("15:04"))
		if entry.Room != nil {
			line += " @" + entry.Room.Name
		}
		if entry.PreviousRoom != nil {
			line += " <-" + entry.PreviousRoom.Name
		}
		for _, person := range entry.People {
			line += fmt.Sprintf(" %s/%s", person.Name, person.Role)
			if person.IsSelf {
				line += "(du)"
			}
		}
		if entry.Link != nil {
			line += " ->" + entry.Link.Target
		}
		lines = append(lines, line)
	}
	return lines
}

// TestDayChangesActivitySource is Seam 1 for the Stundenplan source (#7662):
// cancellation and reinstatement through the lifecycle, a block in another
// room than its series plans and a covered block, read through the route by
// the supervisor, a bystander, the lead, an account without the day plan and
// on the day before, beside a second school.
func TestDayChangesActivitySource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	suffix := time.Now().UnixNano()
	room := func(name string) int64 {
		return testpkg.CreateTestRoomNamed(t, db, fmt.Sprintf("%s-%d", name, suffix)).ID
	}
	werkraum, turnhalle, aula := room("Werkraum"), room("Turnhalle"), room("Aula")

	carer, carerAccount := testpkg.CreateTestTeacherWithAccount(t, db, "Anna", "Betreuung")
	_, bystanderAccount := testpkg.CreateTestStaffWithAccount(t, db, "Udo", "Unbeteiligt")
	_, leadAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")
	_, plainAccount := testpkg.CreateTestStaffWithAccount(t, db, "Zoe", "Ohne")
	absent := testpkg.CreateTestStaff(t, db, "Ben", "Krank")
	other := testpkg.CreateTestStaff(t, db, "Olga", "Andere")

	series := testpkg.CreateTestActivityGroup(t, db, fmt.Sprintf("Fussball-AG-%d", suffix))
	_, err := db.NewRaw("UPDATE activities.groups SET planned_room_id = ? WHERE id = ? AND tenant_id = ?", werkraum, series.ID, tenantID).Exec(context.Background())
	require.NoError(t, err)
	block := func(date calendar.Date, title, start, end string, roomID int64, seriesID *int64) int64 {
		return testpkg.CreateTestActivityInstance(t, db, date, roomID, testpkg.ActivityInstanceOpts{
			Title: title, StartHHMM: start, EndHHMM: end, ActivityGroupID: seriesID,
		}).ID
	}
	moved := block(day, "Fussball", "14:00", "15:00", turnhalle, &series.ID)
	testpkg.CreateTestInstanceStaff(t, db, moved, carer.StaffID, testpkg.InstanceStaffOpts{IsPrimary: true})
	covered := block(day, "Chor", "13:00", "14:00", aula, nil)
	testpkg.CreateTestInstanceStaff(t, db, covered, absent.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	testpkg.CreateTestInstanceStaff(t, db, covered, carer.StaffID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	asPlanned := block(day, "Lernzeit", "12:00", "13:00", werkraum, &series.ID)
	testpkg.CreateTestInstanceStaff(t, db, asPlanned, carer.StaffID, testpkg.InstanceStaffOpts{IsPrimary: true})
	cancelled := block(day, "Basteln", "15:00", "16:00", aula, nil)
	testpkg.CreateTestInstanceStaff(t, db, cancelled, other.ID, testpkg.InstanceStaffOpts{IsPrimary: true})
	reinstated := block(day, "Theater", "16:00", "17:00", aula, nil)
	testpkg.CreateTestInstanceStaff(t, db, reinstated, other.ID, testpkg.InstanceStaffOpts{IsPrimary: true})
	yesterday := block(day.AddDays(-1), "Werken", "15:00", "16:00", aula, nil)
	testpkg.CreateTestInstanceStaff(t, db, yesterday, other.ID, testpkg.InstanceStaffOpts{IsPrimary: true})

	// The lifecycle is the real write path; its clock stands at noon of the day.
	module, _ := api.NewActiveTestTimetable(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db),
		func() time.Time { return day.BerlinMidnight().Add(12 * time.Hour) })
	reason := "Grippe der Leitung"
	write := func(write func(context.Context) error) {
		require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(ctx context.Context, _ bun.Tx) error {
			return write(ctx)
		}))
	}
	for _, id := range []int64{cancelled, reinstated, yesterday} {
		write(func(ctx context.Context) error {
			_, err := module.Instance.Cancel(ctx, id, &reason, nil)
			return err
		})
	}
	write(func(ctx context.Context) error {
		_, err := module.Instance.Reinstate(ctx, reinstated, nil)
		return err
	})

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreignRoom := testpkg.CreateTestRoomNamed(t, db, fmt.Sprintf("Fremdraum-%d", suffix))
		testpkg.CreateTestActivityInstance(t, db, day, foreignRoom.ID, testpkg.ActivityInstanceOpts{
			Title: "Fremd", Status: testpkg.ScheduleInstanceStatusCancelled,
		})
	})

	router := newRouter(t, db, day)
	room2, room3 := "@Turnhalle", "@Aula"
	everyBlock := func(names string) []string {
		return []string{
			"school activity_lead_changed Chor 13:00-14:00 " + room3 + names + " ->day_plan",
			"school activity_room_changed Fussball 14:00-15:00 " + room2 + " <-Werkraum ->day_plan",
			"school activity_cancelled Basteln 15:00-16:00 " + room3 + " ->day_plan",
			"school activity_reinstated Theater 16:00-17:00 " + room3 + " ->day_plan",
		}
	}
	trim := func(lines []string) []string {
		// Room fixtures carry a unique suffix after the name.
		out := make([]string, 0, len(lines))
		for _, line := range lines {
			out = append(out, stripSuffix(line, suffix))
		}
		return out
	}

	t.Run("the supervisor finds its blocks under you, the rest under school", func(t *testing.T) {
		overview, body := read(t, router, carerAccount.ID, tenantID, "schedules:read")
		assert.Equal(t, "loaded", sourceStatus(overview, "activities"))
		assert.Equal(t, []string{
			"you activity_lead_changed Chor 13:00-14:00 " + room3 + " Anna Betreuung/substitute(du) Ben Krank/absent ->day_plan",
			"you activity_room_changed Fussball 14:00-15:00 " + room2 + " <-Werkraum ->day_plan",
			"school activity_cancelled Basteln 15:00-16:00 " + room3 + " ->day_plan",
			"school activity_reinstated Theater 16:00-17:00 " + room3 + " ->day_plan",
		}, trim(activityLines(t, body)))
		assert.NotContains(t, body, "Grippe", "no reason for the cancellation")
		assert.NotContains(t, body, "Lernzeit", "a block as planned is no change")
		assert.NotContains(t, body, "Fremd", "another school stays out")
	})

	t.Run("the lead sees every block under school", func(t *testing.T) {
		_, body := read(t, router, leadAccount.ID, tenantID, "admin:*")
		assert.Equal(t, everyBlock(" Anna Betreuung/substitute Ben Krank/absent"), trim(activityLines(t, body)))
	})

	t.Run("an account without the day plan gets no entries and no failure", func(t *testing.T) {
		overview, body := read(t, router, plainAccount.ID, tenantID, "users:read")
		assert.Empty(t, activityLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "activities"))
	})

	t.Run("the day before shows that day only", func(t *testing.T) {
		_, body := read(t, newRouter(t, db, day.AddDays(-1)), leadAccount.ID, tenantID, "admin:*")
		assert.Equal(t, []string{"school activity_cancelled Werken 15:00-16:00 " + room3 + " ->day_plan"}, trim(activityLines(t, body)))
	})

	t.Run("with the overview for the own blocks only, a bystander sees nothing", func(t *testing.T) {
		_, body := read(t, router, bystanderAccount.ID, tenantID, "schedules:read")
		assert.Equal(t, everyBlock(""), trim(activityLines(t, body)), "the school's default shows every block, names only to the lead")
		assert.NotContains(t, body, "Krank", "who misses a block of others stays unnamed")
		assert.NotContains(t, body, "Betreuung", "who covers a block of others stays unnamed")

		testpkg.SetTestTenantSetting(t, db, tenantID, "operations.operational_overview_scope", `"own"`)
		_, body = read(t, router, bystanderAccount.ID, tenantID, "schedules:read")
		assert.Empty(t, activityLines(t, body))
		_, body = read(t, router, carerAccount.ID, tenantID, "schedules:read")
		assert.Equal(t, []string{
			"you activity_lead_changed Chor 13:00-14:00 " + room3 + " Anna Betreuung/substitute(du) Ben Krank/absent ->day_plan",
			"you activity_room_changed Fussball 14:00-15:00 " + room2 + " <-Werkraum ->day_plan",
		}, trim(activityLines(t, body)))
	})
}

// stripSuffix drops the fixtures' unique suffix from the room names.
func stripSuffix(line string, suffix int64) string {
	return strings.ReplaceAll(line, fmt.Sprintf("-%d", suffix), "")
}

// TestDayChangesActivityQueryBudget proves the Stundenplan source reads
// set-based: the statement count does not grow with the changed blocks.
func TestDayChangesActivityQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	tenantID := testpkg.Tenant(t)
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Budget", "Leitung")
	planned := testpkg.CreateTestRoomNamed(t, db, "Budget-Werkraum")
	moved := testpkg.CreateTestRoomNamed(t, db, "Budget-Turnhalle")
	router := newRouter(t, db, day)
	counter := testpkg.CaptureQueries(t, db)
	var statements testpkg.QueryMeasurement
	baseline := 0
	for round, n := range []int{1, 4} {
		for created := baseline; created < n; created++ {
			series := testpkg.CreateTestActivityGroup(t, db, fmt.Sprintf("Budget-AG-%d", created))
			_, err := db.NewRaw("UPDATE activities.groups SET planned_room_id = ? WHERE id = ? AND tenant_id = ?", planned.ID, series.ID, tenantID).Exec(context.Background())
			require.NoError(t, err)
			block := testpkg.CreateTestActivityInstance(t, db, day, moved.ID, testpkg.ActivityInstanceOpts{ActivityGroupID: &series.ID})
			absent := testpkg.CreateTestStaff(t, db, "Budget", fmt.Sprintf("Fehlt-%d", created))
			cover := testpkg.CreateTestStaff(t, db, "Budget", fmt.Sprintf("Vertritt-%d", created))
			testpkg.CreateTestInstanceStaff(t, db, block.ID, absent.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
			testpkg.CreateTestInstanceStaff(t, db, block.ID, cover.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
		}
		baseline = n
		counter.Reset()
		_, body := read(t, router, account.ID, tenantID, "admin:*")
		require.Len(t, activityLines(t, body), 2*n, "a moved and a covered entry per block")
		measured := counter.Measurement(counter.Queries())
		if round > 0 {
			require.Len(t, measured.Statements, len(statements.Statements), "statements must not grow with the blocks")
		}
		statements = measured
	}
	querybudgets.AssertQueryBudget(t, "api.day_changes.today_activities", statements)
}

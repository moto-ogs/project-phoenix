package presenceprojectionhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestListStudents_PlannedActivities pins the offerings on the child cards of
// "Alle Kinder" (#8194): the slim list carries the listed day's planned, not
// cancelled offerings (AG and Extern, no Betreuung) by start, as "Gruppen"
// does (#6487). They follow the school's setting (off by default), need
// users:read, and cost the same statements for three children as for ten.
func TestListStudents_PlannedActivities(t *testing.T) {
	t.Parallel()
	testpkg.SetupIsolatedTestDB(t)
	tc := setupStudentsRoute(t, fixedCalendarClock)
	today := calendar.DateFromTime(fixedCalendarClock())

	booked := testpkg.CreateTestStudent(t, tc.db, "CardAct", "Gebucht", "CA1")
	free := testpkg.CreateTestStudent(t, tc.db, "CardAct", "Frei", "CA1")
	room := testpkg.CreateTestRoom(t, tc.db, "CardActRoom")
	offering := testpkg.CreateTestActivityGroup(t, tc.db, "CardActOffering")
	external := testpkg.CreateTestActivityGroup(t, tc.db, "CardActExternal")
	meal := testpkg.CreateTestActivityGroup(t, tc.db, "CardActMeal")
	for templateID, groupType := range map[int64]string{external.ID: "external", meal.ID: "care"} {
		_, err := tc.db.NewUpdate().Table("activities.groups").Set("type = ?", groupType).Where("id = ?", templateID).Exec(testpkg.Ctx(t))
		require.NoError(t, err)
	}
	block := func(templateID int64, date calendar.Date, title, start, end, status string, studentIDs ...int64) {
		instance := testpkg.CreateTestActivityInstance(t, tc.db, date, room.ID, testpkg.ActivityInstanceOpts{
			ActivityGroupID: &templateID, Title: title, StartHHMM: start, EndHHMM: end, Status: status,
		})
		for _, studentID := range studentIDs {
			testpkg.CreateTestInstanceStudent(t, tc.db, instance.ID, studentID, "")
		}
	}
	block(external.ID, today, "Handball", "15:15", "16:00", "", booked.ID)
	block(offering.ID, today, "Töpfer-AG", "14:00", "15:00", "", booked.ID)
	block(meal.ID, today, "Mittagessen", "12:00", "13:00", "", booked.ID)
	block(offering.ID, today, "Chor", "13:00", "14:00", testpkg.ScheduleInstanceStatusCancelled, booked.ID)
	block(offering.ID, today.AddDays(1), "Schach", "14:00", "15:00", "", booked.ID)

	// list returns each child's offerings and the request's statements.
	list := func(query string, perms []string) (map[string]any, int) {
		counter := testpkg.CaptureQueriesForContext(t, tc.db)
		req := testutil.NewRequest("GET", "/?view=slim&page_size=50"+query, nil)
		req = req.WithContext(counter.Context(req.Context()))
		rr := authExec(t, tc, req, testutil.AdminTestClaims(1), perms)
		require.Equal(t, http.StatusOK, rr.Code, "body: %s", rr.Body.String())
		var envelope struct {
			Data []map[string]any `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
		result := map[string]any{}
		for _, student := range envelope.Data {
			result[student["id"].(string)] = student["planned_activities"]
		}
		return result, counter.Total()
	}
	bookedID, freeID := strconv.FormatInt(booked.ID, 10), strconv.FormatInt(free.ID, 10)

	off, offStatements := list("", listStudentsPerms)
	require.Contains(t, off, bookedID)
	assert.Nil(t, off[bookedID], "off by default: the card stays as it was")

	ctx := testpkg.Ctx(t)
	require.NoError(t, tc.settings().SetValue(ctx, settings.KeyStudentCardActivitiesEnabled, true, nil, nil))
	t.Cleanup(func() { _ = tc.settings().ResetValue(ctx, settings.KeyStudentCardActivitiesEnabled, nil, nil) })

	on, small := list("", listStudentsPerms)
	assert.Equal(t, offStatements+3, small, "switched on, the page costs three set reads (participants, their blocks, block types)")
	assert.Equal(t, []any{
		map[string]any{"title": "Töpfer-AG", "start_time": "14:00", "end_time": "15:00"},
		map[string]any{"title": "Handball", "start_time": "15:15", "end_time": "16:00"},
	}, on[bookedID], "today's offerings by start, AG and Extern; the meal (Betreuung), the cancelled one and tomorrow's are left out")
	assert.Contains(t, on, freeID)
	assert.Nil(t, on[freeID], "a child without a booking carries no offerings")

	tomorrow, _ := list("&date="+today.AddDays(1).String(), listStudentsPerms)
	assert.Equal(t, []any{map[string]any{"title": "Schach", "start_time": "14:00", "end_time": "15:00"}},
		tomorrow[bookedID], "another planning date lists that day's offerings")

	redacted, _ := list("", []string{"students:read"})
	assert.Contains(t, redacted, bookedID)
	assert.Nil(t, redacted[bookedID], "without users:read the day plan stays off the card")

	for i := range 7 {
		more := testpkg.CreateTestStudent(t, tc.db, "CardAct", fmt.Sprintf("Kind%d", i), "CA1")
		block(offering.ID, today, fmt.Sprintf("AG %d", i), fmt.Sprintf("%02d:00", 16+i), fmt.Sprintf("%02d:45", 16+i), "", more.ID)
	}
	grown, large := list("", listStudentsPerms)
	assert.Len(t, grown, 9)
	assert.Equal(t, small, large, "the offerings are read set-based: no statement per child or per block")

}

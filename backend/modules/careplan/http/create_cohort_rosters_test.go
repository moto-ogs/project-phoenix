package careplanhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestCreateStudent_JoinsPlannedOccurrencesOfTargetedTemplates pins #8204: a
// child created with Klasse 3a and a Gruppe stands, in the same request, in
// the already planned occurrences from today on of every Regeltermin whose
// Klasse, Jahrgang or Gruppe target the child is in, as a child moving into
// 3a does (#6841). Past occurrences, other classes and Regeltermine of
// another school stay as they are.
func TestCreateStudent_JoinsPlannedOccurrencesOfTargetedTemplates(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t, fixedCalendarClock)
	follow, err := api.NewStudentTestCohortRosters(testpkg.NewDatabase(t, tc.db))
	require.NoError(t, err)
	tc.resource.FollowCohortChanges = follow
	recurrenceLock, err := api.NewTimetableHTTPTestRecurrenceLock(testpkg.NewDatabase(t, tc.db))
	require.NoError(t, err)
	tc.resource.LockTemplateRecurrence = recurrenceLock.LockRecurrenceWrites

	f := &cohortRosterFixture{tc: tc}
	f.periodID = testpkg.CreateTestCalendarPeriod(t, tc.db, "Schuljahr Neu", testpkg.Date(2026, time.August, 1), testpkg.Date(2027, time.July, 31)).ID
	f.roomID = testpkg.CreateTestRoom(t, tc.db, "Neu").ID
	group := testpkg.CreateTestEducationGroup(t, tc.db, fmt.Sprintf("Eulen-%d", time.Now().UnixNano()))
	classmate := testpkg.CreateTestStudent(t, tc.db, "Neu", "Schon da", "3a")

	class3a := f.targetedTemplate(t, "AG 3a", "klasse", "target_school_class", "3a")
	class3b := f.targetedTemplate(t, "AG 3b", "klasse", "target_school_class", "3b")
	grade3 := f.targetedTemplate(t, "AG Jahrgang 3", "jahrgang", "target_grade_level", 3)
	owls := f.targetedTemplate(t, "AG Eulen", "gruppe", "education_group_id", group.ID)

	past3a := f.occurrence(t, class3a, 21)
	testpkg.CreateTestInstanceStudent(t, tc.db, past3a, classmate.ID, "")
	today3a := f.occurrence(t, class3a, 24)
	next3a := f.occurrence(t, class3a, 25)
	testpkg.CreateTestInstanceStudent(t, tc.db, next3a, classmate.ID, "")
	next3b := f.occurrence(t, class3b, 25)
	nextGrade3 := f.occurrence(t, grade3, 25)
	nextOwls := f.occurrence(t, owls, 25)

	// Another school plans a 3a Regeltermin too.
	foreignTenant, _ := testpkg.CreateTestTenant(t, tc.db)
	foreignTemplate := testpkg.CreateTestActivityGroupForTenant(t, tc.db, foreignTenant, fmt.Sprintf("Fremde AG 3a-%d", time.Now().UnixNano()))
	ctx := testpkg.Ctx(t)
	_, err = tc.db.NewUpdate().TableExpr("activities.groups").Set("is_template = true").Where("id = ?", foreignTemplate.ID).Exec(ctx)
	require.NoError(t, err)
	_, err = tc.db.NewRaw(`INSERT INTO activities.group_targets (tenant_id, activity_group_id, target_group_type, target_school_class)
		VALUES (?, ?, 'klasse', '3a')`, foreignTenant, foreignTemplate.ID).Exec(ctx)
	require.NoError(t, err)
	foreignRoom := testpkg.CreateTestRoomForTenant(t, tc.db, foreignTenant, "Fremd")
	foreign3a := testpkg.CreateTestActivityInstanceForTenant(t, tc.db, foreignTenant, testpkg.Date(2026, time.August, 25), foreignRoom.ID,
		testpkg.ActivityInstanceOpts{ActivityGroupID: &foreignTemplate.ID}).ID

	req := testutil.NewAuthenticatedRequest(t, "POST", "/", map[string]any{
		"first_name": "Neu", "last_name": "Angelegt", "school_class": "3a", "group_id": fmt.Sprint(group.ID),
	})
	rr := authExec(t, tc, req, testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	var created createStudentResponse
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &created))
	childID := int64(created.Data.ID)

	assert.Equal(t, []int64{classmate.ID}, f.roster(t, past3a), "a past occurrence stays as it was")
	assert.Equal(t, []int64{childID}, f.roster(t, today3a), "the child stands in today's 3a occurrence")
	assert.ElementsMatch(t, []int64{classmate.ID, childID}, f.roster(t, next3a), "the child joins the future 3a occurrence")
	assert.Empty(t, f.roster(t, next3b), "another class stays without the child")
	assert.Equal(t, []int64{childID}, f.roster(t, nextGrade3), "the Jahrgang target follows the new child too")
	assert.Equal(t, []int64{childID}, f.roster(t, nextOwls), "the Gruppe target follows the new child too")
	assert.Empty(t, f.roster(t, foreign3a), "another school's 3a occurrence stays untouched")

	// A child of Klasse 4b without Gruppe reaches none of these targets.
	req = testutil.NewAuthenticatedRequest(t, "POST", "/", map[string]any{"first_name": "Neu", "last_name": "Andere Klasse", "school_class": "4b"})
	rr = authExec(t, tc, req, testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	assert.ElementsMatch(t, []int64{classmate.ID, childID}, f.roster(t, next3a))
	assert.Empty(t, f.roster(t, next3b))
	assert.Equal(t, []int64{childID}, f.roster(t, nextGrade3))
}

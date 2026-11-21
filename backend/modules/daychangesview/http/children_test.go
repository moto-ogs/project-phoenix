package daychangesviewhttp_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type wireChild struct {
	StudentID  string  `json:"student_id"`
	FirstName  string  `json:"first_name"`
	LastName   string  `json:"last_name"`
	Status     *string `json:"status"`
	PickupTime *string `json:"pickup_time"`
	Note       *string `json:"note"`
}

type wireChildEntry struct {
	Kind    string     `json:"kind"`
	Section string     `json:"section"`
	Child   *wireChild `json:"child"`
	Group   *struct {
		Name string `json:"name"`
	} `json:"group"`
	Link *struct {
		Target    string `json:"target"`
		StudentID string `json:"student_id"`
	} `json:"link"`
	ChildSummary *struct {
		SchoolClass string         `json:"school_class"`
		Counts      map[string]int `json:"counts"`
		Items       []struct {
			Kind  string    `json:"kind"`
			Child wireChild `json:"child"`
			Link  *struct {
				Target string `json:"target"`
			} `json:"link"`
		} `json:"items"`
	} `json:"child_summary"`
}

// childLines renders the child entries of a raw answer as
// "section kind name detail @group ->link" and the summaries as
// "school child_summary @group|class counts [rows]".
func childLines(t *testing.T, body string) []string {
	t.Helper()
	var envelope struct {
		Data struct {
			Entries []wireChildEntry `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	lines := []string{}
	for _, entry := range envelope.Data.Entries {
		switch {
		case entry.Child != nil:
			line := fmt.Sprintf("%s %s %s", entry.Section, entry.Kind, childText(*entry.Child))
			if entry.Group != nil {
				name, _, _ := strings.Cut(entry.Group.Name, "-")
				line += " @" + name
			}
			if entry.Link != nil && entry.Link.StudentID == entry.Child.StudentID {
				line += " ->" + entry.Link.Target
			}
			lines = append(lines, line)
		case entry.ChildSummary != nil:
			summary := entry.ChildSummary
			where := "class " + summary.SchoolClass
			if entry.Group != nil {
				name, _, _ := strings.Cut(entry.Group.Name, "-")
				where = "@" + name
			}
			rows := []string{}
			for _, item := range summary.Items {
				row := item.Kind + " " + childText(item.Child)
				if item.Link != nil {
					row += " ->" + item.Link.Target
				}
				rows = append(rows, row)
			}
			c := summary.Counts
			lines = append(lines, fmt.Sprintf("%s child_summary %s sick=%d excused=%d pickup=%d alone=%d note=%d [%s]",
				entry.Section, where, c["sick"], c["excused"], c["pickup_changed"], c["goes_alone"], c["pickup_note"], strings.Join(rows, "; ")))
		}
	}
	return lines
}

func childText(child wireChild) string {
	text := child.FirstName
	if child.Status != nil {
		text += " " + *child.Status
	}
	if child.PickupTime != nil {
		text += " " + *child.PickupTime
	}
	if child.Note != nil {
		text += " »" + *child.Note + "«"
	}
	return text
}

// TestDayChangesChildrenSource is Seam 1 for the Kinder source (#7665): one
// school with a group of the care staff, another group, a child without a
// group, a lead without a group, an account without users:read and a second
// school, read through the route against the test database.
func TestDayChangesChildrenSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)

	carer, carerAccount := testpkg.CreateTestTeacherWithAccount(t, db, "Anna", "Betreuung")
	igel := testpkg.CreateTestEducationGroup(t, db, "Igel")
	testpkg.CreateTestGroupTeacher(t, db, igel.ID, carer.ID)
	fuchs := testpkg.CreateTestEducationGroup(t, db, "Fuchs")
	child := func(first, class string, groupID int64) int64 {
		student := testpkg.CreateTestStudent(t, db, first, "Kind", class)
		if groupID != 0 {
			testpkg.AssignStudentToGroup(t, db, student.ID, groupID)
		}
		return student.ID
	}
	// The caller's group: one child per kind, and the noise around them.
	mia := child("Mia", "2a", igel.ID)
	testpkg.CreateTestStudentStatusDay(t, db, mia, day, "sick")
	testpkg.CreateTestPickupException(t, db, mia, day, carer.StaffID, "", "Arzttermin Mia")
	leo := child("Leo", "2a", igel.ID)
	testpkg.CreateTestPickupException(t, db, leo, day, carer.StaffID, "14:30", "Arzttermin Leo")
	ida := child("Ida", "2a", igel.ID)
	testpkg.CreateTestDepartureException(t, db, ida, day, carer.StaffID, "alone", "Grund Ida")
	tom := child("Tom", "2a", igel.ID)
	testpkg.CreateTestPickupNote(t, db, tom, day, carer.StaffID, "Oma holt ab")
	testpkg.CreateTestPickupScheduleWithNote(t, db, tom, int(day.Weekday()), carer.StaffID, "15:00", "Wochennotiz Tom")
	bus := child("Ben", "2a", igel.ID)
	testpkg.CreateTestDepartureException(t, db, bus, day, carer.StaffID, "bus", "")
	gestern := child("Emil", "2a", igel.ID)
	testpkg.CreateTestStudentStatusDay(t, db, gestern, day.AddDays(-1), "sick")
	// The rest of the school.
	for _, first := range []string{"Paul", "Pia"} {
		testpkg.CreateTestStudentStatusDay(t, db, child(first, "3b", fuchs.ID), day, "sick")
	}
	lou := child("Lou", "3b", fuchs.ID)
	testpkg.CreateTestDepartureException(t, db, lou, day, carer.StaffID, "alone", "")
	testpkg.CreateTestStudentStatusDay(t, db, child("Ole", "4c", 0), day, "excused")
	_, leadAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign := testpkg.CreateTestStudent(t, db, "Xaver", "Fremd", "2a")
		testpkg.CreateTestStudentStatusDay(t, db, foreign.ID, day, "sick")
	})

	router := newRouter(t, db, day)
	tenantID := testpkg.Tenant(t)
	fuchsSummary := "school child_summary @Fuchs sick=2 excused=0 pickup=0 alone=1 note=0 " +
		"[child_goes_alone Lou ->student; child_absent Paul sick ->student; child_absent Pia sick ->student]"
	classSummary := "school child_summary class 4c sick=0 excused=1 pickup=0 alone=0 note=0 [child_absent Ole excused ->student]"

	t.Run("care staff sees its group one by one and the rest summed up", func(t *testing.T) {
		overview, body := read(t, router, carerAccount.ID, tenantID, "users:read")
		assert.Equal(t, "loaded", sourceStatus(overview, "children"))
		assert.Equal(t, []string{
			"you child_absent Mia sick @Igel ->student",
			"you child_goes_alone Ida @Igel ->student",
			"you child_pickup_changed Leo 14:30 @Igel ->student",
			"you child_pickup_note Tom »Oma holt ab« @Igel ->student",
			classSummary,
			fuchsSummary,
		}, childLines(t, body))
		for _, leak := range []string{"Arzttermin", "Grund Ida", "Wochennotiz", "Emil", "Ben", "Xaver"} {
			assert.NotContains(t, body, leak)
		}
	})

	t.Run("lead without a group sees every child summed up", func(t *testing.T) {
		_, body := read(t, router, leadAccount.ID, tenantID, "users:read", "vacation:approve")
		assert.Equal(t, []string{
			classSummary,
			fuchsSummary,
			"school child_summary @Igel sick=1 excused=0 pickup=1 alone=1 note=1 " +
				"[child_goes_alone Ida ->student; child_pickup_changed Leo 14:30 ->student; child_absent Mia sick ->student; child_pickup_note Tom »Oma holt ab« ->student]",
		}, childLines(t, body))
		assert.NotContains(t, body, "Xaver", "another school stays out")
	})

	t.Run("without users:read the source shows nothing and stays loaded", func(t *testing.T) {
		overview, body := read(t, router, carerAccount.ID, tenantID)
		assert.Empty(t, childLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "children"))
	})

	t.Run("the day before shows that day only", func(t *testing.T) {
		_, body := read(t, newRouter(t, db, day.AddDays(-1)), carerAccount.ID, tenantID, "users:read")
		assert.Equal(t, []string{"you child_absent Emil sick @Igel ->student"}, childLines(t, body))
	})
}

// TestDayChangesChildrenQueryBudget proves the statement count of the
// answer with the Kinder source does not grow with the number of children.
func TestDayChangesChildrenQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	carer, account := testpkg.CreateTestTeacherWithAccount(t, db, "Budget", "Betreuung")
	own := testpkg.CreateTestEducationGroup(t, db, "Budget-Eigene")
	testpkg.CreateTestGroupTeacher(t, db, own.ID, carer.ID)
	router := newRouter(t, db, day)
	counter := testpkg.CaptureQueries(t, db)
	var statements testpkg.QueryMeasurement
	baseline := 0
	for round, n := range []int{1, 4} {
		for created := baseline; created < n; created++ {
			other := testpkg.CreateTestEducationGroup(t, db, fmt.Sprintf("Budget-%d", created))
			for _, groupID := range []int64{own.ID, other.ID} {
				student := testpkg.CreateTestStudent(t, db, "Budget", fmt.Sprintf("Kind-%d-%d", created, groupID), "1a")
				testpkg.AssignStudentToGroup(t, db, student.ID, groupID)
				testpkg.CreateTestStudentStatusDay(t, db, student.ID, day, "sick")
				testpkg.CreateTestPickupException(t, db, student.ID, day, carer.StaffID, "14:00", "")
				testpkg.CreateTestDepartureException(t, db, student.ID, day, carer.StaffID, "alone", "")
				testpkg.CreateTestPickupNote(t, db, student.ID, day, carer.StaffID, "Notiz")
			}
		}
		baseline = n
		counter.Reset()
		_, body := read(t, router, account.ID, testpkg.Tenant(t), "users:read")
		require.Len(t, childLines(t, body), 4*n+n)
		measured := counter.Measurement(counter.Queries())
		if round > 0 {
			require.Len(t, measured.Statements, len(statements.Statements), "statements must not grow with the children")
		}
		statements = measured
	}
	querybudgets.AssertQueryBudget(t, "api.day_changes.today.children", statements)
}

package daychangesviewhttp_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// classLines renders the class entries of a raw answer as
// "section kind class time n=children".
func classLines(t *testing.T, body string) []string {
	t.Helper()
	var envelope struct {
		Data struct {
			Entries []struct {
				Kind    string `json:"kind"`
				Section string `json:"section"`
				Class   *struct {
					Name     string  `json:"name"`
					Time     *string `json:"time"`
					Children int     `json:"children"`
				} `json:"class"`
			} `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	lines := []string{}
	for _, entry := range envelope.Data.Entries {
		if entry.Class == nil {
			continue
		}
		line := fmt.Sprintf("%s %s %s", entry.Section, entry.Kind, entry.Class.Name)
		if entry.Class.Time != nil {
			line += " " + *entry.Class.Time
		}
		if entry.Kind == "class_trip" {
			line += fmt.Sprintf(" n=%d", entry.Class.Children)
		}
		lines = append(lines, line)
	}
	return lines
}

// addClassDismissal writes a class-wide arrival exception through Timetable.
func addClassDismissal(t *testing.T, write api.DayChangesClassDismissal, class string, on calendar.Date, hhmm, reason string) {
	t.Helper()
	require.NoError(t, write(testpkg.Ctx(t), class, on, hhmm, reason))
}

// TestDayChangesClassSource is Seam 1 for the classes (#7681): a class trip
// over the day and a day outing of the Kinder source, a changed
// Unterrichtsschluss of the Stundenplan der Klassen, the staff of a class, an
// account without users:read and a second school, read through the route.
func TestDayChangesClassSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	arrivals, err := api.NewDayChangesClassDismissalForTests(testpkg.NewDatabase(t, db))
	require.NoError(t, err)

	carer, carerAccount := testpkg.CreateTestTeacherWithAccount(t, db, "Anna", "Betreuung")
	igel := testpkg.CreateTestEducationGroup(t, db, "Igel")
	testpkg.CreateTestGroupTeacher(t, db, igel.ID, carer.ID)
	fuchs := testpkg.CreateTestEducationGroup(t, db, "Fuchs")
	classStaff, classAccount := testpkg.CreateTestStaffWithAccount(t, db, "Klara", "Klasse")
	testpkg.CreateTestClassTeacher(t, db, classStaff.ID, "3a")
	testpkg.CreateTestClassTeacher(t, db, classStaff.ID, "2c")
	_, plainAccount := testpkg.CreateTestStaffWithAccount(t, db, "Zoe", "Ohne")

	for i, groupID := range []int64{igel.ID, fuchs.ID} {
		child := testpkg.CreateTestStudent(t, db, "Reise", fmt.Sprintf("Kind-%d", i), "3a")
		testpkg.AssignStudentToGroup(t, db, child.ID, groupID)
		testpkg.CreateTestStudentStatusDay(t, db, child.ID, day, "class_trip")
	}
	outing := testpkg.CreateTestStudent(t, db, "Zoo", "Kind", "4b")
	testpkg.AssignStudentToGroup(t, db, outing.ID, fuchs.ID)
	testpkg.CreateTestArrivalException(t, db, outing.ID, day, classStaff.ID, "13:00", "Ausflug: Tierpark")
	doctor := testpkg.CreateTestStudent(t, db, "Arzt", "Kind", "4b")
	testpkg.CreateTestArrivalException(t, db, doctor.ID, day, classStaff.ID, "14:00", "Arzttermin")
	addClassDismissal(t, arrivals, "2c", day, "11:30", "Lehrerkonferenz")
	addClassDismissal(t, arrivals, "3a", day.AddDays(1), "10:00", "Morgen")

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign, err := api.NewDayChangesClassDismissalForTests(testpkg.NewDatabase(t, db))
		require.NoError(t, err)
		addClassDismissal(t, foreign, "9x", day, "09:00", "Fremd")
		child := testpkg.CreateTestStudent(t, db, "Fremd", "Kind", "9y")
		testpkg.CreateTestStudentStatusDay(t, db, child.ID, day, "class_trip")
	})

	router := newRouter(t, db, day)

	t.Run("staff of the class sees its classes under Betrifft dich", func(t *testing.T) {
		overview, body := read(t, router, classAccount.ID, tenantID, "users:read")
		assert.Equal(t, []string{
			"you class_dismissal_changed 2c 11:30",
			"you class_trip 3a n=2",
			"school class_trip 4b 13:00 n=1",
		}, classLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "classes"))
		for _, leak := range []string{"Tierpark", "Lehrerkonferenz", "Arzttermin", "Reise", "Zoo", "9x", "9y", "Morgen", "10:00"} {
			assert.NotContains(t, body, leak, "no reason, child name, other day or other school")
		}
	})

	t.Run("care staff of a child on the trip sees the trip under Betrifft dich", func(t *testing.T) {
		_, body := read(t, router, carerAccount.ID, tenantID, "users:read")
		assert.Equal(t, []string{
			"you class_trip 3a n=2",
			"school class_dismissal_changed 2c 11:30",
			"school class_trip 4b 13:00 n=1",
		}, classLines(t, body))
	})

	t.Run("account without users:read sees no class and no failure", func(t *testing.T) {
		overview, body := read(t, router, plainAccount.ID, tenantID)
		assert.Empty(t, classLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "classes"))
		assert.Equal(t, "loaded", sourceStatus(overview, "children"))
	})
}

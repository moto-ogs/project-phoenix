package daychangesviewhttp_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestSchoolDayChangesSupervisions is Seam 1 of the Aufsichten source of
// moto schule (#8148): the Lehrkraft takes a block over, somebody takes her
// block over, a colleague misses her block, a block she is not on, a
// cancelled block and another day, read through the route; with and without
// supervision:own, by an account without a staff record, without
// class_day:read and beside a second school. No colleague's name, staff ID
// or reason reaches the answer.
func TestSchoolDayChangesSupervisions(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)

	teacher, teacherAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lena", "Lehrkraft")
	colleague := testpkg.CreateTestStaff(t, db, "Ben", "Kollege")
	cover := testpkg.CreateTestStaff(t, db, "Sara", "Springer")
	noStaffAccount := testpkg.CreateTestAccount(t, db, "schule-ohne-personal")

	block := func(title, start, end, status string, onDay int) int64 {
		room := testpkg.CreateTestRoom(t, db, "Raum "+title)
		return testpkg.CreateTestActivityInstance(t, db, day.AddDays(onDay), room.ID, testpkg.ActivityInstanceOpts{
			Title: title, StartHHMM: start, EndHHMM: end, Status: status,
		}).ID
	}
	staff := func(instanceID, staffID int64, opts testpkg.InstanceStaffOpts) {
		row := testpkg.CreateTestInstanceStaff(t, db, instanceID, staffID, opts)
		if opts.IsAbsent {
			_, err := db.NewRaw("UPDATE schedule.instance_staff SET absence_reason = ? WHERE id = ?", "Zahnarzt", row.ID).Exec(context.Background())
			require.NoError(t, err)
		}
	}
	// She takes over a colleague's block.
	hof := block("Pausenaufsicht Hof", "09:30", "09:50", "", 0)
	staff(hof, colleague.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	staff(hof, teacher.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	// Somebody takes over her block.
	mittag := block("Mittagsaufsicht", "12:00", "12:30", "", 0)
	staff(mittag, teacher.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	staff(mittag, cover.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	// A colleague misses her block without a cover: no Vertretung for her.
	lernzeit := block("Lernzeit", "13:00", "14:00", "", 0)
	staff(lernzeit, teacher.ID, testpkg.InstanceStaffOpts{IsPrimary: true})
	staff(lernzeit, colleague.ID, testpkg.InstanceStaffOpts{IsAbsent: true})
	// She is on a block a colleague's cover takes: no Vertretung for her.
	werken := block("Werken", "13:30", "14:00", "", 0)
	staff(werken, teacher.ID, testpkg.InstanceStaffOpts{IsPrimary: true})
	staff(werken, colleague.ID, testpkg.InstanceStaffOpts{IsAbsent: true})
	staff(werken, cover.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	// A cover on a block she is not on.
	chor := block("Chor", "14:00", "15:00", "", 0)
	staff(chor, colleague.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	staff(chor, cover.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	// A cancelled block and another day.
	abgesagt := block("Abgesagt", "15:00", "16:00", testpkg.ScheduleInstanceStatusCancelled, 0)
	staff(abgesagt, teacher.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	morgen := block("Morgen", "10:00", "11:00", "", 1)
	staff(morgen, teacher.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign := testpkg.CreateTestStaff(t, db, "Xaver", "Fremd")
		room := testpkg.CreateTestRoom(t, db, "Fremdraum")
		instance := testpkg.CreateTestActivityInstance(t, db, day, room.ID, testpkg.ActivityInstanceOpts{Title: "Fremde Aufsicht"})
		testpkg.CreateTestInstanceStaff(t, db, instance.ID, foreign.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	})

	router := newSchoolRouter(t, db, day)

	t.Run("the Lehrkraft sees the covers of her own Aufsichten, no name", func(t *testing.T) {
		overview, body := readSchool(t, router, teacherAccount.ID, tenantID, "class_day:read", "supervision:own")
		assert.Equal(t, "loaded", sourceStatus(overview, "supervisions"))
		assert.Equal(t, []string{
			"you block_substitution Pausenaufsicht Hof 09:30-09:50 /substitute(du) ->school_supervisions",
			"you block_substitution Mittagsaufsicht 12:00-12:30 /substitute /replaced(du) ->school_supervisions",
		}, activityLines(t, body))
		for _, leak := range []string{"Zahnarzt", "Ben", "Kollege", "Sara", "Springer", "Lernzeit", "Werken", "Chor", "Abgesagt", "Morgen", "Fremd"} {
			assert.NotContains(t, body, leak, "no colleague, reason, other block, other day or other school")
		}
		for _, id := range []int64{colleague.ID, cover.ID} {
			assert.NotContains(t, body, fmt.Sprintf(`"staff_id":"%d"`, id), "no staff ID of a colleague")
		}
	})

	t.Run("the next day shows that day's cover only", func(t *testing.T) {
		_, body := readSchool(t, newSchoolRouter(t, db, day.AddDays(1)), teacherAccount.ID, tenantID, "class_day:read", "supervision:own")
		assert.Equal(t, []string{"you block_substitution Morgen 10:00-11:00 /substitute(du) ->school_supervisions"}, activityLines(t, body))
	})

	t.Run("without supervision:own no entry and no failure", func(t *testing.T) {
		overview, body := readSchool(t, router, teacherAccount.ID, tenantID, "class_day:read")
		assert.Empty(t, activityLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "supervisions"))
	})

	t.Run("an account without a staff record has no Aufsichten", func(t *testing.T) {
		overview, body := readSchool(t, router, noStaffAccount.ID, tenantID, "class_day:read", "supervision:own")
		assert.Empty(t, activityLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "supervisions"))
	})

	t.Run("without class_day:read the route refuses", func(t *testing.T) {
		rec := getSchool(t, router, testutil.MintTestJWT(t, testpkg.SchoolTestClaims(int(teacherAccount.ID), tenantID, "supervision:own")))
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		assert.NotContains(t, rec.Body.String(), "Pausenaufsicht")
	})
}

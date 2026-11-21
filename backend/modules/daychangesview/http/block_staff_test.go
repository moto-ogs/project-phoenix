package daychangesviewhttp_test

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// blockLines keeps the Personal source's block entries (#7675) of an answer.
func blockLines(t *testing.T, body string) []string {
	t.Helper()
	lines := []string{}
	for _, line := range activityLines(t, body) {
		if strings.Contains(line, " block_") {
			lines = append(lines, line)
		}
	}
	return lines
}

// TestDayChangesBlockStaffSource is Seam 1 for the block part of the
// Personal source (#7675): absences and covers of single blocks, read through
// the route by care staff, its team, a bystander, the lead, an account
// without rights and on the day before, beside a second school.
func TestDayChangesBlockStaffSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)

	carer, carerAccount := testpkg.CreateTestTeacherWithAccount(t, db, "Anna", "Betreuung")
	igel := testpkg.CreateTestEducationGroup(t, db, "Igel")
	testpkg.CreateTestGroupTeacher(t, db, igel.ID, carer.ID)
	colleague := testpkg.CreateTestTeacher(t, db, "Ben", "Kollege")
	testpkg.CreateTestGroupTeacher(t, db, igel.ID, colleague.ID)
	_, bystanderAccount := testpkg.CreateTestStaffWithAccount(t, db, "Udo", "Unbeteiligt")
	_, leadAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")
	_, plainAccount := testpkg.CreateTestStaffWithAccount(t, db, "Zoe", "Ohne")
	cover := testpkg.CreateTestStaff(t, db, "Sara", "Springer")
	other := testpkg.CreateTestStaff(t, db, "Clara", "Andere")
	sick := testpkg.CreateTestStaff(t, db, "Kai", "Krank")
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, sick.ID, day, day, "Grippe Kai")

	block := func(date string, title, start, end string, status string) int64 {
		room := testpkg.CreateTestRoom(t, db, "Raum "+title)
		parsed := day
		if date == "yesterday" {
			parsed = day.AddDays(-1)
		}
		return testpkg.CreateTestActivityInstance(t, db, parsed, room.ID, testpkg.ActivityInstanceOpts{
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
	// A colleague of the group misses the choir; somebody else covers.
	chor := block("today", "Chor", "13:00", "14:00", "")
	staff(chor, colleague.StaffID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	staff(chor, cover.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	// The carer misses a block of its own; nobody covers.
	lernzeit := block("today", "Lernzeit", "14:00", "15:00", "")
	staff(lernzeit, carer.StaffID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	// Somebody outside the team misses a block the carer is planned on.
	werken := block("today", "Werken", "15:00", "16:00", "")
	staff(werken, other.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	staff(werken, carer.StaffID, testpkg.InstanceStaffOpts{})
	// Somebody outside the team misses a block nobody of the team is on.
	theater := block("today", "Theater", "16:00", "17:00", "")
	staff(theater, other.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	// The absence of the day is the entry, not each block it empties.
	staff(block("today", "Basteln", "10:00", "11:00", ""), sick.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	// A cancelled block is its cancellation, a block as planned no change.
	staff(block("today", "Abgesagt", "11:00", "12:00", testpkg.ScheduleInstanceStatusCancelled), other.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	staff(block("today", "Normal", "12:00", "13:00", ""), other.ID, testpkg.InstanceStaffOpts{IsPrimary: true})
	staff(block("yesterday", "Gestern", "15:00", "16:00", ""), other.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign := testpkg.CreateTestStaff(t, db, "Xaver", "Fremd")
		room := testpkg.CreateTestRoom(t, db, "Fremdraum")
		instance := testpkg.CreateTestActivityInstance(t, db, day, room.ID, testpkg.ActivityInstanceOpts{Title: "Fremd"})
		testpkg.CreateTestInstanceStaff(t, db, instance.ID, foreign.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	})

	router := newRouter(t, db, day)

	t.Run("care staff sees its own blocks and its team's by name", func(t *testing.T) {
		overview, body := read(t, router, carerAccount.ID, tenantID, "users:read")
		assert.Equal(t, "loaded", sourceStatus(overview, "staff"))
		assert.Equal(t, []string{
			"you block_substitution Chor 13:00-14:00 Sara Springer/substitute Ben Kollege/replaced",
			"you block_staff_absent Lernzeit 14:00-15:00 Anna Betreuung/absent(du)",
			"you block_staff_absent Werken 15:00-16:00 Clara Andere/absent",
		}, blockLines(t, body))
		assert.NotContains(t, body, "Theater", "a block outside the team has no entry and no number")
		assertNoBlockReason(t, body)
	})

	t.Run("the lead sees every block with the Vertretungsplan", func(t *testing.T) {
		_, body := read(t, router, leadAccount.ID, tenantID, "vacation:approve", "schedules:manage")
		assert.Equal(t, []string{
			"school block_substitution Chor 13:00-14:00 Sara Springer/substitute Ben Kollege/replaced ->substitution_plan",
			"school block_staff_absent Lernzeit 14:00-15:00 Anna Betreuung/absent ->substitution_plan",
			"school block_staff_absent Werken 15:00-16:00 Clara Andere/absent ->substitution_plan",
			"school block_staff_absent Theater 16:00-17:00 Clara Andere/absent ->substitution_plan",
		}, blockLines(t, body))
		assert.Contains(t, body, `"instance_id":"`, "the link names the block as a string id")
		for _, leak := range []string{"Basteln", "Abgesagt", "Normal", "Gestern", "Fremd"} {
			assert.NotContains(t, body, leak)
		}
		assertNoBlockReason(t, body)
	})

	t.Run("a bystander and an account without the rights get no block entries", func(t *testing.T) {
		overview, body := read(t, router, bystanderAccount.ID, tenantID, "users:read")
		assert.Empty(t, blockLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "staff"))
		overview, body = read(t, router, plainAccount.ID, tenantID)
		assert.Empty(t, blockLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "staff"))
	})

	t.Run("the day before shows that day only", func(t *testing.T) {
		_, body := read(t, newRouter(t, db, day.AddDays(-1)), leadAccount.ID, tenantID, "vacation:approve")
		assert.Equal(t, []string{"school block_staff_absent Gestern 15:00-16:00 Clara Andere/absent"}, blockLines(t, body))
	})

	t.Run("the Stundenplan's line of a covered block folds into the cover", func(t *testing.T) {
		_, body := read(t, router, carerAccount.ID, tenantID, "schedules:read")
		// Room fixtures carry a unique suffix after the name.
		lines := []string{}
		for _, line := range activityLines(t, body) {
			lines = append(lines, roomSuffix.ReplaceAllString(line, ""))
		}
		assert.Contains(t, lines, "you block_substitution Chor 13:00-14:00 @Raum Chor Sara Springer/substitute Ben Kollege/replaced ->day_plan")
		for _, line := range lines {
			assert.NotContains(t, line, "activity_lead_changed Chor", "one block, one line")
		}
		assert.Contains(t, lines, "school activity_lead_changed Theater 16:00-17:00 @Raum Theater ->day_plan",
			"outside the Personal rule the Stundenplan's unnamed line stays")
	})
}

var roomSuffix = regexp.MustCompile(`-\d{6,}`)

// assertNoBlockReason proves no block entry carries the absence reason.
func assertNoBlockReason(t *testing.T, body string) {
	t.Helper()
	for _, leak := range []string{"Zahnarzt", "absence_reason", "reason", "Grippe"} {
		assert.NotContains(t, body, leak)
	}
}

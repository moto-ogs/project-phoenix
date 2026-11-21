package daychangesviewhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// closingLines renders the closing day entries as "section name [traeger]
// [seit] [bis] ->link", in the order of the answer, and fails on a closing
// day in "Betrifft dich" or below another entry of "Schule".
func closingLines(t *testing.T, body string) []string {
	t.Helper()
	var envelope struct {
		Data struct {
			Entries []struct {
				Kind    string  `json:"kind"`
				Section string  `json:"section"`
				AllDay  bool    `json:"all_day"`
				Since   *string `json:"since"`
				Until   *string `json:"until"`
				Closing *struct {
					Name    string `json:"name"`
					Traeger bool   `json:"traeger"`
				} `json:"closing"`
				Link *struct {
					Target string `json:"target"`
				} `json:"link"`
			} `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	lines := []string{}
	otherSchoolEntry := false
	for _, entry := range envelope.Data.Entries {
		if entry.Kind != "closing_day" {
			otherSchoolEntry = otherSchoolEntry || entry.Section == "school"
			continue
		}
		require.NotNil(t, entry.Closing)
		assert.True(t, entry.AllDay)
		assert.False(t, otherSchoolEntry, "a closing day stands above every other entry of the school")
		line := entry.Section + " " + entry.Closing.Name
		if entry.Closing.Traeger {
			line += " traeger"
		}
		if entry.Since != nil {
			line += " seit " + *entry.Since
		}
		if entry.Until != nil {
			line += " bis " + *entry.Until
		}
		if entry.Link != nil {
			line += " ->" + entry.Link.Target
		}
		lines = append(lines, line)
	}
	return lines
}

func insertTraegerClosingDay(t *testing.T, db *testpkg.DB, organizationID int64, start, end, reason string, schoolIDs ...int64) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO schedule.traeger_closing_days (organization_id, start_date, end_date, reason, school_ids)
		VALUES (?, ?, ?, ?, ?::bigint[])`, organizationID, start, end, reason, fmt.Sprintf("{%s}", joinIDs(schoolIDs)))
	require.NoError(t, err)
}

func joinIDs(ids []int64) string {
	joined := ""
	for i, id := range ids {
		if i > 0 {
			joined += ","
		}
		joined += fmt.Sprint(id)
	}
	return joined
}

// TestDayChangesClosingDaySource is Seam 1 for the closing days (#7664): the
// school's own closing day through its write path, the Träger's closing days
// of the school, another Träger and another school, read through the route.
func TestDayChangesClosingDaySource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	// Every test school is its own Träger (EnsureTestTenant).
	testpkg.OwnTraegerClosingDays(t, db, tenantID)

	_, carerAccount := testpkg.CreateTestStaffWithAccount(t, db, "Anna", "Betreuung")
	_, leadAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")
	_, plainAccount := testpkg.CreateTestStaffWithAccount(t, db, "Zoe", "Ohne")
	absent := testpkg.CreateTestStaff(t, db, "Ben", "Krank")
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, absent.ID, day, day, "")
	// A carer who covers a group today belongs to its team: the covered group
	// comes from the day's Gruppenübergaben (#7664 reads no substitutions of
	// the caller of its own).
	fuchs := testpkg.CreateTestEducationGroup(t, db, "Fuchs")
	fuchsTeacher := testpkg.CreateTestTeacher(t, db, "Finn", "Fuchs")
	testpkg.CreateTestGroupTeacher(t, db, fuchs.ID, fuchsTeacher.ID)
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, fuchsTeacher.StaffID, day, day, "")
	cover, coverAccount := testpkg.CreateTestStaffWithAccount(t, db, "Cora", "Vertretung")
	testpkg.CreateTestGroupSubstitution(t, db, fuchs.ID, nil, cover.ID, day, day)

	// The school's closing day through School Calendar's write, as the
	// timetable route saves it (its change signal: closing_day_signal_test.go
	// in modules/timetable/http).
	require.NoError(t, testpkg.WithinTenantContext(t, testpkg.Ctx(t), db, tenantID, func(ctx context.Context) error {
		return api.CreateDayChangesTestClosingDay(ctx, testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day, day, day.AddDays(2), "Pädagogische Tage")
	}))
	testpkg.CreateTestClosingDay(t, db, day.AddDays(-1), day.AddDays(-1), "Gestern zu")

	insertTraegerClosingDay(t, db, tenantID, day.AddDays(-1).String(), day.String(), "Brückentag", tenantID)
	otherSchool := testpkg.CreateTestSchoolInOrganization(t, db, tenantID, "Andere Schule des Trägers")
	insertTraegerClosingDay(t, db, tenantID, day.String(), day.String(), "Nur die andere Schule", otherSchool)
	foreignTraeger := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Fremder Träger", Slug: fmt.Sprintf("fremder-traeger-%d", testpkg.UniqueTestTenantID(t)), Active: true,
	}).ID
	testpkg.OwnTraegerClosingDays(t, db, foreignTraeger)
	foreignSchool := testpkg.CreateTestSchoolInOrganization(t, db, foreignTraeger, "Schule des fremden Trägers")
	insertTraegerClosingDay(t, db, foreignTraeger, day.String(), day.String(), "Fremder Träger", foreignSchool)

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		testpkg.CreateTestClosingDay(t, db, day, day, "Fremde Schule zu")
	})

	router := newRouter(t, db, day)

	t.Run("lead sees the school's and the Träger's closing days first, with the link", func(t *testing.T) {
		overview, body := read(t, router, leadAccount.ID, tenantID, "vacation:approve", "schedules:manage")
		assert.Equal(t, "loaded", sourceStatus(overview, "closing_days"))
		assert.Equal(t, []string{
			"school Brückentag traeger seit 2026-09-08 ->calendar_periods",
			"school Pädagogische Tage bis 2026-09-11 ->calendar_periods",
		}, closingLines(t, body))
		assert.Contains(t, body, `"kind":"staff_absent"`, "the other entries of the school follow")
		for _, foreign := range []string{"Gestern zu", "Nur die andere Schule", "Fremder Träger", "Fremde Schule zu"} {
			assert.NotContains(t, body, foreign)
		}
	})

	t.Run("care staff that records time sees them without the planning page", func(t *testing.T) {
		overview, body := read(t, router, carerAccount.ID, tenantID, "time_tracking:own")
		assert.Equal(t, "loaded", sourceStatus(overview, "closing_days"))
		assert.Equal(t, []string{
			"school Brückentag traeger seit 2026-09-08",
			"school Pädagogische Tage bis 2026-09-11",
		}, closingLines(t, body))
	})

	t.Run("care staff covering a group today sees its team by name", func(t *testing.T) {
		overview, _ := read(t, router, coverAccount.ID, tenantID)
		assert.Equal(t, []string{
			"you group_substitution Cora Vertretung/substitute(du) @Fuchs ->group_handovers",
			"you staff_absent Finn Fuchs/absent",
		}, summary(overview.Entries))
	})

	t.Run("account without a read of the closing days gets none and no failure", func(t *testing.T) {
		overview, body := read(t, router, plainAccount.ID, tenantID)
		assert.Empty(t, closingLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "closing_days"))
	})

	t.Run("the day before shows that day's closing days only", func(t *testing.T) {
		_, body := read(t, newRouter(t, db, day.AddDays(-1)), leadAccount.ID, tenantID, "schedules:read")
		assert.Equal(t, []string{
			"school Gestern zu",
			"school Brückentag traeger bis 2026-09-09",
		}, closingLines(t, body))
	})
}

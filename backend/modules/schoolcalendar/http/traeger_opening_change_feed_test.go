package staffcalendarhttp_test

// Die geänderte Öffnungszeit des Trägers im Benachrichtigungs-Feed (#8231),
// von außen geprüft: das Träger-Büro trägt sie über seine Route für mehrere
// Schulen ein, und jede genannte Schule bekommt den Hinweis eines eigenen
// Eintrags unter ihrem eigenen Schalter.

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	calendarAPI "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestTraegerOpeningChangeFeedReachesEachNamedSchoolUnderItsOwnSwitch(t *testing.T) {
	t.Parallel()
	// The fixture's school is the one with families; its Träger plans for it,
	// for a second school with the type switched off and leaves a third out.
	school := testpkg.Tenant(t)
	f := newOpeningFeedFixture(t, school)
	db := f.db
	var traeger int64
	require.NoError(t, db.QueryRowContext(context.Background(), `SELECT organization_id FROM platform.schools WHERE id = ?`, school).Scan(&traeger))
	testpkg.OwnTraegerOpeningChanges(t, db, traeger)
	// Full test schools, so their staff hold the roles the feed reads.
	schoolOfTraeger := func() int64 {
		id := testpkg.NewTenantScope(t, db).TenantID
		_, err := db.ExecContext(context.Background(), `UPDATE platform.schools SET organization_id = ? WHERE id = ?`, traeger, id)
		require.NoError(t, err)
		return id
	}
	quietSchool, unnamed := schoolOfTraeger(), schoolOfTraeger()
	for _, id := range []int64{quietSchool, unnamed} {
		testpkg.SetTestTenantSetting(t, db, id, "notifications.dispatch_enabled", `true`)
		testpkg.SetTestTenantSetting(t, db, id, "notifications.active_window_start", `"06:00"`)
		testpkg.SetTestTenantSetting(t, db, id, "notifications.active_window_end", `"06:00"`)
	}
	testpkg.SetTestTenantSetting(t, db, quietSchool, "notifications.opening_change_enabled", "false")
	staffAt := func(tenantID int64, name string) int64 {
		_, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, tenantID, name, "Träger-Öffnung")
		testpkg.MapAccountToTenant(t, db, account.ID, tenantID)
		testpkg.GrantTestPermission(t, db, tenantID, account.ID, "activities:read")
		return account.ID
	}
	staff := f.staff(t, "Betreuung", true)
	quietStaff, unnamedStaff := staffAt(quietSchool, "Ruhig"), staffAt(unnamed, "Ungenannt")
	family := testpkg.CreateTestParentGuardianChain(t, db)
	f.device(t, family.AccountID, "parent")
	planner, office := testpkg.CreateTestAccount(t, db, "traeger-opening-planner"), testpkg.CreateTestAccount(t, db, "traeger-opening-office")
	testpkg.CreateTestTraegerMember(t, db, traeger, planner.ID, identityaccess.TraegerRoleAdministration)
	testpkg.CreateTestTraegerMember(t, db, traeger, office.ID, identityaccess.TraegerRoleReadOnly)

	resource := calendarAPI.NewTraegerOpeningChangeResource(
		rootAPI.NewTraegerOpeningChangesWithNotices(traegerDirectorySchools{db: db}, f.notifications, func() string { return openingFeedToday }),
		requireTraegerRight(identityaccess.TraegerRightOverviewRead), requireTraegerRight(identityaccess.TraegerRightSettingsManage), nil)
	router := chi.NewRouter()
	router.Mount("/traeger/opening-changes", resource.TraegerRouter(rootAPI.ProtectedTraegerRoutes))
	routes := traegerOpeningFixture{db: db, router: router, account: int(planner.ID)}
	claims := routes.office(traeger, identityaccess.TraegerRoleAdministration)
	day := func(closes string) map[string]any {
		return map[string]any{"start_date": "2030-06-12", "end_date": "2030-06-12", "opens_at": "07:30", "closes_at": closes,
			"reason": "Personalversammlung", "school_ids": []string{fmt.Sprint(school), fmt.Sprint(quietSchool)}}
	}

	rec := routes.send(t, claims, http.MethodPost, traegerOpeningChangesPath, day("12:00"))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	created := decodeOpeningChangeData[traegerOpeningChangeBody](t, rec)

	const body = "Am 12.06.2030 ist von 07:30 bis 12:00 Uhr geöffnet: Personalversammlung. Das hat der Träger eingetragen."
	entries := f.entries(t, staff, school, "staff")
	require.Len(t, entries, 1, "the staff of a named school read it")
	assert.Equal(t, deliveryContract.NotificationOpeningChangeChanged, entries[0].Type)
	assert.Equal(t, "Geänderte Öffnungszeit", entries[0].Title)
	assert.Equal(t, body, entries[0].Body)
	parent := f.entries(t, family.AccountID, 0, "parent")
	require.Len(t, parent, 1, "the families of a named school read it")
	assert.Equal(t, body, parent[0].Body)
	assert.Equal(t, "/parents/calendar?date=2030-06-12", parent[0].DeepLink)
	bell := f.entries(t, office.ID, traeger, "traeger")
	require.Len(t, bell, 1, "the Träger-Büro reads it once, for the school whose switch is on")
	assert.Equal(t, fmt.Sprintf("/traeger/schulen/%d", school), bell[0].DeepLink)
	assert.Equal(t, 1, f.pushes(t, staff), "a day within 14 days pushes")
	assert.Equal(t, 1, f.pushes(t, family.AccountID))

	assert.Empty(t, f.entries(t, quietStaff, quietSchool, "staff"), "a school that switched the type off gets nothing")
	assert.Empty(t, f.entries(t, unnamedStaff, unnamed, "staff"), "a school the Träger did not name gets nothing")
	assert.Empty(t, f.entries(t, unnamedStaff, school, "staff"), "nor do its staff see the named school's feed")
	assert.Empty(t, f.entries(t, planner.ID, traeger, "traeger"), "who entered it gets nothing in the bell")

	// Read, so the next notice adds an entry instead of updating this one.
	f.markRead(t, staff, int64(entries[0].ID))

	// Another closing time, and the second school leaves the change: the
	// school that stays reads the change, the one that left it reads nothing
	// under its switch.
	update := day("13:00")
	update["school_ids"] = []string{fmt.Sprint(school)}
	update["expected_version"] = created.Version
	rec = routes.send(t, claims, http.MethodPut, traegerOpeningChangesPath+created.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	updated := decodeOpeningChangeData[traegerOpeningChangeBody](t, rec)
	entries = f.entries(t, staff, school, "staff")
	require.Len(t, entries, 2)
	assert.Equal(t, "Öffnungszeit geändert", entries[0].Title)
	assert.Equal(t, "Die geänderte Öffnungszeit „Personalversammlung“ gilt jetzt am 12.06.2030 von 07:30 bis 13:00 Uhr. Bisher: am 12.06.2030 von 07:30 bis 12:00 Uhr. Das hat der Träger eingetragen.", entries[0].Body)
	assert.Empty(t, f.entries(t, quietStaff, quietSchool, "staff"))

	// A school added later reads it as new.
	update["school_ids"] = []string{fmt.Sprint(school), fmt.Sprint(unnamed)}
	update["expected_version"] = updated.Version
	rec = routes.send(t, claims, http.MethodPut, traegerOpeningChangesPath+created.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	added := f.entries(t, unnamedStaff, unnamed, "staff")
	require.Len(t, added, 1)
	assert.Equal(t, "Geänderte Öffnungszeit", added[0].Title)
	assert.Len(t, f.entries(t, staff, school, "staff"), 2, "the same days and times tell the school that stays nothing")

	// Deleted: every named school reads that it no longer applies.
	rec = routes.send(t, claims, http.MethodDelete, traegerOpeningChangesPath+created.ID, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "Geänderte Öffnungszeit entfällt", f.entries(t, staff, school, "staff")[0].Title)
	assert.Equal(t, "Geänderte Öffnungszeit entfällt", f.entries(t, unnamedStaff, unnamed, "staff")[0].Title)
	assert.Empty(t, f.entries(t, quietStaff, quietSchool, "staff"), "the switched-off school never hears of it")
	assert.Empty(t, f.entries(t, planner.ID, traeger, "traeger"))
}

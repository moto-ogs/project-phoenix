package staffcalendarhttp_test

// Die geänderte Öffnungszeit des Trägers im Benachrichtigungs-Feed (#8231),
// von außen geprüft: das Träger-Büro trägt sie über seine Route für mehrere
// Schulen ein, und jede genannte Schule bekommt den Hinweis eines eigenen
// Eintrags unter ihrem eigenen Schalter.

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	calendarAPI "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	"github.com/moto-ogs/project-phoenix/tenant"
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
	quietSchool, removedSchool, unnamed := schoolOfTraeger(), schoolOfTraeger(), schoolOfTraeger()
	for _, id := range []int64{quietSchool, removedSchool, unnamed} {
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
	quietStaff, removedStaff, unnamedStaff := staffAt(quietSchool, "Ruhig"), staffAt(removedSchool, "Entfernt"), staffAt(unnamed, "Ungenannt")
	family := testpkg.CreateTestParentGuardianChain(t, db)
	f.device(t, family.AccountID, "parent")
	planner, office := testpkg.CreateTestAccount(t, db, "traeger-opening-planner"), testpkg.CreateTestAccount(t, db, "traeger-opening-office")
	testpkg.CreateTestTraegerMember(t, db, traeger, planner.ID, identityaccess.TraegerRoleAdministration)
	testpkg.CreateTestTraegerMember(t, db, traeger, office.ID, identityaccess.TraegerRoleReadOnly)

	resource := calendarAPI.NewTraegerOpeningChangeResource(
		rootAPI.NewTraegerOpeningChangesWithNotices(traegerDirectorySchools{db: db}, f.notifications, nil, func() string { return openingFeedToday }),
		requireTraegerRight(identityaccess.TraegerRightOverviewRead), requireTraegerRight(identityaccess.TraegerRightSettingsManage), nil)
	router := chi.NewRouter()
	router.Mount("/traeger/opening-changes", resource.TraegerRouter(rootAPI.TraegerOpeningChangeRoutes))
	routes := traegerOpeningFixture{db: db, router: router, account: int(planner.ID)}
	claims := routes.office(traeger, identityaccess.TraegerRoleAdministration)
	day := func(closes string) map[string]any {
		return map[string]any{"start_date": "2030-06-12", "end_date": "2030-06-12", "opens_at": "07:30", "closes_at": closes,
			"reason": "Personalversammlung", "school_ids": []string{fmt.Sprint(school), fmt.Sprint(quietSchool), fmt.Sprint(removedSchool)}}
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
	require.Len(t, bell, 2, "the Träger-Büro reads it once for each school whose switch is on")
	assert.Contains(t, []string{bell[0].DeepLink, bell[1].DeepLink}, fmt.Sprintf("/traeger/schulen/%d", school))
	assert.Equal(t, 1, f.pushes(t, staff), "a day within 14 days pushes")
	assert.Equal(t, 1, f.pushes(t, family.AccountID))

	assert.Empty(t, f.entries(t, quietStaff, quietSchool, "staff"), "a school that switched the type off gets nothing")
	require.Len(t, f.entries(t, removedStaff, removedSchool, "staff"), 1, "a named school reads the original change")
	assert.Empty(t, f.entries(t, unnamedStaff, unnamed, "staff"), "a school the Träger did not name gets nothing")
	assert.Empty(t, f.entries(t, unnamedStaff, school, "staff"), "nor do its staff see the named school's feed")
	assert.Empty(t, f.entries(t, planner.ID, traeger, "traeger"), "who entered it gets nothing in the bell")

	// Read, so the next notice adds an entry instead of updating this one.
	f.markRead(t, staff, int64(entries[0].ID))

	// Another closing time and reason, and two schools leave the change: the
	// school that stays reads the update; the switched-off school remains quiet;
	// the other removed school sees the name it had before the removal.
	update := day("13:00")
	update["school_ids"] = []string{fmt.Sprint(school)}
	update["reason"] = "Fortbildung"
	update["expected_version"] = created.Version
	rec = routes.send(t, claims, http.MethodPut, traegerOpeningChangesPath+created.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	updated := decodeOpeningChangeData[traegerOpeningChangeBody](t, rec)
	entries = f.entries(t, staff, school, "staff")
	require.Len(t, entries, 2)
	assert.Equal(t, "Öffnungszeit geändert", entries[0].Title)
	assert.Equal(t, "Die geänderte Öffnungszeit „Fortbildung“ gilt jetzt am 12.06.2030 von 07:30 bis 13:00 Uhr. Bisher: am 12.06.2030 von 07:30 bis 12:00 Uhr. Das hat der Träger eingetragen.", entries[0].Body)
	assert.Empty(t, f.entries(t, quietStaff, quietSchool, "staff"))
	removed := f.entries(t, removedStaff, removedSchool, "staff")
	require.Len(t, removed, 1)
	assert.Equal(t, "Die geänderte Öffnungszeit „Personalversammlung“ am 12.06.2030 entfällt. Es gelten wieder die normalen Öffnungszeiten. Das hat der Träger eingetragen.", removed[0].Body)

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

func TestTraegerOpeningChangeThatDoesNotCommitRetractsTheSchoolNotices(t *testing.T) {
	t.Parallel()
	school := testpkg.Tenant(t)
	f := newOpeningFeedFixture(t, school)
	db := f.db
	var traeger int64
	require.NoError(t, db.QueryRowContext(context.Background(), `SELECT organization_id FROM platform.schools WHERE id = ?`, school).Scan(&traeger))
	testpkg.OwnTraegerOpeningChanges(t, db, traeger)
	staff := f.staff(t, "Rücknahme", true)
	family := testpkg.CreateTestParentGuardianChain(t, db)
	f.device(t, family.AccountID, "parent")
	planner, office := testpkg.CreateTestAccount(t, db, "traeger-retract-planner"), testpkg.CreateTestAccount(t, db, "traeger-retract-office")
	testpkg.CreateTestTraegerMember(t, db, traeger, planner.ID, identityaccess.TraegerRoleAdministration)
	testpkg.CreateTestTraegerMember(t, db, traeger, office.ID, identityaccess.TraegerRoleReadOnly)

	// failCommit lets the Träger transaction end without a commit after the
	// handler has told the schools, as a failed commit does.
	failCommit := false
	routes := func(r chi.Router, fn func(chi.Router, func(http.Handler) http.Handler)) {
		rootAPI.TraegerOpeningChangeRoutes(r, func(r chi.Router, withTx func(http.Handler) http.Handler) {
			fn(r, func(next http.Handler) http.Handler {
				return withTx(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					next.ServeHTTP(w, r)
					if failCommit {
						tenant.MarkRollback(r.Context())
					}
				}))
			})
		})
	}
	resource := calendarAPI.NewTraegerOpeningChangeResource(
		rootAPI.NewTraegerOpeningChangesWithNotices(traegerDirectorySchools{db: db}, f.notifications, nil, func() string { return openingFeedToday }),
		requireTraegerRight(identityaccess.TraegerRightOverviewRead), requireTraegerRight(identityaccess.TraegerRightSettingsManage), nil)
	router := chi.NewRouter()
	router.Mount("/traeger/opening-changes", resource.TraegerRouter(routes))
	fixture := traegerOpeningFixture{db: db, router: router, account: int(planner.ID)}
	claims := fixture.office(traeger, identityaccess.TraegerRoleAdministration)
	day := func(date, reason string) map[string]any {
		return map[string]any{"start_date": date, "end_date": date, "opens_at": "07:30", "closes_at": "12:00",
			"reason": reason, "school_ids": []string{fmt.Sprint(school)}}
	}

	// A change that commits is told and stays told.
	rec := fixture.send(t, claims, http.MethodPost, traegerOpeningChangesPath, day("2030-06-12", "Personalversammlung"))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	kept := decodeOpeningChangeData[traegerOpeningChangeBody](t, rec)
	require.Len(t, f.entries(t, staff, school, "staff"), 1)
	f.markRead(t, staff, int64(f.entries(t, staff, school, "staff")[0].ID))
	parentBefore, bellBefore := len(f.entries(t, family.AccountID, 0, "parent")), len(f.entries(t, office.ID, traeger, "traeger"))

	// A new change whose Träger transaction does not commit: the school
	// notices committed already and are retracted.
	failCommit = true
	fixture.send(t, claims, http.MethodPost, traegerOpeningChangesPath, day("2030-06-13", "Fortbildung"))
	failCommit = false
	rec = fixture.send(t, claims, http.MethodGet, traegerOpeningChangesPath+"?from=2030-06-01&to=2030-06-30", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	stored := decodeOpeningChangeData[[]traegerOpeningChangeBody](t, rec)
	require.Len(t, stored, 1, "the change that did not commit does not exist")
	assert.Equal(t, kept.ID, stored[0].ID)

	const retracted = "Die geänderte Öffnungszeit „Fortbildung“ am 13.06.2030 entfällt. Es gelten wieder die normalen Öffnungszeiten. Das hat der Träger eingetragen."
	readers := map[string][]openingFeedEntry{
		"staff":  f.entries(t, staff, school, "staff"),
		"parent": f.entries(t, family.AccountID, 0, "parent"),
		"bell":   f.entries(t, office.ID, traeger, "traeger"),
	}
	for reader, entries := range readers {
		for _, entry := range entries {
			assert.NotContains(t, entry.Body, "gilt", "%s: no notice tells the change that does not exist as standing", reader)
			if strings.Contains(entry.Body, "Fortbildung") {
				assert.Equal(t, "Geänderte Öffnungszeit entfällt", entry.Title, reader)
				assert.Equal(t, retracted, entry.Body, reader)
			}
		}
	}
	staffEntries := readers["staff"]
	require.Len(t, staffEntries, 2, "the read notice of the kept change stays; the retraction updates the unread notice")
	assert.Equal(t, retracted, staffEntries[0].Body)
	assert.Equal(t, "Am 12.06.2030 ist von 07:30 bis 12:00 Uhr geöffnet: Personalversammlung. Das hat der Träger eingetragen.", staffEntries[1].Body,
		"the retraction touches only the notices of its own change")
	assert.Len(t, readers["parent"], parentBefore+1, "the unread notice of the family reads the retraction instead")
	assert.Len(t, readers["bell"], bellBefore+1, "so does the bell of the Träger-Büro")

	// A later write commits as before.
	rec = fixture.send(t, claims, http.MethodPost, traegerOpeningChangesPath, day("2030-06-14", "Ausflug"))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.Equal(t, "Geänderte Öffnungszeit", f.entries(t, staff, school, "staff")[0].Title)
}

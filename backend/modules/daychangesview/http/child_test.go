package daychangesviewhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// childDayWire is the parents' answer of GET /parent/me/children/{id}/day-changes.
type childDayWire struct {
	Date    string `json:"date"`
	Sources []struct {
		Source string `json:"source"`
		Status string `json:"status"`
	} `json:"sources"`
	Entries []struct {
		Kind             string     `json:"kind"`
		AllDay           bool       `json:"all_day"`
		StartsAt         *time.Time `json:"starts_at"`
		EnteredByYou     bool       `json:"entered_by_you"`
		ChildStatus      *string    `json:"child_status"`
		PickupTime       *string    `json:"pickup_time"`
		ActivityTitle    *string    `json:"activity_title"`
		RoomName         *string    `json:"room_name"`
		PreviousRoomName *string    `json:"previous_room_name"`
		ClosingName      *string    `json:"closing_name"`
		ClassName        *string    `json:"class_name"`
		ClassTime        *string    `json:"class_time"`
	} `json:"entries"`
}

// lines renders the entries as "kind detail [du]" in the order of the answer.
func (w childDayWire) lines(suffix int64) []string {
	out := []string{}
	value := func(s *string) string {
		if s == nil {
			return "-"
		}
		return strings.ReplaceAll(*s, fmt.Sprintf("-%d", suffix), "")
	}
	for _, entry := range w.Entries {
		line := entry.Kind
		switch {
		case entry.ChildStatus != nil:
			line += " " + *entry.ChildStatus
		case entry.Kind == "child_pickup_changed":
			line += " " + value(entry.PickupTime)
		case entry.ActivityTitle != nil:
			line += fmt.Sprintf(" %s %s @%s <-%s", value(entry.ActivityTitle), entry.StartsAt.In(calendar.Berlin).Format("15:04"), value(entry.RoomName), value(entry.PreviousRoomName))
		case entry.ClosingName != nil:
			line += " " + *entry.ClosingName
		case entry.ClassName != nil:
			line += fmt.Sprintf(" %s %s", *entry.ClassName, value(entry.ClassTime))
		}
		if entry.EnteredByYou {
			line += " (du)"
		}
		out = append(out, line)
	}
	return out
}

func readChildDay(t *testing.T, router chi.Router, token string, studentID int64) (int, childDayWire, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/parent/me/children/%d/day-changes", studentID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := testutil.ExecuteRequestForTest(t, router, req)
	var envelope struct {
		Data childDayWire `json:"data"`
		Code string       `json:"code"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	if rec.Code != http.StatusOK {
		assert.Contains(t, []string{"care.child_not_linked", "care.guardian_permission_denied", "care.child_without_care_place"}, envelope.Code, rec.Body.String())
	}
	return rec.Code, envelope.Data, rec.Body.String()
}

// TestChildDayChanges is Seam 1 of "Heute anders" in the parents portal
// (#7671): every kind of the child's day through the owners' rows, the own
// child against a stranger, a child without parent_portal.access, a child of
// another school, the day before and a revoked permission.
func TestChildDayChanges(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	ctx := testpkg.Ctx(t)
	suffix := time.Now().UnixNano()
	exec := func(query string, args ...any) {
		_, err := db.ExecContext(ctx, query, args...)
		require.NoError(t, err)
	}

	chain := testpkg.CreateTestParentGuardianChain(t, db) // Felix, class 1a
	token := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(chain.AccountID)))
	felix := chain.StudentID
	staff, _ := testpkg.CreateTestStaffWithAccount(t, db, "Anna", "Vertretung")
	absent := testpkg.CreateTestStaff(t, db, "Ben", "Krankgemeldet")

	// Kinder: sick reported by the guardian, a pickup time the OGS set, goes
	// home alone; yesterday's excuse is no change of today.
	sick := testpkg.CreateTestStudentStatusDay(t, db, felix, day, "sick")
	exec("UPDATE active.student_status_days SET guardian_account_id = ?, note = 'Fieber und Husten' WHERE id = ?", chain.AccountID, sick.ID)
	testpkg.CreateTestStudentStatusDay(t, db, felix, day.AddDays(-1), "excused")
	testpkg.CreateTestPickupException(t, db, felix, testpkg.CalendarDate(day), staff.ID, "14:00", "Arzttermin beim Kinderarzt")
	testpkg.CreateTestDepartureException(t, db, felix, day, staff.ID, "alone", "Oma wartet")

	// A sibling on a class trip whose pickup the guardian changed, and whose
	// class ends earlier today.
	mia := testpkg.CreateTestStudent(t, db, "Mia", "Schneider", "2b")
	testpkg.CreateTestStudentGuardianLink(t, db, mia.ID, chain.GuardianProfileID, "primary_guardian")
	testpkg.CreateTestStudentStatusDay(t, db, mia.ID, day, "class_trip")
	miaPickup := testpkg.CreateTestPickupException(t, db, mia.ID, testpkg.CalendarDate(day), staff.ID, "13:00", "Zahnarzt")
	exec("UPDATE schedule.student_pickup_exceptions SET created_by_guardian = ?, source = 'guardian', created_by = NULL WHERE id = ?", chain.AccountID, miaPickup.ID)
	dismissal, err := api.NewDayChangesClassDismissalForTests(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, tenantID, func(ctx context.Context) error {
		return dismissal(ctx, "2b", day, "11:30", "Lehrerkonferenz")
	}))

	// A stranger of the same school and a child without the portal right.
	tom := testpkg.CreateTestStudent(t, db, "Tom", "Fremd", "1a")
	testpkg.CreateTestStudentStatusDay(t, db, tom.ID, day, "sick")
	lena := testpkg.CreateTestStudent(t, db, "Lena", "Schneider", "3c")
	lenaLink := testpkg.CreateTestStudentGuardianLink(t, db, lena.ID, chain.GuardianProfileID, "pickup_only")
	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, lenaLink.ID, map[string]interface{}{"parent_portal.access": false}))
	testpkg.CreateTestStudentStatusDay(t, db, lena.ID, day, "sick")
	noCarePlace := testpkg.CreateTestStudent(t, db, "Noah", "Ohneplatz", "4a")
	testpkg.CreateTestStudentGuardianLink(t, db, noCarePlace.ID, chain.GuardianProfileID, "primary_guardian")
	testpkg.MarkTestStudentWithoutCarePlace(t, db, noCarePlace.ID)
	testpkg.CreateTestStudentStatusDay(t, db, noCarePlace.ID, day, "sick")

	// Schule: today's closing day; Stundenplan: Felix's blocks.
	testpkg.CreateTestClosingDay(t, db, testpkg.CalendarDate(day), testpkg.CalendarDate(day), "Pädagogischer Tag")
	room := func(name string) int64 {
		return testpkg.CreateTestRoomNamed(t, db, fmt.Sprintf("%s-%d", name, suffix)).ID
	}
	werkraum, turnhalle, aula := room("Werkraum"), room("Turnhalle"), room("Aula")
	series := testpkg.CreateTestActivityGroup(t, db, fmt.Sprintf("Fussball-AG-%d", suffix))
	exec("UPDATE activities.groups SET planned_room_id = ? WHERE id = ? AND tenant_id = ?", werkraum, series.ID, tenantID)
	block := func(date calendar.Date, title, start string, roomID int64, seriesID *int64, children ...int64) int64 {
		id := testpkg.CreateTestActivityInstance(t, db, date, roomID, testpkg.ActivityInstanceOpts{Title: title, StartHHMM: start, EndHHMM: start[:1] + string(start[1]+1) + start[2:], ActivityGroupID: seriesID}).ID
		for _, child := range children {
			testpkg.CreateTestInstanceStudent(t, db, id, child, "")
		}
		return id
	}
	block(day, "Fussball", "14:00", turnhalle, &series.ID, felix)
	covered := block(day, "Chor", "13:00", aula, nil, felix)
	testpkg.CreateTestInstanceStaff(t, db, covered, absent.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	testpkg.CreateTestInstanceStaff(t, db, covered, staff.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	block(day, "Lernzeit", "12:00", werkraum, &series.ID, felix)
	cancelled := block(day, "Basteln", "15:00", aula, nil, felix)
	notFelix := block(day, "Theater", "16:00", aula, nil, tom.ID)
	yesterday := block(day.AddDays(-1), "Werken", "15:00", aula, nil, felix)
	module, _ := api.NewActiveTestTimetable(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db),
		func() time.Time { return day.BerlinMidnight().Add(9 * time.Hour) })
	reason := "Grippe der Leitung"
	for _, id := range []int64{cancelled, notFelix, yesterday} {
		require.NoError(t, testpkg.WithTenantTx(t, ctx, db, tenantID, func(ctx context.Context, _ bun.Tx) error {
			_, err := module.Instance.Cancel(ctx, id, &reason, nil)
			return err
		}))
	}

	// Another school of the same account, with its own child and closing day.
	otherSchool, _ := testpkg.CreateTestTenant(t, db)
	testpkg.EnsureAccountTenant(t, db, chain.AccountID, otherSchool)
	otherProfile := testpkg.CreateTestGuardianProfileForTenant(t, db, otherSchool, "Sabine", "Schneider", "portal")
	exec("UPDATE users.guardian_profiles SET account_id = ?, has_account = true WHERE id = ?", chain.AccountID, otherProfile.ID)
	otherChild := testpkg.CreateTestStudentForTenant(t, db, otherSchool, "Paul", "Schneider", "1a")
	testpkg.CreateTestStudentGuardianLinkForTenant(t, db, otherSchool, otherChild.ID, otherProfile.ID, "primary_guardian")
	exec("INSERT INTO schedule.closing_days (tenant_id, start_date, end_date, reason) VALUES (?, ?, ?, 'Fremder Schließtag')", otherSchool, day.String(), day.String())

	inner, err := api.NewChildDayChangesTestRouter(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/", inner)

	t.Run("the own child shows every kind without names, reasons or notes", func(t *testing.T) {
		code, answer, body := readChildDay(t, router, token, felix)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, day.String(), answer.Date)
		for _, source := range answer.Sources {
			assert.Equal(t, "loaded", source.Status, source.Source)
		}
		assert.Len(t, answer.Sources, 4)
		assert.ElementsMatch(t, []string{
			"closing_day Pädagogischer Tag",
			"child_absent sick (du)",
			"child_goes_alone",
			"child_pickup_changed 14:00",
			"activity_lead_changed Chor 13:00 @Aula <--",
			"activity_room_changed Fussball 14:00 @Turnhalle <-Werkraum",
			"activity_cancelled Basteln 15:00 @Aula <--",
		}, answer.lines(suffix))
		assert.Equal(t, "closing_day", answer.Entries[0].Kind, "the closed school stands first")
		for _, leak := range []string{"Anna", "Vertretung", "Ben", "Krankgemeldet", "Fieber", "Arzttermin", "Oma", "Grippe", "Lernzeit", "Theater", "Werken", "Fremder", "Tom", "staff_id", "people"} {
			assert.NotContains(t, body, leak)
		}
	})

	t.Run("the sibling shows its class trip, the class's end and the own pickup", func(t *testing.T) {
		code, answer, body := readChildDay(t, router, token, mia.ID)
		require.Equal(t, http.StatusOK, code, body)
		assert.ElementsMatch(t, []string{
			"closing_day Pädagogischer Tag",
			"child_pickup_changed 13:00 (du)",
			"class_trip 2b -",
			"class_dismissal_changed 2b 11:30",
		}, answer.lines(suffix))
		assert.NotContains(t, body, "Zahnarzt")
		assert.NotContains(t, body, "Lehrerkonferenz")
	})

	t.Run("a child of another school shows only its own school", func(t *testing.T) {
		code, answer, body := readChildDay(t, router, token, otherChild.ID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, []string{"closing_day Fremder Schließtag"}, answer.lines(suffix))
	})

	t.Run("a stranger and a child without the portal right stay closed", func(t *testing.T) {
		for _, id := range []int64{tom.ID, lena.ID} {
			code, _, body := readChildDay(t, router, token, id)
			assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
			assert.NotContains(t, body, "child_absent")
		}
	})

	t.Run("a child without an OGS place has no day changes", func(t *testing.T) {
		code, _, body := readChildDay(t, router, token, noCarePlace.ID)
		assert.Equal(t, http.StatusForbidden, code, body)
		assert.Contains(t, body, "care.child_without_care_place")
		assert.NotContains(t, body, "child_absent")
	})

	t.Run("another school's guardian sees nothing of the child", func(t *testing.T) {
		stranger := testpkg.CreateTestAccount(t, db, "parent")
		testpkg.EnsureAccountTenant(t, db, stranger.ID, otherSchool)
		strangerToken := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(stranger.ID)))
		code, _, body := readChildDay(t, router, strangerToken, felix)
		assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
	})
}

// TestChildDayChangesRevoked proves that the entries go when the guardian
// loses parent_portal.access.
func TestChildDayChangesRevoked(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	token := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(chain.AccountID)))
	testpkg.CreateTestStudentStatusDay(t, db, chain.StudentID, day, "sick")
	inner, err := api.NewChildDayChangesTestRouter(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/", inner)

	code, answer, body := readChildDay(t, router, token, chain.StudentID)
	require.Equal(t, http.StatusOK, code, body)
	assert.Equal(t, []string{"child_absent sick"}, answer.lines(0))

	var linkID int64
	require.NoError(t, db.NewRaw("SELECT id FROM users.student_guardian_relationships WHERE student_id = ? AND guardian_profile_id = ?", chain.StudentID, chain.GuardianProfileID).Scan(ctx, &linkID))
	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, linkID, map[string]interface{}{"parent_portal.access": false}))
	code, _, body = readChildDay(t, router, token, chain.StudentID)
	assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
	assert.NotContains(t, body, "child_absent")
}

// TestChildDayChangesQueryBudget proves the child's day reads set-based: the
// statement count does not grow with the child's changed blocks.
func TestChildDayChangesQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	tenantID := testpkg.Tenant(t)
	ctx := testpkg.Ctx(t)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	token := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(chain.AccountID)))
	staff, _ := testpkg.CreateTestStaffWithAccount(t, db, "Budget", "Kraft")
	testpkg.CreateTestStudentStatusDay(t, db, chain.StudentID, day, "sick")
	testpkg.CreateTestPickupException(t, db, chain.StudentID, day, staff.ID, "14:00", "")
	testpkg.CreateTestClosingDay(t, db, day, day, "Budget-Schließtag")
	// An opening change reads the child's weekly pickups as well (#8173).
	insertOpeningChange(t, db, tenantID, day, day, "08:00", "13:00", "Budget-Öffnung")
	testpkg.CreateTestPickupSchedule(t, db, chain.StudentID, int(day.Weekday()), staff.ID, "16:00")
	room := testpkg.CreateTestRoomNamed(t, db, "Budget-Raum").ID
	module, _ := api.NewActiveTestTimetable(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db),
		func() time.Time { return day.BerlinMidnight().Add(9 * time.Hour) })
	addBlock := func(n int) {
		id := testpkg.CreateTestActivityInstance(t, db, day, room, testpkg.ActivityInstanceOpts{Title: fmt.Sprintf("Budget %d", n), StartHHMM: "14:00", EndHHMM: "15:00"}).ID
		testpkg.CreateTestInstanceStudent(t, db, id, chain.StudentID, "")
		testpkg.CreateTestInstanceStaff(t, db, id, staff.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
		if n%2 == 0 {
			require.NoError(t, testpkg.WithTenantTx(t, ctx, db, tenantID, func(ctx context.Context, _ bun.Tx) error {
				_, err := module.Instance.Cancel(ctx, id, nil, nil)
				return err
			}))
		}
	}
	inner, err := api.NewChildDayChangesTestRouter(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/", inner)

	counter := testpkg.CaptureQueriesForContext(t, db)
	counter.Stop()
	statements := map[int]int{}
	added := 0
	for _, n := range []int{1, 3} {
		for added < n {
			added++
			addBlock(added)
		}
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/parent/me/children/%d/day-changes", chain.StudentID), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req = req.WithContext(counter.Context(context.Background()))
		counter.Reset()
		counter.Start()
		rec := testutil.ExecuteRequest(router, req)
		counter.Stop()
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var envelope struct{ Data childDayWire }
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
		require.Len(t, envelope.Data.Entries, 4+n, "sick, pickup, closing day, opening change and one entry per block")
		statements[n] = counter.Total()
		t.Logf("MEASURE parent.children.day_changes N%d=%d", n, counter.Total())
		querybudgets.AssertQueryBudget(t, "parent.children.day_changes.http_positive_growth", counter.Measurement(counter.Queries()))
	}
	require.Equal(t, statements[1], statements[3], "the statement count does not grow with the child's blocks")
}

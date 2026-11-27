package daychangesviewhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestChildDayChangesTomorrow is the preview on tomorrow in the parents
// portal (#8236): the school's today is the day before the fixtures' day,
// and the child's day reads the fixtures' day as tomorrow with the same
// rules as today. The own child shows its changes without names or reasons;
// a stranger, a child without parent_portal.access and another school's
// guardian stay closed for tomorrow too, before the day is checked; a day
// other than today and tomorrow is refused.
func TestChildDayChangesTomorrow(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	today := day.AddDays(-1)

	chain := testpkg.CreateTestParentGuardianChain(t, db)
	token := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(chain.AccountID)))
	felix := chain.StudentID
	staff, _ := testpkg.CreateTestStaffWithAccount(t, db, "Anna", "Vorschau")

	// Tomorrow Felix is sick and is collected at 14:00; today he is excused.
	testpkg.CreateTestStudentStatusDay(t, db, felix, day, "sick")
	testpkg.CreateTestStudentStatusDay(t, db, felix, today, "excused")
	testpkg.CreateTestPickupException(t, db, felix, testpkg.CalendarDate(day), staff.ID, "14:00", "Arzttermin morgen")
	testpkg.CreateTestClosingDay(t, db, testpkg.CalendarDate(day), testpkg.CalendarDate(day), "Studientag morgen")

	// A stranger of the same school and a child without the portal right,
	// both sick tomorrow.
	tom := testpkg.CreateTestStudent(t, db, "Tom", "Fremd", "1a")
	testpkg.CreateTestStudentStatusDay(t, db, tom.ID, day, "sick")
	lena := testpkg.CreateTestStudent(t, db, "Lena", "Schneider", "3c")
	lenaLink := testpkg.CreateTestStudentGuardianLink(t, db, lena.ID, chain.GuardianProfileID, "pickup_only")
	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, lenaLink.ID, map[string]interface{}{"parent_portal.access": false}))
	testpkg.CreateTestStudentStatusDay(t, db, lena.ID, day, "sick")

	inner, err := api.NewChildDayChangesTestRouter(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), today)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/", inner)
	path := func(studentID int64) string { return fmt.Sprintf("/parent/me/children/%d/day-changes", studentID) }
	read := func(token string, studentID int64, date string) (int, childDayWire, string) {
		rec := getOn(t, router, path(studentID), date, token)
		var envelope struct {
			Data childDayWire `json:"data"`
			Code string       `json:"code"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
		return rec.Code, envelope.Data, rec.Body.String()
	}

	t.Run("tomorrow shows the own child's changes of tomorrow without names or reasons", func(t *testing.T) {
		code, answer, body := read(token, felix, day.String())
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, day.String(), answer.Date)
		assert.ElementsMatch(t, []string{
			"closing_day Studientag morgen",
			"child_absent sick",
			"child_pickup_changed 14:00",
		}, answer.lines(0))
		for _, leak := range []string{"Anna", "Vorschau", "Arzttermin", "excused", "Tom", "Lena", "staff_id", "people"} {
			assert.NotContains(t, body, leak)
		}
	})

	t.Run("today stays today with the same route", func(t *testing.T) {
		code, answer, body := read(token, felix, today.String())
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, today.String(), answer.Date)
		assert.Equal(t, []string{"child_absent excused"}, answer.lines(0))
	})

	t.Run("a stranger and a child without the portal right stay closed tomorrow", func(t *testing.T) {
		for _, id := range []int64{tom.ID, lena.ID} {
			for _, date := range []string{day.String(), day.AddDays(1).String()} {
				code, _, body := read(token, id, date)
				assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, "the relationship is checked before the day: "+body)
				assert.NotContains(t, body, "child_absent")
			}
		}
	})

	t.Run("another school's guardian sees nothing of the child tomorrow", func(t *testing.T) {
		otherSchool, _ := testpkg.CreateTestTenant(t, db)
		stranger := testpkg.CreateTestAccount(t, db, "parent")
		testpkg.EnsureAccountTenant(t, db, stranger.ID, otherSchool)
		strangerToken := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(stranger.ID)))
		code, _, body := read(strangerToken, felix, day.String())
		assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
		assert.NotContains(t, body, "child_absent")
	})

	t.Run("a day other than today and tomorrow is refused", func(t *testing.T) {
		for _, date := range []string{today.AddDays(-1).String(), day.AddDays(1).String(), "morgen", "2026-13-01"} {
			code, _, body := read(token, felix, date)
			assert.Equal(t, http.StatusBadRequest, code, date+": "+body)
			assert.Contains(t, body, "general.input", date)
			assert.NotContains(t, body, "child_absent", date)
		}
	})

	t.Run("a revoked permission closes tomorrow as well", func(t *testing.T) {
		mia := testpkg.CreateTestStudent(t, db, "Mia", "Schneider", "2b")
		miaLink := testpkg.CreateTestStudentGuardianLink(t, db, mia.ID, chain.GuardianProfileID, "primary_guardian")
		testpkg.CreateTestStudentStatusDay(t, db, mia.ID, day, "sick")
		code, answer, body := read(token, mia.ID, day.String())
		require.Equal(t, http.StatusOK, code, body)
		assert.ElementsMatch(t, []string{"closing_day Studientag morgen", "child_absent sick"}, answer.lines(0))
		require.NoError(t, testpkg.SetTestStudentGuardianPermissions(context.Background(), db, miaLink.ID, map[string]interface{}{"parent_portal.access": false}))
		code, _, body = read(token, mia.ID, day.String())
		assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
		assert.NotContains(t, body, "child_absent")
	})
}

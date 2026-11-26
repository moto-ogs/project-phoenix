package daychangesviewhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func insertOpeningChange(t *testing.T, db *testpkg.DB, tenantID int64, start, end calendar.Date, opensAt, closesAt, reason string) {
	t.Helper()
	_, err := db.ExecContext(testpkg.Ctx(t), `INSERT INTO schedule.opening_changes (tenant_id, start_date, end_date, opens_at, closes_at, reason)
		VALUES (?, ?, ?, ?::time, ?::time, ?)`, tenantID, start, end, opensAt, closesAt, reason)
	require.NoError(t, err)
}

// TestChildDayOpeningChanges is Seam 1 of the opening changes in the
// child's day of the parents portal (#8170): the own child sees the
// school's change and a changed pickup after it as conflict, a child of
// another school only its own school's change, and a child without
// parent_portal.access nothing.
func TestChildDayOpeningChanges(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	ctx := testpkg.Ctx(t)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	token := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(chain.AccountID)))
	staff := testpkg.CreateTestStaff(t, db, "Anna", "Betreuung")
	testpkg.CreateTestPickupException(t, db, chain.StudentID, day, staff.ID, "14:30", "Arzttermin")
	insertOpeningChange(t, db, tenantID, day, day.AddDays(1), "08:00", "13:00", "Zeugnistage")
	insertOpeningChange(t, db, tenantID, day.AddDays(-1), day.AddDays(-1), "08:00", "12:00", "Gestern kürzer")
	// A sibling picked up before the closing time: no conflict.
	mia := testpkg.CreateTestStudent(t, db, "Mia", "Schneider", "2b")
	testpkg.CreateTestStudentGuardianLink(t, db, mia.ID, chain.GuardianProfileID, "primary_guardian")
	testpkg.CreateTestPickupException(t, db, mia.ID, day, staff.ID, "12:30", "Zahnarzt")

	lena := testpkg.CreateTestStudent(t, db, "Lena", "Schneider", "3c")
	lenaLink := testpkg.CreateTestStudentGuardianLink(t, db, lena.ID, chain.GuardianProfileID, "pickup_only")
	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, lenaLink.ID, map[string]interface{}{"parent_portal.access": false}))

	otherSchool, _ := testpkg.CreateTestTenant(t, db)
	testpkg.EnsureAccountTenant(t, db, chain.AccountID, otherSchool)
	otherProfile := testpkg.CreateTestGuardianProfileForTenant(t, db, otherSchool, "Sabine", "Schneider", "portal")
	_, err := db.ExecContext(ctx, "UPDATE users.guardian_profiles SET account_id = ?, has_account = true WHERE id = ?", chain.AccountID, otherProfile.ID)
	require.NoError(t, err)
	otherChild := testpkg.CreateTestStudentForTenant(t, db, otherSchool, "Paul", "Schneider", "1a")
	testpkg.CreateTestStudentGuardianLinkForTenant(t, db, otherSchool, otherChild.ID, otherProfile.ID, "primary_guardian")
	insertOpeningChange(t, db, otherSchool, day, day, "09:00", "11:30", "Fremde Schule kürzer")

	inner, err := api.NewChildDayChangesTestRouter(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/", inner)

	type line struct {
		Kind               string  `json:"kind"`
		OpeningName        *string `json:"opening_name"`
		OpensAt            *string `json:"opens_at"`
		ClosesAt           *string `json:"closes_at"`
		PickupTime         *string `json:"pickup_time"`
		PickupAfterClosing bool    `json:"pickup_after_closing"`
	}
	entries := func(body string) []string {
		var envelope struct {
			Data struct {
				Entries []line `json:"entries"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal([]byte(body), &envelope))
		out := []string{}
		for _, entry := range envelope.Data.Entries {
			switch entry.Kind {
			case "opening_changed":
				out = append(out, fmt.Sprintf("opening %s %s-%s", *entry.OpeningName, *entry.OpensAt, *entry.ClosesAt))
			case "child_pickup_changed":
				out = append(out, fmt.Sprintf("pickup %s after=%t", *entry.PickupTime, entry.PickupAfterClosing))
			}
		}
		return out
	}

	t.Run("the own child shows the change first and the pickup after it as conflict", func(t *testing.T) {
		code, _, body := readChildDay(t, router, token, chain.StudentID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, []string{"opening Zeugnistage 08:00-13:00", "pickup 14:30 after=true"}, entries(body))
		assert.Contains(t, body, `"until":"2026-09-10"`)
		for _, leak := range []string{"Arzttermin", "Fremde Schule", "Gestern"} {
			assert.NotContains(t, body, leak)
		}
	})

	t.Run("a pickup before the closing time is no conflict", func(t *testing.T) {
		code, _, body := readChildDay(t, router, token, mia.ID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, []string{"opening Zeugnistage 08:00-13:00", "pickup 12:30 after=false"}, entries(body))
	})

	t.Run("a child of another school shows only its own school's change", func(t *testing.T) {
		code, _, body := readChildDay(t, router, token, otherChild.ID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, []string{"opening Fremde Schule kürzer 09:00-11:30"}, entries(body))
	})

	t.Run("a child without the portal right shows nothing", func(t *testing.T) {
		code, _, body := readChildDay(t, router, token, lena.ID)
		assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
		assert.NotContains(t, body, "Zeugnistag")
	})
}

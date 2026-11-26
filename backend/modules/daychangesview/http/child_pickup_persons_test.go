package daychangesviewhttp_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// childPickupPersonLines renders the child_pickup_person entries of a raw
// parents' answer as "name [einmalig] [du]".
func childPickupPersonLines(t *testing.T, body string) []string {
	t.Helper()
	var envelope struct {
		Data struct {
			Entries []struct {
				Kind         string  `json:"kind"`
				EnteredByYou bool    `json:"entered_by_you"`
				Name         *string `json:"pickup_person_name"`
				OneTime      bool    `json:"pickup_person_one_time"`
			} `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope), body)
	lines := []string{}
	for _, entry := range envelope.Data.Entries {
		if entry.Kind != "child_pickup_person" {
			continue
		}
		require.NotNil(t, entry.Name, body)
		line := *entry.Name
		if entry.OneTime {
			line += " einmalig"
		}
		if entry.EnteredByYou {
			line += " (du)"
		}
		lines = append(lines, line)
	}
	return lines
}

// TestChildDayChangesPickupPerson is the pickup person of the day in the
// parents portal (#8162): a person the guardian's own request named is
// "Von dir eingetragen", one the OGS set is not, a co-guardian reads the
// same person without the mark, and a child without the guardian's
// relationship or of another school stays closed.
func TestChildDayChangesPickupPerson(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	token := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(chain.AccountID)))
	staff := testpkg.CreateTestStaff(t, db, "Pia", "Abholung")

	// The own child: a one-time person the guardian asked for and the OGS
	// approved; tomorrow's person is no change of today.
	frieda := testpkg.CreateTestPickupPerson(t, db, chain.StudentID, day, staff.ID, "Tante Frieda", 0)
	_, err := db.ExecContext(ctx, `UPDATE schedule.student_pickup_persons SET requested_by_guardian = ? WHERE id = ?`, chain.AccountID, frieda.ID)
	require.NoError(t, err)
	testpkg.CreateTestPickupPerson(t, db, chain.StudentID, day.AddDays(1), staff.ID, "Onkel Karl", 0)

	// A sibling whose contact the OGS named for today.
	sibling := testpkg.CreateTestStudent(t, db, "Mia", "Schneider", "2b")
	testpkg.CreateTestStudentGuardianLink(t, db, sibling.ID, chain.GuardianProfileID, "primary_guardian")
	oma := testpkg.CreateTestGuardianProfileNamed(t, db, "Oma", "Berta", "day-changes-oma")
	testpkg.CreateTestPickupPerson(t, db, sibling.ID, day, staff.ID, "Oma Berta", oma.ID)

	// A co-guardian of the own child with an account of its own.
	coGuardian := testpkg.CreateTestAccount(t, db, "parent")
	coProfile := testpkg.CreateTestGuardianProfileNamed(t, db, "Sven", "Schneider", "day-changes-co")
	_, err = db.ExecContext(ctx, `UPDATE users.guardian_profiles SET account_id = ?, has_account = true WHERE id = ?`, coGuardian.ID, coProfile.ID)
	require.NoError(t, err)
	testpkg.CreateTestStudentGuardianLink(t, db, chain.StudentID, coProfile.ID, "primary_guardian")
	coToken := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(coGuardian.ID)))

	// A child of the same school the guardian is not linked to.
	stranger := testpkg.CreateTestStudent(t, db, "Tom", "Fremd", "1a")
	testpkg.CreateTestPickupPerson(t, db, stranger.ID, day, staff.ID, "Herr Fremd", 0)

	inner, err := api.NewChildDayChangesTestRouter(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/", inner)

	t.Run("the guardian's own request is entered by you", func(t *testing.T) {
		code, _, body := readChildDay(t, router, token, chain.StudentID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, []string{"Tante Frieda einmalig (du)"}, childPickupPersonLines(t, body))
		assert.NotContains(t, body, "Onkel Karl", "another day's person is no change of today")
	})

	t.Run("a person the OGS set is not entered by you", func(t *testing.T) {
		code, _, body := readChildDay(t, router, token, sibling.ID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, []string{"Oma Berta"}, childPickupPersonLines(t, body))
	})

	t.Run("a co-guardian reads the person without the mark", func(t *testing.T) {
		code, _, body := readChildDay(t, router, coToken, chain.StudentID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, []string{"Tante Frieda einmalig"}, childPickupPersonLines(t, body))
	})

	t.Run("a child without the guardian's relationship stays closed", func(t *testing.T) {
		code, _, body := readChildDay(t, router, token, stranger.ID)
		assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
		assert.NotContains(t, body, "Herr Fremd")
	})

	t.Run("another school's guardian sees nothing of the child", func(t *testing.T) {
		otherSchool, _ := testpkg.CreateTestTenant(t, db)
		outsider := testpkg.CreateTestAccount(t, db, "parent")
		testpkg.EnsureAccountTenant(t, db, outsider.ID, otherSchool)
		code, _, body := readChildDay(t, router, testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(outsider.ID))), chain.StudentID)
		assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
		assert.NotContains(t, body, "Tante Frieda")
	})
}

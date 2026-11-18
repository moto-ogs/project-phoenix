//go:build testhooks

package mealplan_test

// Der geänderte Speiseplan in der Glocke des Caterer-Portals (#7147), von
// außen geprüft: die Schule ändert den Speiseplan über die Route des
// Staff-Portals, und das Konto des Caterers, der die Schule beliefert, liest
// seine Glocke über die Routen des Caterer-Portals.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type catererMenuEntry struct {
	menuChangeEntry
	SchoolID   string `json:"school_id"`
	SchoolName string `json:"school_name"`
}

// catererEntries reads the caterer bell of the account.
func (f *menuChangeFixture) catererEntries(t *testing.T, accountID int64) []catererMenuEntry {
	t.Helper()
	request := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/caterer/notifications/feed/", nil,
		testutil.WithJWTBearer(testpkg.MintTestJWT(t, testpkg.CatererTestClaims(int(accountID)))))
	response := testutil.ExecuteRequestForTest(t, f.feed, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var feed struct {
		Data struct {
			Entries []catererMenuEntry `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &feed))
	return feed.Data.Entries
}

// caterer creates a caterer with one account that supplies the school.
func (f *menuChangeFixture) caterer(t *testing.T, name string, schoolID int64) int64 {
	t.Helper()
	ctx := context.Background()
	account := testpkg.CreateTestAccount(t, f.db, "menu-caterer")
	var catererID int64
	require.NoError(t, f.db.NewRaw(`INSERT INTO auth.caterers (name) VALUES (?) RETURNING id`, name).Scan(ctx, &catererID))
	t.Cleanup(func() {
		_, err := f.db.ExecContext(context.Background(), `DELETE FROM auth.caterers WHERE id = ?`, catererID)
		assert.NoError(t, err)
	})
	_, err := f.db.ExecContext(ctx, `INSERT INTO auth.caterer_accounts (account_id, caterer_id) VALUES (?, ?)`, account.ID, catererID)
	require.NoError(t, err)
	_, err = f.db.ExecContext(ctx, `INSERT INTO auth.caterer_schools (caterer_id, tenant_id, delivery_address) VALUES (?, ?, 'Hof')`, catererID, schoolID)
	require.NoError(t, err)
	return account.ID
}

func TestMenuChangeReachesTheBellOfTheSchoolsCaterer(t *testing.T) {
	t.Parallel()
	f := newMenuChangeFixture(t)
	f.family(t, true)
	kitchen := f.caterer(t, "Küche Sonnenschein", f.tenantID)
	// The caterer of another school hears nothing of this school's menu.
	other := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, f.db, other)
	stranger := f.caterer(t, "Andere Küche", other)
	_, err := f.db.ExecContext(context.Background(), `UPDATE platform.schools SET name = 'Grundschule Am Bach' WHERE id = ?`, f.tenantID)
	require.NoError(t, err)

	// The first menu of a day is the regular plan and tells nobody; a day
	// already over neither.
	f.setMenu(t, "2030-06-12", "Nudeln mit Tomatensoße")
	f.setMenu(t, "2030-06-07", "Fisch")
	f.setMenu(t, "2030-06-07", "Gemüse")
	assert.Empty(t, f.catererEntries(t, kitchen))

	f.setMenu(t, "2030-06-12", "Reis mit Gemüse")
	entries := f.catererEntries(t, kitchen)
	require.Len(t, entries, 1)
	assert.Equal(t, deliveryContract.NotificationCatererMealPlanChanged, entries[0].Type)
	assert.Equal(t, "Speiseplan geändert", entries[0].Title)
	assert.Equal(t, "Die Schule hat den Speiseplan für die Woche vom 10.06. bis 14.06.2030 geändert. Bitte prüfen Sie Ihre Planung.", entries[0].Body)
	assert.Equal(t, "/caterer", entries[0].DeepLink)
	assert.Equal(t, fmt.Sprint(f.tenantID), entries[0].SchoolID)
	assert.Equal(t, "Grundschule Am Bach", entries[0].SchoolName)
	assert.Empty(t, f.catererEntries(t, stranger), "another school's caterer gets nothing")
	var pushes int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM platform.push_outbox WHERE (recipient->>'account_id')::bigint = ?`, kitchen).Scan(context.Background(), &pushes))
	assert.Zero(t, pushes, "the caterer portal has no push")

	// A second change of the same week bundles into the unread entry.
	f.setMenu(t, "2030-06-13", "Linsensuppe")
	f.clearMenu(t, "2030-06-13")
	assert.Len(t, f.catererEntries(t, kitchen), 1, "changes to one week bundle into one entry")

	// The school switch stops the caterer's entry too.
	require.NoError(t, f.settings.SetValue(testpkg.Ctx(t), "notifications.meal_plan_changed_enabled", false, nil, nil))
	f.setMenu(t, "2030-06-19", "Fisch")
	f.setMenu(t, "2030-06-19", "Gemüse")
	assert.Len(t, f.catererEntries(t, kitchen), 1, "a school that switched it off writes no entry")
}

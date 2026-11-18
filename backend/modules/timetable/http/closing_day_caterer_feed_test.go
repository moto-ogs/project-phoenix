package timetablehttp_test

// Der Schließtag in der Glocke des Caterer-Portals (#7147), von außen
// geprüft: die Leitung einer Schule trägt den Schließtag über ihre Route ein,
// und jedes Caterer-Konto liest seine Glocke über die Routen des
// Caterer-Portals, über alle Schulen, die sein Caterer beliefert, und nur
// diese.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// catererFeedCall runs a request of the caterer bell in a session of the
// account and decodes its data into out; it answers the status.
func (f *closingFeedFixture) catererFeedCall(t *testing.T, accountID int64, method, path string, out any) int {
	t.Helper()
	token := testpkg.MintTestJWT(t, testpkg.CatererTestClaims(int(accountID)))
	req := testutil.NewAuthenticatedRequest(t, method, "/caterer/notifications/feed"+path, nil, testutil.WithJWTBearer(token))
	rec := testutil.ExecuteRequestForTest(t, f.feed, req)
	if rec.Code != http.StatusOK || out == nil {
		return rec.Code
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	require.NoError(t, json.Unmarshal(envelope.Data, out), rec.Body.String())
	return rec.Code
}

// catererFeed reads the bell of the account and checks that its count
// matches the page.
func (f *closingFeedFixture) catererFeed(t *testing.T, accountID int64) ([]traegerFeedEntry, int) {
	t.Helper()
	var page struct {
		Entries     []traegerFeedEntry `json:"entries"`
		UnreadCount int                `json:"unread_count"`
	}
	require.Equal(t, http.StatusOK, f.catererFeedCall(t, accountID, http.MethodGet, "/", &page))
	var count struct {
		UnreadCount int `json:"unread_count"`
	}
	require.Equal(t, http.StatusOK, f.catererFeedCall(t, accountID, http.MethodGet, "/unread-count", &count))
	require.Equal(t, page.UnreadCount, count.UnreadCount, "the bell's count matches its page")
	return page.Entries, count.UnreadCount
}

// newTestCaterer creates a caterer business with the given accounts.
func newTestCaterer(t *testing.T, db *bun.DB, name string, accountIDs ...int64) int64 {
	t.Helper()
	ctx := context.Background()
	var catererID int64
	require.NoError(t, db.NewRaw(`INSERT INTO auth.caterers (name) VALUES (?) RETURNING id`, name).Scan(ctx, &catererID))
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `DELETE FROM auth.caterers WHERE id = ?`, catererID)
		assert.NoError(t, err)
	})
	for _, accountID := range accountIDs {
		_, err := db.ExecContext(ctx, `INSERT INTO auth.caterer_accounts (account_id, caterer_id) VALUES (?, ?)`, accountID, catererID)
		require.NoError(t, err)
	}
	return catererID
}

// supply starts the caterer's supply of the school.
func supply(t *testing.T, db *bun.DB, catererID, schoolID int64) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO auth.caterer_schools (caterer_id, tenant_id, delivery_address) VALUES (?, ?, 'Hof')`, catererID, schoolID)
	require.NoError(t, err)
}

// endSupply ends the caterer's running supply of the school.
func endSupply(t *testing.T, db *bun.DB, schoolID int64) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `UPDATE auth.caterer_schools SET ended_at = NOW() WHERE tenant_id = ? AND ended_at IS NULL`, schoolID)
	require.NoError(t, err)
}

func catererFeedSchool(t *testing.T, db *bun.DB, name string) int64 {
	t.Helper()
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger " + name, Slug: fmt.Sprintf("caterer-feed-%d", testpkg.UniqueTestTenantID(t)), Active: true,
	}).ID
	return testpkg.CreateTestSchoolInOrganization(t, db, organization, name)
}

func TestClosingDayReachesTheBellOfTheSchoolsCatererOnly(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := catererFeedSchool(t, db, "Grundschule Am Bach")
	f := newClosingFeedFixtureIn(t, db, school)
	// A second school the same caterer supplies: its entries reach the same
	// bell, each with its school's name. A third school is supplied by
	// another caterer.
	sister := catererFeedSchool(t, db, "Grundschule Am Hang")
	foreignSchool := catererFeedSchool(t, db, "Fremde Schule")

	leitung := f.staff(t, "Leitung")
	kitchen := testpkg.CreateTestAccount(t, db, "caterer-kitchen")
	// A second account of the same caterer, deactivated later.
	deputy := testpkg.CreateTestAccount(t, db, "caterer-deputy")
	stranger := testpkg.CreateTestAccount(t, db, "caterer-stranger")
	own := newTestCaterer(t, db, "Küche Sonnenschein", kitchen.ID, deputy.ID)
	foreign := newTestCaterer(t, db, "Andere Küche", stranger.ID)
	supply(t, db, own, school)
	supply(t, db, own, sister)
	supply(t, db, foreign, foreignSchool)
	insert := func(schoolID int64, title string) {
		t.Helper()
		_, err := db.ExecContext(context.Background(), `INSERT INTO platform.notification_feed_entries
			(tenant_id, account_id, type, title, body, deep_link, related_type, related_id, created_at, updated_at)
			VALUES (?, ?, ?, ?, '', '/caterer', 'closing_day', 1, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')`,
			schoolID, kitchen.ID, deliveryContract.NotificationCatererSchoolClosingDayChanged, title)
		require.NoError(t, err)
	}
	insert(sister, "Schließtag geändert")
	// An entry of a school its caterer does not supply never reaches the
	// account's bell, even though the account owns it.
	insert(foreignSchool, "Fremder Schließtag")

	first := f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-12", "2030-06-12", "Pädagogischer Tag"))

	entries, unread := f.catererFeed(t, kitchen.ID)
	require.Len(t, entries, 2, "the bell holds the entries of every school the caterer supplies")
	assert.Equal(t, 2, unread)
	assert.Equal(t, deliveryContract.NotificationCatererSchoolClosingDayChanged, entries[0].Type)
	assert.Equal(t, "Neuer Schließtag", entries[0].Title)
	assert.Equal(t, "Am 12.06.2030 ist ein Schließtag: Pädagogischer Tag.", entries[0].Body)
	assert.Equal(t, "/caterer", entries[0].DeepLink)
	assert.Equal(t, fmt.Sprint(school), entries[0].SchoolID)
	assert.Equal(t, "Grundschule Am Bach", entries[0].SchoolName)
	assert.Equal(t, "Grundschule Am Hang", entries[1].SchoolName)
	assert.Zero(t, f.pushes(t, kitchen.ID), "the caterer portal has no push")
	strangerEntries, _ := f.catererFeed(t, stranger.ID)
	assert.Empty(t, strangerEntries, "another caterer sees nothing of this school")
	deputyEntries, _ := f.catererFeed(t, deputy.ID)
	require.Len(t, deputyEntries, 1, "every active account of the caterer gets the entry")
	// A deactivated account reads nothing more; its entry stays stored.
	_, err := db.ExecContext(context.Background(), `UPDATE auth.accounts SET active = false WHERE id = ?`, deputy.ID)
	require.NoError(t, err)
	deputyEntries, _ = f.catererFeed(t, deputy.ID)
	assert.Empty(t, deputyEntries, "a deactivated caterer account reads nothing")
	assert.Empty(t, f.entries(t, kitchen.ID, school, "staff"), "the caterer entry stays out of the staff portal")

	// The read state works as in the staff portal; another caterer cannot
	// mark the entry read.
	assert.Equal(t, http.StatusNotFound, f.catererFeedCall(t, stranger.ID, http.MethodPost, fmt.Sprintf("/%d/read", entries[0].ID), nil))
	var count struct {
		UnreadCount int `json:"unread_count"`
	}
	f.catererFeedCall(t, kitchen.ID, http.MethodPost, fmt.Sprintf("/%d/read", entries[0].ID), &count)
	assert.Equal(t, 1, count.UnreadCount)
	f.catererFeedCall(t, kitchen.ID, http.MethodPost, "/read-all", &count)
	assert.Zero(t, count.UnreadCount)
	entries, unread = f.catererFeed(t, kitchen.ID)
	require.Len(t, entries, 2)
	assert.Zero(t, unread)
	assert.NotNil(t, entries[1].ReadAt)

	// A school that switched the type off tells its caterer nothing either.
	testpkg.SetTestTenantSetting(t, db, school, "notifications.school_closing_day_enabled", "false")
	second := f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-20", "2030-06-20", "Betriebsausflug"))
	entries, _ = f.catererFeed(t, kitchen.ID)
	assert.Len(t, entries, 2)
	testpkg.SetTestTenantSetting(t, db, school, "notifications.school_closing_day_enabled", "true")
	third := f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-25", "2030-06-25", "Sommerfest"))
	entries, _ = f.catererFeed(t, kitchen.ID)
	assert.Len(t, entries, 3)
	var deputyStored int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM platform.notification_feed_entries WHERE account_id = ?`, deputy.ID).Scan(context.Background(), &deputyStored))
	assert.Equal(t, 1, deputyStored, "a deactivated account gets no new entry and keeps its old one")

	// An ended supply hides the school's entries on the next read and
	// writes no new one; nothing is deleted.
	endSupply(t, db, sister)
	entries, _ = f.catererFeed(t, kitchen.ID)
	require.Len(t, entries, 2)
	for _, entry := range entries {
		assert.Equal(t, "Grundschule Am Bach", entry.SchoolName)
	}
	endSupply(t, db, school)
	f.save(t, leitung, http.MethodDelete, first, "")
	f.save(t, leitung, http.MethodDelete, second, "")
	f.save(t, leitung, http.MethodDelete, third, "")
	entries, _ = f.catererFeed(t, kitchen.ID)
	assert.Empty(t, entries)
	var stored int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM platform.notification_feed_entries WHERE account_id = ?`, kitchen.ID).Scan(context.Background(), &stored))
	assert.Equal(t, 4, stored, "the entries before the end stay until their retention")
}

// N is the number of entries of a caterer account across the schools its
// caterer supplies (#7147). The page and the unread count, each with the
// check of the running supplies, are a fixed number of statements whatever
// the bell holds; another account's entries stay out.
func TestCatererNotificationFeedHTTPQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	schools := []int64{catererFeedSchool(t, db, "Schule Eins"), catererFeedSchool(t, db, "Schule Zwei")}
	f := newClosingFeedFixtureIn(t, db, schools[0])
	kitchen := testpkg.CreateTestAccount(t, db, "caterer-budget")
	other := testpkg.CreateTestAccount(t, db, "caterer-budget-other")
	caterer := newTestCaterer(t, db, "Budgetküche", kitchen.ID, other.ID)
	supply(t, db, caterer, schools[0])
	supply(t, db, caterer, schools[1])
	insert := func(accountID, schoolID int64, objectID int) {
		t.Helper()
		_, err := db.ExecContext(context.Background(), `INSERT INTO platform.notification_feed_entries
			(tenant_id, account_id, type, title, body, deep_link, related_type, related_id)
			VALUES (?, ?, ?, 'Neuer Schließtag', 'Am 12.06.2030 ist ein Schließtag.', '/caterer', 'closing_day', ?)`,
			schoolID, accountID, deliveryContract.NotificationCatererSchoolClosingDayChanged, objectID)
		require.NoError(t, err)
	}
	insert(other.ID, schools[0], 1)
	token := testpkg.MintTestJWT(t, testpkg.CatererTestClaims(int(kitchen.ID)))
	counter := testpkg.CaptureQueries(t, db)
	previous, statements := 0, 0
	for _, n := range []int{0, 3, 8} {
		for i := previous; i < n; i++ {
			insert(kitchen.ID, schools[i%2], 100+i)
		}
		counter.Reset()
		req := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/caterer/notifications/feed/", nil, testutil.WithJWTBearer(token))
		rec := testutil.ExecuteRequestForTest(t, f.feed, req)
		counter.Stop()
		querybudgets.AssertQueryBudget(t, "caterer.notifications.feed", counter.Measurement(counter.Queries()))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var page struct {
			Data struct {
				Entries     []json.RawMessage `json:"entries"`
				UnreadCount int               `json:"unread_count"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &page))
		require.Len(t, page.Data.Entries, n)
		require.Equal(t, n, page.Data.UnreadCount)
		if statements > 0 {
			require.Len(t, counter.Queries(), statements, "bell entries must not add round trips")
		}
		statements = len(counter.Queries())
		previous = n
		counter.Start()
	}
	counter.Stop()
}

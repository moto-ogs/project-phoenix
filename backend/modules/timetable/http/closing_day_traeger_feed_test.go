package timetablehttp_test

// Der Schließtag in der Glocke des Träger-Portals (#7146), von außen
// geprüft: die Leitung einer Schule trägt den Schließtag über ihre Route ein,
// und jedes Träger-Konto liest seine Glocke über die Routen des
// Träger-Portals, über alle Schulen seines Trägers und nur diese.

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
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type traegerFeedEntry struct {
	ID         int64   `json:"id"`
	Type       string  `json:"type"`
	Title      string  `json:"title"`
	Body       string  `json:"body"`
	DeepLink   string  `json:"deep_link"`
	ReadAt     *string `json:"read_at"`
	SchoolID   string  `json:"school_id"`
	SchoolName string  `json:"school_name"`
}

// traegerFeedCall runs a request of the Träger bell in a session of the
// Träger organizationID and decodes its data into out.
func (f *closingFeedFixture) traegerFeedCall(t *testing.T, accountID, organizationID int64, method, path string, out any) {
	t.Helper()
	token := testpkg.MintTestJWT(t, traegerReaderClaims(accountID, organizationID))
	req := testutil.NewAuthenticatedRequest(t, method, "/traeger/notifications/feed"+path, nil, testutil.WithJWTBearer(token))
	rec := testutil.ExecuteRequestForTest(t, f.feed, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	require.NoError(t, json.Unmarshal(envelope.Data, out), rec.Body.String())
}

// traegerReaderClaims is a read-only session of the Träger-Büro.
func traegerReaderClaims(accountID, organizationID int64) testpkg.Claims {
	roles := []string{identityaccess.TraegerRoleReadOnly}
	return testpkg.TraegerTestClaims(int(accountID), organizationID, roles, identityaccess.TraegerRights(roles))
}

func (f *closingFeedFixture) traegerFeed(t *testing.T, accountID, organizationID int64) ([]traegerFeedEntry, int) {
	t.Helper()
	var page struct {
		Entries     []traegerFeedEntry `json:"entries"`
		UnreadCount int                `json:"unread_count"`
	}
	f.traegerFeedCall(t, accountID, organizationID, http.MethodGet, "/", &page)
	var count struct {
		UnreadCount int `json:"unread_count"`
	}
	f.traegerFeedCall(t, accountID, organizationID, http.MethodGet, "/unread-count", &count)
	require.Equal(t, page.UnreadCount, count.UnreadCount, "the bell's count matches its page")
	return page.Entries, count.UnreadCount
}

func traegerFeedOrganization(t *testing.T, f *closingFeedFixture, name string) int64 {
	t.Helper()
	return testpkg.CreateTestOrganization(t, f.db, &testpkg.Organization{
		Name: name, Slug: fmt.Sprintf("traeger-feed-%d", testpkg.UniqueTestTenantID(t)), Active: true,
	}).ID
}

func TestClosingDayReachesTheBellOfTheSchoolsTraegerOnly(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	own := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger Glocke", Slug: fmt.Sprintf("traeger-feed-%d", testpkg.UniqueTestTenantID(t)), Active: true,
	}).ID
	school := testpkg.CreateTestSchoolInOrganization(t, db, own, "Grundschule Am Bach")
	f := newClosingFeedFixtureIn(t, db, school)
	// A second school of the same Träger: its entries reach the same bell,
	// each with its school's name.
	sister := testpkg.CreateTestSchoolInOrganization(t, db, own, "Grundschule Am Hang")
	foreign := traegerFeedOrganization(t, f, "Anderer Träger")
	foreignSchool := testpkg.CreateTestSchoolInOrganization(t, db, foreign, "Fremde Schule")

	leitung := f.staff(t, "Leitung")
	office := testpkg.CreateTestAccount(t, db, "traeger-office")
	departing := testpkg.CreateTestAccount(t, db, "traeger-departing")
	stranger := testpkg.CreateTestAccount(t, db, "traeger-stranger")
	testpkg.CreateTestTraegerMember(t, db, own, office.ID, identityaccess.TraegerRoleReadOnly)
	testpkg.CreateTestTraegerMember(t, db, own, departing.ID, identityaccess.TraegerRoleReadOnly)
	testpkg.CreateTestTraegerMember(t, db, own, leitung.accountID, identityaccess.TraegerRoleAdministration)
	testpkg.CreateTestTraegerMember(t, db, foreign, stranger.ID, identityaccess.TraegerRoleReadOnly)
	_, err := db.ExecContext(context.Background(), `INSERT INTO platform.notification_feed_entries
		(tenant_id, account_id, type, title, body, deep_link, related_type, related_id, created_at, updated_at)
		VALUES (?, ?, ?, 'Schließtag geändert', '', '/traeger/schulen/1', 'closing_day', 1, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')`,
		sister, office.ID, deliveryContract.NotificationTraegerSchoolClosingDayChanged)
	require.NoError(t, err)
	// An entry of another Träger's school for the same account never reaches
	// this Träger's bell, even though the account owns it.
	_, err = db.ExecContext(context.Background(), `INSERT INTO platform.notification_feed_entries
		(tenant_id, account_id, type, title, body, deep_link, related_type, related_id)
		VALUES (?, ?, ?, 'Fremder Schließtag', '', '/traeger/schulen/1', 'closing_day', 1)`,
		foreignSchool, office.ID, deliveryContract.NotificationTraegerSchoolClosingDayChanged)
	require.NoError(t, err)

	first := f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-12", "2030-06-12", "Pädagogischer Tag"))

	entries, unread := f.traegerFeed(t, office.ID, own)
	require.Len(t, entries, 2, "the bell holds the entries of every school of the Träger")
	assert.Equal(t, 2, unread)
	assert.Equal(t, "Grundschule Am Hang", entries[1].SchoolName)
	assert.Equal(t, fmt.Sprint(sister), entries[1].SchoolID)
	assert.Equal(t, deliveryContract.NotificationTraegerSchoolClosingDayChanged, entries[0].Type)
	assert.Equal(t, "Neuer Schließtag", entries[0].Title)
	assert.Equal(t, "Am 12.06.2030 ist ein Schließtag: Pädagogischer Tag.", entries[0].Body)
	assert.Equal(t, fmt.Sprintf("/traeger/schulen/%d", school), entries[0].DeepLink)
	assert.Equal(t, fmt.Sprint(school), entries[0].SchoolID)
	assert.Equal(t, "Grundschule Am Bach", entries[0].SchoolName)
	assert.Zero(t, f.pushes(t, office.ID), "the Träger-Portal has no push")

	leitungEntries, _ := f.traegerFeed(t, leitung.accountID, own)
	assert.Empty(t, leitungEntries, "who entered it gets nothing, also as a Träger member")
	strangerEntries, _ := f.traegerFeed(t, stranger.ID, foreign)
	assert.Empty(t, strangerEntries, "another Träger sees nothing of this school")
	notMember, _ := f.traegerFeed(t, stranger.ID, own)
	assert.Empty(t, notMember, "a session at a Träger the account is no member of reads nothing")
	assert.Empty(t, f.entries(t, office.ID, school, "staff"), "the Träger entry stays out of the staff portal")

	// The read state works as in the staff portal.
	second := f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-20", "2030-06-20", "Betriebsausflug"))
	entries, unread = f.traegerFeed(t, office.ID, own)
	require.Len(t, entries, 3)
	assert.Equal(t, 3, unread)
	// The bell pages like the staff portal's: newest first, then the cursor.
	var firstPage, nextPage struct {
		Entries    []traegerFeedEntry `json:"entries"`
		NextCursor *string            `json:"next_cursor"`
	}
	f.traegerFeedCall(t, office.ID, own, http.MethodGet, "/?limit=2", &firstPage)
	require.Len(t, firstPage.Entries, 2)
	require.NotNil(t, firstPage.NextCursor)
	f.traegerFeedCall(t, office.ID, own, http.MethodGet, "/?limit=2&cursor="+*firstPage.NextCursor, &nextPage)
	require.Len(t, nextPage.Entries, 1)
	assert.Nil(t, nextPage.NextCursor)
	assert.Equal(t, entries[2].ID, nextPage.Entries[0].ID)
	var count struct {
		UnreadCount int `json:"unread_count"`
	}
	f.traegerFeedCall(t, office.ID, own, http.MethodPost, fmt.Sprintf("/%d/read", entries[1].ID), &count)
	assert.Equal(t, 2, count.UnreadCount)
	f.traegerFeedCall(t, office.ID, own, http.MethodPost, "/read-all", &count)
	assert.Zero(t, count.UnreadCount)
	entries, unread = f.traegerFeed(t, office.ID, own)
	require.Len(t, entries, 3)
	assert.Zero(t, unread)
	assert.NotNil(t, entries[0].ReadAt)

	// Another Träger cannot mark the entry read.
	token := testpkg.MintTestJWT(t, traegerReaderClaims(stranger.ID, foreign))
	req := testutil.NewAuthenticatedRequest(t, http.MethodPost, fmt.Sprintf("/traeger/notifications/feed/%d/read", entries[0].ID), nil, testutil.WithJWTBearer(token))
	assert.Equal(t, http.StatusNotFound, testutil.ExecuteRequestForTest(t, f.feed, req).Code)

	// A school that switched the type off tells its Träger nothing either.
	testpkg.SetTestTenantSetting(t, f.db, school, "notifications.school_closing_day_enabled", "false")
	f.save(t, leitung, http.MethodDelete, second, "")
	entries, _ = f.traegerFeed(t, office.ID, own)
	assert.Len(t, entries, 3)
	testpkg.SetTestTenantSetting(t, f.db, school, "notifications.school_closing_day_enabled", "true")

	// An ended membership hides the entries on the next read; nothing is
	// deleted, and the ended member gets no new entry.
	_, err = db.ExecContext(context.Background(), `UPDATE platform.organization_accounts SET status = 'inactive', deactivated_at = NOW()
		WHERE organization_id = ? AND account_id = ?`, own, departing.ID)
	require.NoError(t, err)
	f.save(t, leitung, http.MethodDelete, first, "")
	departed, _ := f.traegerFeed(t, departing.ID, own)
	assert.Empty(t, departed)
	var stored int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM platform.notification_feed_entries WHERE account_id = ?`, departing.ID).Scan(context.Background(), &stored))
	assert.Equal(t, 2, stored, "the entries before the end stay until their retention")
}

// N is the number of entries of a Träger member across the schools of its
// Träger (#7146). The page and the unread count, each with the check of the
// membership and the schools of the Träger, are a fixed number of statements
// whatever the bell holds; another member's entries stay out.
func TestTraegerNotificationFeedHTTPQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	own := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger Budget", Slug: fmt.Sprintf("traeger-budget-%d", testpkg.UniqueTestTenantID(t)), Active: true,
	}).ID
	schools := []int64{
		testpkg.CreateTestSchoolInOrganization(t, db, own, "Schule Eins"),
		testpkg.CreateTestSchoolInOrganization(t, db, own, "Schule Zwei"),
	}
	f := newClosingFeedFixtureIn(t, db, schools[0])
	office := testpkg.CreateTestAccount(t, db, "traeger-budget")
	other := testpkg.CreateTestAccount(t, db, "traeger-budget-other")
	testpkg.CreateTestTraegerMember(t, db, own, office.ID, identityaccess.TraegerRoleReadOnly)
	testpkg.CreateTestTraegerMember(t, db, own, other.ID, identityaccess.TraegerRoleReadOnly)
	insert := func(accountID, schoolID int64, objectID int) {
		t.Helper()
		_, err := db.ExecContext(context.Background(), `INSERT INTO platform.notification_feed_entries
			(tenant_id, account_id, type, title, body, deep_link, related_type, related_id)
			VALUES (?, ?, ?, 'Neuer Schließtag', 'Am 12.06.2030 ist ein Schließtag.', '/traeger/schulen/1', 'closing_day', ?)`,
			schoolID, accountID, deliveryContract.NotificationTraegerSchoolClosingDayChanged, objectID)
		require.NoError(t, err)
	}
	insert(other.ID, schools[0], 1)
	token := testpkg.MintTestJWT(t, traegerReaderClaims(office.ID, own))
	counter := testpkg.CaptureQueries(t, db)
	previous, statements := 0, 0
	for _, n := range []int{0, 3, 8} {
		for i := previous; i < n; i++ {
			insert(office.ID, schools[i%2], 100+i)
		}
		counter.Reset()
		req := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/traeger/notifications/feed/", nil, testutil.WithJWTBearer(token))
		rec := testutil.ExecuteRequestForTest(t, f.feed, req)
		counter.Stop()
		querybudgets.AssertQueryBudget(t, "traeger.notifications.feed", counter.Measurement(counter.Queries()))
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

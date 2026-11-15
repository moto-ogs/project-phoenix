package announcement_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/communication"
	announcement "github.com/moto-ogs/project-phoenix/modules/communication/http/parentannouncements"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// fixedLetterChildren stands in for the root's reads of the owners: the
// values a letter names per child.
type fixedLetterChildren map[int64]communication.ParentLetterChild

func (f fixedLetterChildren) ParentLetterChildren(_ context.Context, ids []int64) ([]communication.ParentLetterChild, error) {
	out := []communication.ParentLetterChild{}
	for _, id := range ids {
		if child, ok := f[id]; ok {
			out = append(out, child)
		}
	}
	return out, nil
}

type countingLetterAccess struct{ kinds []string }

func (c *countingLetterAccess) RecordParentLetterAccess(_ context.Context, access communication.ParentLetterAccess) error {
	c.kinds = append(c.kinds, access.Kind)
	return nil
}

// Serienbriefe (#4813) end to end over the database: two families of one
// class get one Elternbrief that names each child. Each family reads only
// its own child's letter, the letters stay as published, the school prints
// all of them as one PDF, and neither a role without the right nor another
// school reaches them.
func TestParentLettersNameEachChildAndStayWithTheirFamily(t *testing.T) {
	t.Parallel()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	ctx := testpkg.Ctx(t)
	organizations, err := owners.NewOrganizationTenancy(database)
	require.NoError(t, err)
	repos := api.NewParentMessagingSuiteRepositories(database).WithSchoolProjections(organizations)
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	require.NoError(t, settings.Settings.SetValue(ctx, "operations.parent_news_enabled", true, nil, nil))
	uploads, err := objects.PrivateUploadsBackend()
	require.NoError(t, err)
	files, _, err := api.NewFileStoreTestModule(database, testpkg.TenantRuntime(t, db), uploads)
	require.NoError(t, err)
	delivery, err := api.NewDeliveryTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)

	lina := testpkg.CreateTestParentGuardianChain(t, db)
	emil := testpkg.CreateTestParentGuardianChain(t, db)
	for _, family := range []struct {
		chain      testpkg.ParentChain
		first, sur string
	}{{lina, "Lina", "Muster"}, {emil, "Emil", "Weber"}} {
		_, err = db.NewRaw(`UPDATE users.persons SET first_name = ?, last_name = ? WHERE id = ?`, family.first, family.sur, family.chain.PersonID).Exec(ctx)
		require.NoError(t, err)
	}
	// Lina's guardian may also pick Emil up, without portal access to him:
	// that link reaches the mail, but not Emil's letter.
	testpkg.CreateTestStudentGuardianLink(t, db, emil.StudentID, lina.GuardianProfileID, "pickup_only")
	values := fixedLetterChildren{
		lina.StudentID: {StudentID: lina.StudentID, FirstName: "Lina", LastName: "Muster", SchoolClass: "1a", Group: "Füchse", PickupTime: "15:30 Uhr"},
		emil.StudentID: {StudentID: emil.StudentID, FirstName: "Emil", LastName: "Weber", SchoolClass: "1a", Group: "Igel"},
	}
	access := &countingLetterAccess{}
	service, err := owners.BuildParentAnnouncements(owners.RootEnvironment{Logger: slog.Default(), Links: owners.ServiceLinks{ParentsURL: "http://localhost"}},
		settings.Settings, delivery.EmailOutbox, delivery.Runtime.Module, delivery.Runtime.EmailOutcomes,
		owners.DeliveryNotifications{Notifier: delivery.Notifications, Preferences: delivery.NotificationPreferences}, repos.MessagingRepositories, files,
		communication.ParentLetters{Children: values, Access: access})
	require.NoError(t, err)

	_, staff := testpkg.CreateTestStaffWithAccount(t, db, "Paula", "Kern")
	admin := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(staff.ID), Sub: staff.Email, TenantID: testpkg.Tenant(t), Roles: []string{"user"}, Permissions: []string{permissions.AdminWildcard}})
	reader := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(staff.ID), Sub: staff.Email, TenantID: testpkg.Tenant(t), Roles: []string{"user"}, Permissions: []string{permissions.UsersRead}})
	foreignTenant, _ := testpkg.CreateTestTenant(t, db)
	_, foreign := testpkg.CreateTestStaffWithAccountForTenant(t, db, foreignTenant, "Fremd", "Schule")
	foreignAdmin := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(foreign.ID), Sub: foreign.Email, TenantID: foreignTenant, Roles: []string{"user"}, Permissions: []string{permissions.AdminWildcard}})

	resource := announcement.NewResource(service, nil)
	resource.Letters = owners.NewParentLetterPrinter()
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/api/parent-announcements", resource.Router(api.ProtectedTenantRoutes))
	send := func(method, path, bearer string, body any) *httptest.ResponseRecorder {
		var reader *bytes.Reader
		if body != nil {
			encoded, err := json.Marshal(body)
			require.NoError(t, err)
			reader = bytes.NewReader(encoded)
		} else {
			reader = bytes.NewReader(nil)
		}
		req := httptest.NewRequest(method, path, reader).WithContext(ctx)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+bearer)
		return testutil.ExecuteRequestForTest(t, router, req)
	}
	letterBody := func(text string) map[string]any {
		return map[string]any{"title": "Sommerfest", "body": text, "delivery_mode": "letter",
			"targets": []map[string]any{{"target_type": "class", "ref_text": "1a"}}}
	}

	// An unknown placeholder is refused while the author writes.
	rec := send(http.MethodPost, "/api/parent-announcements/", admin, letterBody("Hallo {{vorname}}, bitte {{allergien}} angeben."))
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), "communication.letter_placeholder_unknown")
	require.Contains(t, rec.Body.String(), "allergien")

	rec = send(http.MethodPost, "/api/parent-announcements/", admin, letterBody("Liebe Eltern von {{vorname}},\n\n{{vorname}} ist in der Gruppe {{gruppe}}.\nAbholzeit: {{abholzeit}}"))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
	base := "/api/parent-announcements/" + created.Data.ID

	// The preview fills the text for one child; a role without the right
	// and another school get nothing.
	preview := map[string]any{"body": "Hallo {{vorname}} aus der Gruppe {{gruppe}}", "student_id": fmt.Sprint(emil.StudentID)}
	rec = send(http.MethodPost, "/api/parent-announcements/letter-preview", admin, preview)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), "Hallo Emil aus der Gruppe Igel")
	require.Equal(t, http.StatusForbidden, send(http.MethodPost, "/api/parent-announcements/letter-preview", reader, preview).Code)
	require.Equal(t, http.StatusForbidden, send(http.MethodGet, base+"/letters-pdf", reader, nil).Code)
	rec = send(http.MethodGet, "/api/parent-announcements/letter-placeholders", admin, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), `"name":"abholzeit"`)

	// A draft has no letters to print.
	rec = send(http.MethodGet, base+"/letters-pdf", admin, nil)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), "communication.letter_print_not_letter")

	require.Equal(t, http.StatusOK, send(http.MethodPost, base+"/publish", admin, nil).Code)

	// The child's data change after publication; the letter does not.
	values[lina.StudentID] = communication.ParentLetterChild{StudentID: lina.StudentID, FirstName: "Lina", Group: "Bären", PickupTime: "14:00 Uhr"}

	// In the parent feed each family reads its own child's letter only.
	feed := func(accountID int64) *communication.PortalAnnouncementFeedItem {
		var item *communication.PortalAnnouncementFeedItem
		require.NoError(t, testpkg.WithinAdminContext(t, ctx, db, func(c context.Context) error {
			rows, err := repos.ParentAnnouncement.ListFeedForAccount(c, accountID, communication.PortalAnnouncementFeedScope{TenantIDs: []int64{testpkg.Tenant(t)}})
			for _, row := range rows {
				if fmt.Sprint(row.ID) == created.Data.ID {
					item = row
				}
			}
			return err
		}))
		require.NotNil(t, item, "the letter is in the feed of account %d", accountID)
		return item
	}
	linaFeed := feed(lina.AccountID)
	require.Len(t, linaFeed.Letters, 1)
	require.Equal(t, lina.StudentID, linaFeed.Letters[0].StudentID)
	require.Equal(t, "Liebe Eltern von Lina,\n\nLina ist in der Gruppe Füchse.\nAbholzeit: 15:30 Uhr", linaFeed.Body)
	emilFeed := feed(emil.AccountID)
	require.Len(t, emilFeed.Letters, 1)
	require.Equal(t, "Liebe Eltern von Emil,\n\nEmil ist in der Gruppe Igel.", emilFeed.Body)
	require.NotContains(t, emilFeed.Body, "Lina")

	// The mail of each family carries its own child's letter.
	var mails []struct {
		Payload json.RawMessage `bun:"payload"`
	}
	require.NoError(t, db.NewRaw(`SELECT payload FROM platform.email_outbox WHERE related_entity_id = ? ORDER BY id`, created.Data.ID).Scan(ctx, &mails))
	require.Len(t, mails, 2)
	mailTo := map[string]string{}
	for _, mail := range mails {
		var payload struct {
			Body  string `json:"body"`
			Email string `json:"recipient_email"`
		}
		require.NoError(t, json.Unmarshal(mail.Payload, &payload))
		require.NotContains(t, payload.Body, "{{")
		mailTo[payload.Email] = payload.Body
	}
	require.Equal(t, "Liebe Eltern von Lina,\n\nLina ist in der Gruppe Füchse.\nAbholzeit: 15:30 Uhr", mailTo[lina.Email],
		"Lina's guardian reads Lina's letter only, not Emil's, whom they only pick up")
	require.Equal(t, "Liebe Eltern von Emil,\n\nEmil ist in der Gruppe Igel.", mailTo[emil.Email])

	// The school prints every letter of the dispatch as one PDF; another
	// school does not reach it.
	rec = send(http.MethodGet, base+"/letters-pdf", admin, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Equal(t, "application/pdf", rec.Header().Get("Content-Type"))
	require.True(t, bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF")))
	require.Contains(t, rec.Header().Get("Content-Disposition"), "attachment")
	require.Equal(t, http.StatusNotFound, send(http.MethodGet, base+"/letters-pdf", foreignAdmin, nil).Code)
	require.Equal(t, []string{communication.ParentLetterAccessPreview, communication.ParentLetterAccessPublish, communication.ParentLetterAccessPrint}, access.kinds)

	// Unpublishing retracts the letters.
	require.Equal(t, http.StatusOK, send(http.MethodPost, base+"/unpublish", admin, nil).Code)
	var left int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM users.parent_announcement_letter_copies WHERE announcement_id = ?`, created.Data.ID).Scan(ctx, &left))
	require.Zero(t, left)
}

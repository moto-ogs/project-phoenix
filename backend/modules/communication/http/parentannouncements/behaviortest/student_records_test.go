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
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/communication"
	communicationCompose "github.com/moto-ogs/project-phoenix/modules/communication/composition"
	announcement "github.com/moto-ogs/project-phoenix/modules/communication/http/parentannouncements"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// studentAccess remembers each logged read with the child it named.
type studentAccess struct {
	entries []communication.ParentLetterAccess
}

func (a *studentAccess) RecordParentLetterAccess(_ context.Context, access communication.ParentLetterAccess) error {
	a.entries = append(a.entries, access)
	return nil
}

type studentRecordsBody struct {
	Data struct {
		Letters []struct {
			AnnouncementID string  `json:"announcement_id"`
			Title          string  `json:"title"`
			CanConfirm     bool    `json:"can_confirm"`
			AcknowledgedAt *string `json:"acknowledged_at"`
			AcknowledgedBy string  `json:"acknowledged_by"`
		} `json:"letters"`
		Declarations []struct {
			AnnouncementID string `json:"announcement_id"`
			Title          string `json:"title"`
			VersionNo      int    `json:"version_no"`
			State          string `json:"state"`
			Signers        []struct {
				AccountID string `json:"account_id"`
			} `json:"signers"`
		} `json:"declarations"`
	} `json:"data"`
}

// Kinderakte (#4814) end to end over the database: the Dokumente tab of a
// child lists the Elternbriefe that reached it with the child's
// confirmation and the Einverständnisse with their state, read from
// Communication's rows. A role without the right gets 403, another school
// sees nothing of the child, a proof narrows to the child it names, and
// every read is in the access log.
func TestStudentParentRecordsListLettersAndDeclarationsOfOneChild(t *testing.T) {
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
	_, err = db.NewRaw(`UPDATE users.student_school_memberships SET school_class = '1b' WHERE student_profile_id = ?`, emil.StudentID).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewRaw(`UPDATE users.guardian_profiles SET first_name = 'Maria', last_name = 'Muster' WHERE id = ?`, lina.GuardianProfileID).Exec(ctx)
	require.NoError(t, err)

	access := &studentAccess{}
	service, err := owners.BuildParentAnnouncements(owners.RootEnvironment{Logger: slog.Default(), Links: owners.ServiceLinks{ParentsURL: "http://localhost"}},
		settings.Settings, delivery.EmailOutbox, delivery.Runtime.Module, delivery.Runtime.EmailOutcomes,
		owners.DeliveryNotifications{Notifier: delivery.Notifications, Preferences: delivery.NotificationPreferences}, repos.MessagingRepositories, files,
		communicationCompose.ParentLetterPorts{Access: access})
	require.NoError(t, err)

	_, staff := testpkg.CreateTestStaffWithAccount(t, db, "Paula", "Kern")
	admin := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(staff.ID), Sub: staff.Email, TenantID: testpkg.Tenant(t), Roles: []string{"user"}, Permissions: []string{permissions.AdminWildcard}})
	reader := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(staff.ID), Sub: staff.Email, TenantID: testpkg.Tenant(t), Roles: []string{"user"}, Permissions: []string{permissions.UsersRead, permissions.UsersUpdate}})
	foreignTenant, _ := testpkg.CreateTestTenant(t, db)
	_, foreign := testpkg.CreateTestStaffWithAccountForTenant(t, db, foreignTenant, "Fremd", "Schule")
	foreignAdmin := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(foreign.ID), Sub: foreign.Email, TenantID: foreignTenant, Roles: []string{"user"}, Permissions: []string{permissions.AdminWildcard}})

	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/api/parent-announcements", announcement.NewResource(service, nil, time.Now).Router(api.ProtectedTenantRoutes))
	send := func(method, path, bearer string, body any) *httptest.ResponseRecorder {
		encoded := []byte(nil)
		if body != nil {
			encoded, err = json.Marshal(body)
			require.NoError(t, err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(encoded)).WithContext(ctx)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+bearer)
		return testutil.ExecuteRequestForTest(t, router, req)
	}
	publish := func(body map[string]any) string {
		rec := send(http.MethodPost, "/api/parent-announcements/", admin, body)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		var created struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
		rec = send(http.MethodPost, "/api/parent-announcements/"+created.Data.ID+"/publish", admin, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return created.Data.ID
	}
	letter := publish(map[string]any{"title": "Sommerfest", "body": "Liebe Eltern", "delivery_mode": "letter",
		"targets": []map[string]any{{"target_type": "class", "ref_text": "1a"}}})
	consent := publish(map[string]any{"title": "Fotos auf der Website", "body": "Dürfen wir Fotos zeigen?",
		"delivery_mode": "declaration", "declaration_kind": "consent", "declaration_signers": "any",
		"targets": []map[string]any{{"target_type": "school_all"}}})
	// Lina's guardian confirms the letter in the parent portal.
	_, err = db.NewRaw(`INSERT INTO users.parent_announcement_reads (tenant_id, announcement_id, account_id, acknowledged_at)
		VALUES (?, ?, ?, NOW())`, testpkg.Tenant(t), letter, lina.AccountID).Exec(ctx)
	require.NoError(t, err)

	records := func(studentID int64, bearer string) studentRecordsBody {
		rec := send(http.MethodGet, fmt.Sprintf("/api/parent-announcements/students/%d", studentID), bearer, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var body studentRecordsBody
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		return body
	}

	linaRecords := records(lina.StudentID, admin)
	require.Len(t, linaRecords.Data.Letters, 1)
	require.Equal(t, letter, linaRecords.Data.Letters[0].AnnouncementID)
	require.True(t, linaRecords.Data.Letters[0].CanConfirm)
	require.NotNil(t, linaRecords.Data.Letters[0].AcknowledgedAt)
	require.Equal(t, "Maria Muster", linaRecords.Data.Letters[0].AcknowledgedBy)
	require.Len(t, linaRecords.Data.Declarations, 1)
	require.Equal(t, consent, linaRecords.Data.Declarations[0].AnnouncementID)
	require.Equal(t, communication.DeclarationStateOpen, linaRecords.Data.Declarations[0].State)
	require.Equal(t, 1, linaRecords.Data.Declarations[0].VersionNo)
	require.Len(t, linaRecords.Data.Declarations[0].Signers, 1)
	require.Equal(t, fmt.Sprint(lina.AccountID), linaRecords.Data.Declarations[0].Signers[0].AccountID)

	// Emil is in 1b: the class letter did not reach him, the consent did.
	emilRecords := records(emil.StudentID, admin)
	require.Empty(t, emilRecords.Data.Letters)
	require.Len(t, emilRecords.Data.Declarations, 1)

	// A role that reads children but not the school's letters gets 403;
	// another school reads the child's ID and finds nothing.
	require.Equal(t, http.StatusForbidden, send(http.MethodGet, fmt.Sprintf("/api/parent-announcements/students/%d", lina.StudentID), reader, nil).Code)
	foreignRecords := records(lina.StudentID, foreignAdmin)
	require.Empty(t, foreignRecords.Data.Letters)
	require.Empty(t, foreignRecords.Data.Declarations)

	// The proof narrows to the child it names; a child the consent never
	// reached has no proof, and another school reaches no proof at all.
	proof := "/api/parent-announcements/" + consent + "/declaration-export?format=csv"
	rec := send(http.MethodGet, fmt.Sprintf("%s&student_id=%d", proof, lina.StudentID), admin, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Contains(t, rec.Header().Get("Content-Type"), "text/csv")
	require.Contains(t, rec.Header().Get("Content-Disposition"), "nachweis-erklaerung-Felix-Schneider.csv", "the file names the child")
	outsider := testpkg.CreateTestStudentForTenant(t, db, foreignTenant, "Fremdes", "Kind", "1a")
	require.Equal(t, http.StatusNotFound, send(http.MethodGet, fmt.Sprintf("%s&student_id=%d", proof, outsider.ID), admin, nil).Code)
	require.Equal(t, http.StatusBadRequest, send(http.MethodGet, proof+"&student_id=abc", admin, nil).Code)
	require.Equal(t, http.StatusNotFound, send(http.MethodGet, proof, foreignAdmin, nil).Code)
	require.Equal(t, http.StatusForbidden, send(http.MethodGet, proof, reader, nil).Code)
	rec = send(http.MethodGet, proof, admin, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// Every read of a child's record and every proof is in the access log,
	// with the reading account and the child it named. The foreign school's
	// read is logged under its own account.
	var ours []communication.ParentLetterAccess
	for _, entry := range access.entries {
		if entry.ActorAccountID == staff.ID {
			ours = append(ours, entry)
		}
	}
	require.Len(t, ours, 4)
	require.Equal(t, communication.ParentLetterAccessStudentRecords, ours[0].Kind)
	require.Equal(t, lina.StudentID, *ours[0].StudentID)
	require.Equal(t, communication.ParentLetterAccessStudentRecords, ours[1].Kind)
	require.Equal(t, emil.StudentID, *ours[1].StudentID)
	require.Equal(t, communication.ParentLetterAccessDeclarationProof, ours[2].Kind)
	require.Equal(t, lina.StudentID, *ours[2].StudentID)
	require.Equal(t, 1, ours[2].ChildCount)
	require.Equal(t, communication.ParentLetterAccessDeclarationProof, ours[3].Kind)
	require.Nil(t, ours[3].StudentID, "the school's proof names no single child")
	require.Equal(t, 2, ours[3].ChildCount)
}

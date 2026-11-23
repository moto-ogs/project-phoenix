package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	usersAPI "github.com/moto-ogs/project-phoenix/modules/peopledirectory/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The tests in the guardians_composition_* files drive the composed
// /guardians surface (#2663): the People Directory guardian adapter bound to
// the shared renderer, the JWT identity and the legacy-service runtime. They
// are the public HTTP contract goldens of the former api/guardians package
// and run through the real middleware chain (Verifier -> Authenticator ->
// TenantScopeMiddleware -> RequiresPermission -> TenantTxMiddleware).

func init() {
	// Ensure a JWT secret exists so MintTestJWT and Router()'s MustNewTokenAuth
	// agree (no-op when AUTH_JWT_SECRET is already in the environment).
	testutil.SeedTestJWTConfig()
}

// guardianCompositionContext keeps the composed router plus fixture closures;
// the closures capture the database so the test names no persistence type.
type guardianCompositionContext struct {
	router chi.Router
	// createGuardian creates a guardian profile and returns its id and e-mail.
	createGuardian func(emailSeed string) (int64, string)
	// createNamedGuardian creates a guardian profile with the given names.
	createNamedGuardian func(firstName, lastName, emailSeed string) (int64, string)
	// createStudent creates an active student and returns (studentID, personID).
	createStudent func(firstName, lastName, class string) (int64, int64)
	// link inserts a student guardian relationship with the role preset and returns
	// the link id.
	link func(studentID, guardianID int64, role string) int64
	// linkGrantsPortalAccess reads the stored link's parent_portal.access.
	linkGrantsPortalAccess func(linkID int64) bool
	// staffAccount creates a verified staff member and returns the account id.
	staffAccount func(firstName, lastName string) int64
	// teacherAccount creates a teacher with an account and returns
	// (teacherID, accountID).
	teacherAccount func(firstName, lastName string) (int64, int64)
	// account creates a bare account (no staff record) and returns its id.
	account func(emailSeed string) int64
	// assignGroup puts the student into a fresh group supervised by the teacher.
	assignGroup func(studentID, teacherID int64, groupName string)
	// graduate flips the student to alumnus.
	graduate func(studentID int64)
	// softDeletePerson marks the person row deleted.
	softDeletePerson func(personID int64)
	// guardianEmailCount counts the tenant's profiles with that e-mail.
	guardianEmailCount func(email string) int
	// accessLogs counts data-access rows of one resource type in the tenant.
	accessLogs func(resourceType string) int
	// financialChanges returns the audit rows of one guardian as
	// (field_name, new_value, student_id set) triples.
	financialChanges func(guardianID int64) []financialChangeRow
	// foreignTenant creates a second tenant with a student, a guardian and a
	// primary-guardian link and returns (studentID, guardianID, linkID).
	foreignTenant func() (int64, int64, int64)
	// persistedLink reads the stored link's role and flags.
	persistedLink func(linkID int64) persistedLinkState
	// pendingInvitation plants a parent's request to invite the guardian to
	// the student, waiting for staff approval, and returns its id.
	pendingInvitation func(studentID, guardianID, requesterAccountID int64) int64
	// invitationApproval reads the stored approval status of an invitation.
	invitationApproval func(invitationID int64) string
	// count runs a COUNT(*) query that takes one ID in the test tenant's
	// database.
	count func(query string, id int64) int
}

type financialChangeRow struct {
	Field        string
	NewValue     string
	HasStudentID bool
}

type persistedLinkState struct {
	Role               string
	CanPickup          bool
	IsEmergencyContact bool
	PortalAccess       bool
}

func setupGuardiansCompositionRoute(t *testing.T, appEnvs ...string) *guardianCompositionContext {
	t.Helper()
	appEnv := ""
	if len(appEnvs) > 0 {
		appEnv = appEnvs[0]
	}
	db, svc := setupGuardianModule(t)
	resource := NewGuardiansResource(svc.PeopleDirectory, svc.NewGuardianDirectoryRuntime(testpkg.NewDatabase(t, db)), appEnv, slog.Default())

	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/api/guardians", resource.Router())

	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	return &guardianCompositionContext{
		router: router,
		createGuardian: func(emailSeed string) (int64, string) {
			profile := testpkg.CreateTestGuardianProfile(t, db, emailSeed)
			return profile.ID, *profile.Email
		},
		createNamedGuardian: func(firstName, lastName, emailSeed string) (int64, string) {
			profile := testpkg.CreateTestGuardianProfileNamed(t, db, firstName, lastName, emailSeed)
			return profile.ID, *profile.Email
		},
		createStudent: func(firstName, lastName, class string) (int64, int64) {
			student := testpkg.CreateTestStudent(t, db, firstName, lastName, class)
			return student.ID, student.PersonID
		},
		link: func(studentID, guardianID int64, role string) int64 {
			return testpkg.CreateTestStudentGuardianLink(t, db, studentID, guardianID, role).ID
		},
		linkGrantsPortalAccess: func(linkID int64) bool {
			return testpkg.StudentGuardianLinkGrantsPortalAccess(t, db, linkID)
		},
		staffAccount: func(firstName, lastName string) int64 {
			_, account := testpkg.CreateTestStaffWithAccount(t, db, firstName, lastName)
			return account.ID
		},
		teacherAccount: func(firstName, lastName string) (int64, int64) {
			teacher, account := testpkg.CreateTestTeacherWithAccount(t, db, firstName, lastName)
			return teacher.ID, account.ID
		},
		account: func(emailSeed string) int64 {
			return testpkg.CreateTestAccount(t, db, emailSeed).ID
		},
		assignGroup: func(studentID, teacherID int64, groupName string) {
			group := testpkg.CreateTestEducationGroup(t, db, groupName)
			testpkg.CreateTestGroupTeacher(t, db, group.ID, teacherID)
			_, err := db.NewUpdate().TableExpr("users.student_school_memberships").
				Set("group_id = ?", group.ID).
				Where("student_profile_id = ? AND deleted_at IS NULL", studentID).
				Where("tenant_id = ?", tenantID).
				Exec(ctx)
			require.NoError(t, err)
		},
		graduate: func(studentID int64) {
			_, err := db.NewUpdate().TableExpr("users.student_school_memberships").
				Set("status = ?", "alumnus").
				Where("student_profile_id = ? AND deleted_at IS NULL", studentID).
				Where("tenant_id = ?", tenantID).
				Exec(ctx)
			require.NoError(t, err)
		},
		softDeletePerson: func(personID int64) {
			_, err := db.NewUpdate().TableExpr(`users.persons AS "person"`).
				Set("deleted_at = NOW()").
				Where(`"person".id = ?`, personID).
				Exec(ctx)
			require.NoError(t, err)
		},
		guardianEmailCount: func(email string) int {
			count, err := db.NewSelect().
				TableExpr(`users.guardian_profiles AS "guardian_profile"`).
				Where(`"guardian_profile".tenant_id = ?`, tenantID).
				Where(`"guardian_profile".email = ?`, email).
				Count(ctx)
			require.NoError(t, err)
			return int(count)
		},
		accessLogs: func(resourceType string) int {
			count, err := db.NewSelect().
				TableExpr(`audit.data_access_log AS "log"`).
				Where(`"log".tenant_id = ?`, tenantID).
				Where(`"log".resource_type = ?`, resourceType).
				Count(ctx)
			require.NoError(t, err)
			return int(count)
		},
		financialChanges: func(guardianID int64) []financialChangeRow {
			var rows []struct {
				FieldName string `bun:"field_name"`
				NewValue  string `bun:"new_value"`
				StudentID *int64 `bun:"student_id"`
			}
			err := db.NewSelect().
				TableExpr(`audit.guardian_financial_changes AS "guardian_financial_change"`).
				ColumnExpr(`"guardian_financial_change".field_name, "guardian_financial_change".new_value, "guardian_financial_change".student_id`).
				Where(`"guardian_financial_change".tenant_id = ?`, tenantID).
				Where(`"guardian_financial_change".guardian_profile_id = ?`, guardianID).
				Scan(ctx, &rows)
			require.NoError(t, err)
			result := make([]financialChangeRow, 0, len(rows))
			for _, row := range rows {
				result = append(result, financialChangeRow{Field: row.FieldName, NewValue: row.NewValue, HasStudentID: row.StudentID != nil})
			}
			return result
		},
		pendingInvitation: func(studentID, guardianID, requesterAccountID int64) int64 {
			invitation := testpkg.InsertTestGuardianInvitation(t, db, &testpkg.GuardianInvitation{
				Token:                fmt.Sprintf("pending-approval-%d-%d", guardianID, time.Now().UnixNano()),
				GuardianProfileID:    guardianID,
				CreatedBy:            requesterAccountID,
				StudentID:            &studentID,
				RequestedByAccountID: &requesterAccountID,
				ApprovalStatus:       "pending",
			})
			return invitation.ID
		},
		invitationApproval: func(invitationID int64) string {
			return testpkg.GuardianInvitationByID(t, db, invitationID).ApprovalStatus
		},
		foreignTenant: func() (int64, int64, int64) {
			foreignTenantID, _ := testpkg.CreateTestTenant(t, db)
			student := testpkg.CreateTestStudentForTenant(t, db, foreignTenantID, "Foreign", "Child", "1a")
			guardian := testpkg.CreateTestGuardianProfileForTenant(t, db, foreignTenantID, "Foreign", "Guardian", "foreign-guardian")
			link := testpkg.CreateTestStudentGuardianLinkForTenant(t, db, foreignTenantID, student.ID, guardian.ID, "primary_guardian")
			return student.ID, guardian.ID, link.ID
		},
		count: func(query string, id int64) int {
			var n int
			require.NoError(t, db.NewRaw(query, id).Scan(ctx, &n))
			return n
		},
		persistedLink: func(linkID int64) persistedLinkState {
			var row struct {
				Role      string `bun:"guardian_role"`
				CanPickup bool   `bun:"can_pickup"`
				Emergency bool   `bun:"is_emergency_contact"`
			}
			err := testpkg.StudentGuardianLinks(db).
				ColumnExpr(`"student_guardian".guardian_role, "student_guardian".can_pickup, "student_guardian".is_emergency_contact`).
				Where(`"student_guardian".id = ?`, linkID).
				Scan(ctx, &row)
			require.NoError(t, err)
			return persistedLinkState{
				Role: row.Role, CanPickup: row.CanPickup, IsEmergencyContact: row.Emergency,
				PortalAccess: testpkg.StudentGuardianLinkGrantsPortalAccess(t, db, linkID),
			}
		},
	}
}

// bearer mints a signed JWT for claims and returns it as an Authorization
// bearer option.
func bearer(t *testing.T, claims sessiontoken.AppClaims) testutil.RequestOption {
	t.Helper()
	return testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
}

// nonStaffClaims builds an authenticated but non-admin principal for account 1
// (which has no staff record in the test DB). It carries exactly perms so the
// request clears the route's RequiresPermission gate and is then denied by
// the handler's own staff check.
func nonStaffClaims(tb testing.TB, perms ...string) sessiontoken.AppClaims {
	return sessiontoken.AppClaims{
		ID:          1,
		Sub:         "nonstaff@example.com",
		TenantID:    testpkg.Tenant(tb),
		Roles:       []string{"user"},
		Permissions: perms,
	}
}

// withPerms returns a copy of claims narrowed to exactly perms.
func withPerms(claims sessiontoken.AppClaims, perms ...string) sessiontoken.AppClaims {
	claims.Permissions = perms
	return claims
}

// guardianStaffClaims are teacher claims for accountID carrying exactly the
// given permissions.
func guardianStaffClaims(accountID int64, accountPermissions ...string) sessiontoken.AppClaims {
	claims := testutil.TeacherTestClaims(int(accountID))
	claims.Permissions = accountPermissions
	return claims
}

func guardiansPath(format string, args ...any) string {
	return "/api/guardians" + fmt.Sprintf(format, args...)
}

func (c *guardianCompositionContext) do(t *testing.T, claims sessiontoken.AppClaims, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	req := testutil.NewAuthenticatedRequest(t, method, guardiansPath("%s", path), body, bearer(t, claims))
	return testutil.ExecuteRequest(c.router, req)
}

func (c *guardianCompositionContext) status(t *testing.T, claims sessiontoken.AppClaims, method, path string, body any) int {
	t.Helper()
	return c.do(t, claims, method, path, body).Code
}

func errorText(t *testing.T, body string) string {
	t.Helper()
	response := testutil.ParseJSONResponse(t, []byte(body))
	text, ok := response["detail"].(string)
	require.True(t, ok, "expected error text in response: %s", body)
	return text
}

func dataObject(t *testing.T, body []byte) map[string]any {
	t.Helper()
	response := testutil.ParseJSONResponse(t, body)
	data, ok := response["data"].(map[string]any)
	require.True(t, ok, "expected data object in response: %s", string(body))
	return data
}

func dataArray(t *testing.T, body []byte) []any {
	t.Helper()
	response := testutil.ParseJSONResponse(t, body)
	data, ok := response["data"].([]any)
	require.True(t, ok, "expected data array in response: %s", string(body))
	return data
}

// studentGuardianRow is one entry of GET /students/{id}/guardians.
type studentGuardianRow struct {
	Guardian struct {
		ID           wireID  `json:"id"`
		FirstName    string  `json:"first_name"`
		LastName     string  `json:"last_name"`
		Email        *string `json:"email"`
		PhoneNumbers []struct {
			ID          wireID  `json:"id"`
			PhoneNumber string  `json:"phone_number"`
			PhoneType   string  `json:"phone_type"`
			Label       *string `json:"label"`
			IsPrimary   bool    `json:"is_primary"`
		} `json:"phone_numbers"`
	} `json:"guardian"`
	RelationshipID     wireID `json:"relationship_id"`
	GuardianRole       string `json:"guardian_role"`
	CanPickup          bool   `json:"can_pickup"`
	IsEmergencyContact bool   `json:"is_emergency_contact"`
	IsPayer            bool   `json:"is_payer"`
	AccountStatus      string `json:"account_status"`
	Version            string `json:"version"`
}

// studentGuardians reads a child's guardians as an admin holding the
// financial permission so the payer mark is visible.
func (c *guardianCompositionContext) studentGuardians(t *testing.T, studentID int64) []studentGuardianRow {
	t.Helper()
	claims := testutil.AdminTestClaims(999)
	claims.Permissions = append(claims.Permissions, "guardians:financial")
	rr := c.do(t, claims, http.MethodGet, fmt.Sprintf("/students/%d/guardians", studentID), nil)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var response struct {
		Data []studentGuardianRow `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
	return response.Data
}

// entryRow reads the child's row of one guardian as the staff form opens it.
func (c *guardianCompositionContext) entryRow(t *testing.T, studentID, guardianID int64) studentGuardianRow {
	t.Helper()
	for _, row := range c.studentGuardians(t, studentID) {
		if int64(row.Guardian.ID) == guardianID {
			return row
		}
	}
	t.Fatalf("guardian %d is not linked to child %d", guardianID, studentID)
	return studentGuardianRow{}
}

// entryPath is the staff form save of a child's guardian.
func entryPath(studentID, guardianID int64) string {
	return fmt.Sprintf("/students/%d/guardians/%d", studentID, guardianID)
}

// saveEntry saves the staff form of a child's guardian against the version
// the list hands out (ADR 0311).
func (c *guardianCompositionContext) saveEntry(t *testing.T, claims sessiontoken.AppClaims, studentID, guardianID int64, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body["expected_version"] = c.entryRow(t, studentID, guardianID).Version
	return c.do(t, claims, http.MethodPut, entryPath(studentID, guardianID), body)
}

// guardianExists reports whether GET /{id} still finds the guardian.
func (c *guardianCompositionContext) guardianExists(t *testing.T, guardianID int64) bool {
	t.Helper()
	code := c.status(t, testutil.AdminTestClaims(999), http.MethodGet, fmt.Sprintf("/%d", guardianID), nil)
	require.Contains(t, []int{http.StatusOK, http.StatusNotFound}, code)
	return code == http.StatusOK
}

// createLinkedGuardian creates a guardian profile linked to a fresh student
// and returns both IDs plus the link id.
func (c *guardianCompositionContext) createLinkedGuardian(t *testing.T, emailSeed string) (guardianID, studentID, linkID int64) {
	t.Helper()
	guardianID, _ = c.createGuardian(emailSeed)
	studentID, _ = c.createStudent("Linked", "Child", "1a")
	linkID = c.link(studentID, guardianID, "custom")
	return guardianID, studentID, linkID
}

// ===========================================================================
// LIST / GET / CREATE / UPDATE
// ===========================================================================

func TestGuardianComposition_GetGuardianNotFoundAndInvalidID(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)

	testutil.AssertNotFound(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodGet, "/99999", nil))
	testutil.AssertBadRequest(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodGet, "/invalid", nil))
}

func TestGuardianComposition_CreateGuardian(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)

	t.Run("admin creates a full profile", func(t *testing.T) {
		rr := ctx.do(t, admin, http.MethodPost, "/", map[string]any{
			"first_name":               fmt.Sprintf("TestGuardian-%d", testpkg.UniqueSuffix()),
			"last_name":                "Test",
			"email":                    fmt.Sprintf("guardian-%d@test.com", testpkg.UniqueSuffix()),
			"preferred_contact_method": "email",
			"language_preference":      "de",
		})
		testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
		assert.NotZero(t, dataObject(t, rr.Body.Bytes())["id"])
	})

	t.Run("non-staff with users:create is forbidden", func(t *testing.T) {
		rr := ctx.do(t, nonStaffClaims(t, "users:create"), http.MethodPost, "/", map[string]any{
			"first_name": "Test", "last_name": "Guardian", "email": "test@test.com",
			"preferred_contact_method": "email", "language_preference": "de",
		})
		testutil.AssertForbidden(t, rr)
	})

	// Guardian names are optional (CSV imports may only carry a relationship
	// type) and phone numbers are added separately.
	for name, body := range map[string]map[string]any{
		"missing first name": {"last_name": "Test", "email": fmt.Sprintf("no-firstname-%d@test.com", testpkg.UniqueSuffix()), "preferred_contact_method": "email", "language_preference": "de"},
		"missing last name":  {"first_name": "Test", "email": fmt.Sprintf("no-lastname-%d@test.com", testpkg.UniqueSuffix()), "preferred_contact_method": "email", "language_preference": "de"},
		"without contact":    {"first_name": fmt.Sprintf("NoContact-%d", testpkg.UniqueSuffix()), "last_name": "Guardian", "preferred_contact_method": "email", "language_preference": "de"},
	} {
		t.Run(name, func(t *testing.T) {
			testutil.AssertSuccessResponse(t, ctx.do(t, admin, http.MethodPost, "/", body), http.StatusCreated)
		})
	}
}

func TestGuardianComposition_CreateGuardianDuplicateEmailIsBadRequest(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	_, email := ctx.createGuardian("duplicate")

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodPost, "/", map[string]any{
		"first_name": "Second", "last_name": "Person", "email": email,
	})
	testutil.AssertBadRequest(t, rr)
	assert.Contains(t, errorText(t, rr.Body.String()), "bereits vergeben")
	// The form explains the duplicate through its own code (#2517).
	assert.Contains(t, rr.Body.String(), `"code":"`+"students.guardian_email_taken"+`"`)
	assert.Equal(t, 1, ctx.guardianEmailCount(email))
}

func TestGuardianComposition_UpdateGuardian(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)
	body := func() map[string]any { return map[string]any{"guardian": map[string]any{"first_name": "Updated"}} }
	guardianID, studentID, _ := ctx.createLinkedGuardian(t, "update-me")

	testutil.AssertForbidden(t, ctx.do(t, nonStaffClaims(t, "users:update"), http.MethodPut, entryPath(studentID, guardianID), body()))
	missing := body()
	missing["expected_version"] = "any"
	testutil.AssertNotFound(t, ctx.do(t, admin, http.MethodPut, entryPath(studentID, 99999), missing))
	testutil.AssertBadRequest(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodPut, fmt.Sprintf("/students/%d/guardians/invalid", studentID), body()))

	read := ctx.entryRow(t, studentID, guardianID).Version
	rr := ctx.saveEntry(t, admin, studentID, guardianID, body())
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	data := dataObject(t, rr.Body.Bytes())
	guardian := data["guardian"].(map[string]any)
	assert.Equal(t, "Updated", guardian["first_name"])
	assert.Equal(t, "Test", guardian["last_name"], "fields left out of the partial update keep their value")
	assert.NotEqual(t, read, data["version"], "the save answers the version of the stored row")
	assert.Equal(t, ctx.entryRow(t, studentID, guardianID).Version, data["version"], "the answered version is the one the list hands out")
}

// A staff form opened before a colleague's save is refused with the read-state
// code and writes nothing: no profile, link or phone change (ADR 0311). An
// empty version is refused too.
func TestGuardianComposition_EntryRefusesAStaleVersion(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)
	guardianID, studentID, _ := ctx.createLinkedGuardian(t, "stale-entry")
	openedRow := ctx.entryRow(t, studentID, guardianID)
	opened := openedRow.Version

	// A colleague adds a phone number meanwhile.
	rr := ctx.do(t, admin, http.MethodPost, fmt.Sprintf("/%d/phone-numbers", guardianID), map[string]any{"phone_number": "+49 30 1234567"})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())

	stale := map[string]any{
		"guardian":         map[string]any{"first_name": "Alt"},
		"relationship":     map[string]any{"is_emergency_contact": !openedRow.IsEmergencyContact},
		"phone_numbers":    []map[string]any{{"phone_number": "+49 40 7654321", "is_primary": true}},
		"expected_version": opened,
	}
	rr = ctx.do(t, admin, http.MethodPut, entryPath(studentID, guardianID), stale)
	require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"code":"`+readstate.ChangedCode+`"`)
	stored := ctx.entryRow(t, studentID, guardianID)
	assert.Equal(t, "Guardian", stored.Guardian.FirstName, "a refused save writes no profile field")
	assert.Equal(t, openedRow.IsEmergencyContact, stored.IsEmergencyContact, "a refused save writes no link field")
	require.Len(t, stored.Guardian.PhoneNumbers, 1, "a refused save leaves the colleague's phone list")
	assert.Equal(t, "+49 30 1234567", stored.Guardian.PhoneNumbers[0].PhoneNumber)

	delete(stale, "expected_version")
	rr = ctx.do(t, admin, http.MethodPut, entryPath(studentID, guardianID), stale)
	require.Equal(t, http.StatusConflict, rr.Code, "a save without a read version is refused")

	stale["expected_version"] = stored.Version
	testutil.AssertSuccessResponse(t, ctx.do(t, admin, http.MethodPut, entryPath(studentID, guardianID), stale), http.StatusOK)
	saved := ctx.entryRow(t, studentID, guardianID)
	assert.Equal(t, "Alt", saved.Guardian.FirstName)
	assert.Equal(t, !openedRow.IsEmergencyContact, saved.IsEmergencyContact)
	require.Len(t, saved.Guardian.PhoneNumbers, 1, "the saved list replaces the stored one")
	assert.Equal(t, "+49 40 7654321", saved.Guardian.PhoneNumbers[0].PhoneNumber)
}

// Profile, link and phones are one unit of work: a phone the save may not
// touch refuses the whole save, including the profile field written first.
func TestGuardianComposition_EntryWritesNothingOnARefusedPhone(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)
	guardianID, studentID, _ := ctx.createLinkedGuardian(t, "entry-atomic")
	_, foreignPhoneID, _ := ctx.createGuardianWithPhones(t)

	rr := ctx.saveEntry(t, admin, studentID, guardianID, map[string]any{
		"guardian":      map[string]any{"first_name": "Halb"},
		"phone_numbers": []map[string]any{{"id": fmt.Sprint(foreignPhoneID), "phone_number": "+49 30 999999"}},
	})
	testutil.AssertBadRequest(t, rr)
	assert.Equal(t, "Guardian", ctx.entryRow(t, studentID, guardianID).Guardian.FirstName, "the profile write rolls back with the refused phone")
}

// The single-field edits the staff form used before ADR 0311 carry no read
// state: they answer the read-state refusal and write nothing, so a tab from
// before the release reloads (#7953 removes them).
func TestGuardianComposition_DeprecatedSingleEditsAreRefused(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)
	guardianID, phoneID, _ := ctx.createGuardianWithPhones(t)
	studentID, _ := ctx.createStudent("Deprecated", "Edits", "1a")
	linkID := ctx.link(studentID, guardianID, "pickup_only")
	before := ctx.entryRow(t, studentID, guardianID)

	for _, tc := range []struct{ method, path string }{
		{http.MethodPut, fmt.Sprintf("/%d", guardianID)},
		{http.MethodPut, fmt.Sprintf("/relationships/%d", linkID)},
		{http.MethodPut, fmt.Sprintf("/%d/phone-numbers/%d", guardianID, phoneID)},
		{http.MethodDelete, fmt.Sprintf("/%d/phone-numbers/%d", guardianID, phoneID)},
		{http.MethodPost, fmt.Sprintf("/%d/phone-numbers/%d/set-primary", guardianID, phoneID)},
	} {
		rr := ctx.do(t, admin, tc.method, tc.path, map[string]any{"first_name": "Alt", "guardian_role": "primary_guardian", "phone_number": "+49 1 2345"})
		require.Equal(t, http.StatusConflict, rr.Code, "%s %s: %s", tc.method, tc.path, rr.Body.String())
		assert.Contains(t, rr.Body.String(), `"code":"`+readstate.ChangedCode+`"`)
	}
	assert.Equal(t, before.Version, ctx.entryRow(t, studentID, guardianID).Version, "no refused edit wrote anything")
}

// Staff remove a wrong address by emptying the field (#7770): the profile
// stores NULL, so a second cleared profile does not collide on the
// tenant-unique e-mail index.
func TestGuardianComposition_UpdateGuardianClearsEmail(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)

	for _, seed := range []string{"clear-first", "clear-second"} {
		guardianID, studentID, _ := ctx.createLinkedGuardian(t, seed)
		rr := ctx.saveEntry(t, admin, studentID, guardianID, map[string]any{"guardian": map[string]any{"email": ""}})
		testutil.AssertSuccessResponse(t, rr, http.StatusOK)
		assert.Nil(t, dataObject(t, rr.Body.Bytes())["guardian"].(map[string]any)["email"])
		assert.Equal(t, 1, ctx.count(`SELECT COUNT(*) FROM users.guardian_profiles WHERE id = ? AND email IS NULL`, guardianID))
	}
}

// Model validation failures are user input, not server faults: they must
// render as 400 with the German reason instead of a Sentry-reported 500 (#3549).
func TestGuardianComposition_InvalidContactIsBadRequest(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)
	guardianID, phoneID, _ := ctx.createGuardianWithPhones(t)
	studentID, _ := ctx.createStudent("Invalid", "Contact", "1a")
	ctx.link(studentID, guardianID, "custom")
	phone := func(number string) map[string]any {
		return map[string]any{"phone_numbers": []map[string]any{{"id": fmt.Sprint(phoneID), "phone_number": number}}}
	}

	for _, tc := range []struct {
		name, method, path string
		body               map[string]any
		reason             string
	}{
		{"update with invalid email", http.MethodPut, "", map[string]any{"guardian": map[string]any{"email": "not-an-email"}}, "ungültiges E-Mail-Format"},
		{"update with invalid contact method", http.MethodPut, "", map[string]any{"guardian": map[string]any{"preferred_contact_method": "fax"}}, "ungültige bevorzugte Kontaktmethode"},
		{"create with invalid email", http.MethodPost, "/", map[string]any{"first_name": "Invalid", "last_name": "Email", "email": "not-an-email"}, "ungültiges E-Mail-Format"},
		{"add phone with invalid format", http.MethodPost, fmt.Sprintf("/%d/phone-numbers", guardianID), map[string]any{"phone_number": "abc"}, "ungültiges Telefonnummer-Format"},
		{"add blank phone", http.MethodPost, fmt.Sprintf("/%d/phone-numbers", guardianID), map[string]any{"phone_number": "   "}, "Telefonnummer ist erforderlich"},
		{"update phone with invalid format", http.MethodPut, "", phone("abc"), "ungültiges Telefonnummer-Format"},
		{"update phone with too few digits", http.MethodPut, "", phone("12"), "Telefonnummer muss mindestens 3 Ziffern enthalten"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var rr *httptest.ResponseRecorder
			if tc.path == "" {
				// The staff form saves the guardian as one entry (ADR 0311).
				rr = ctx.saveEntry(t, admin, studentID, guardianID, tc.body)
			} else {
				rr = ctx.do(t, admin, tc.method, tc.path, tc.body)
			}
			testutil.AssertBadRequest(t, rr)
			assert.Equal(t, tc.reason, errorText(t, rr.Body.String()))
		})
	}
}

// ===========================================================================
// DELETE
// ===========================================================================

func TestGuardianComposition_DeleteGuardianGates(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)

	testutil.AssertForbidden(t, ctx.do(t, nonStaffClaims(t, "users:delete"), http.MethodDelete, "/99999", nil))
	testutil.AssertNotFound(t, ctx.do(t, testutil.AdminTestClaims(999), http.MethodDelete, "/99999", nil))
	testutil.AssertBadRequest(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodDelete, "/invalid", nil))
	testutil.AssertNotFound(t, ctx.do(t, testutil.AdminTestClaims(999), http.MethodGet, "/99999/delete-preview", nil))
}

func TestGuardianComposition_DeletePreviewIncludesAffectedLinkIDs(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	guardianID, _, linkID := ctx.createLinkedGuardian(t, "delete-preview")

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodGet, fmt.Sprintf("/%d/delete-preview", guardianID), nil)
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	data := dataObject(t, rr.Body.Bytes())
	assert.Equal(t, float64(1), data["linked_count"])
	assert.Len(t, data["affected_names"], 1)
	assert.Equal(t, []any{fmt.Sprintf("%d", linkID)}, data["affected_link_ids"], "link ids travel as strings")
	assert.Contains(t, data["warning"], "nur mit diesem Kind")

	t.Run("non-admin may not preview", func(t *testing.T) {
		accountID := ctx.staffAccount("Preview", "Staff")
		testutil.AssertForbidden(t, ctx.do(t, guardianStaffClaims(accountID, "users:delete"), http.MethodGet, fmt.Sprintf("/%d/delete-preview", guardianID), nil))
	})
}

// A guardian that is still linked to a student is refused without
// ?force=true (409) rather than silently unlinking siblings (#819).
func TestGuardianComposition_DeleteLinkedGuardianConflict(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	guardianID, _, _ := ctx.createLinkedGuardian(t, "delete-conflict")
	siblingID, _ := ctx.createStudent("Linked", "Sibling", "1a")
	ctx.link(siblingID, guardianID, "custom")

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodDelete, fmt.Sprintf("/%d", guardianID), nil)
	testutil.AssertErrorResponse(t, rr, http.StatusConflict)
	assert.Contains(t, errorText(t, rr.Body.String()), "Linked Child")
	assert.True(t, ctx.guardianExists(t, guardianID), "guardian must survive the refused delete")
}

func TestGuardianComposition_DeleteLinkedGuardianNonAdminConflictHidesNames(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	teacherID, accountID := ctx.teacherAccount("Delete", "Supervisor")
	guardianID, _ := ctx.createGuardian("delete-privacy")
	studentID, _ := ctx.createStudent("Private", "Child", "1a")
	ctx.assignGroup(studentID, teacherID, "DeletePrivacy")
	ctx.link(studentID, guardianID, "custom")

	rr := ctx.do(t, withPerms(testutil.TeacherTestClaims(int(accountID)), "users:delete"), http.MethodDelete, fmt.Sprintf("/%d", guardianID), nil)
	testutil.AssertErrorResponse(t, rr, http.StatusConflict)
	text := errorText(t, rr.Body.String())
	assert.Contains(t, text, "Noch mit Kindern verknüpft")
	assert.NotContains(t, text, "Private")
	assert.NotContains(t, text, "Child")
}

func TestGuardianComposition_ForceDeleteByAdminRemovesGuardianAndLinks(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	guardianID, studentID, linkID := ctx.createLinkedGuardian(t, "delete-force")

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodDelete, fmt.Sprintf("/%d?force=true&expected_link_ids=%d", guardianID, linkID), nil)
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	assert.False(t, ctx.guardianExists(t, guardianID), "guardian is gone")
	assert.Empty(t, ctx.studentGuardians(t, studentID), "the link is gone with it")
}

func TestGuardianComposition_ForceDeleteRejectsStalePreview(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	guardianID, _, _ := ctx.createLinkedGuardian(t, "delete-force-stale")

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodDelete, fmt.Sprintf("/%d?force=true&expected_link_ids=999999", guardianID), nil)
	testutil.AssertErrorResponse(t, rr, http.StatusConflict)
	// The read-state code lets the dialog read the new link set (ADR 0311).
	assert.Contains(t, rr.Body.String(), `"code":"`+readstate.ChangedCode+`"`)
	assert.True(t, ctx.guardianExists(t, guardianID))

	t.Run("malformed expected ids are a bad request", func(t *testing.T) {
		rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodDelete, fmt.Sprintf("/%d?force=true&expected_link_ids=abc", guardianID), nil)
		testutil.AssertBadRequest(t, rr)
	})
}

// A non-admin supervisor cannot full-delete a linked guardian even with
// ?force=true: the blast radius reaches siblings they may not supervise.
func TestGuardianComposition_ForceDeleteByNonAdminIsForbidden(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	teacherID, accountID := ctx.teacherAccount("Force", "Supervisor")
	guardianID, _ := ctx.createGuardian("force-forbidden")
	studentID, _ := ctx.createStudent("Force", "Child", "1a")
	ctx.assignGroup(studentID, teacherID, "ForceForbidden")
	ctx.link(studentID, guardianID, "custom")

	rr := ctx.do(t, withPerms(testutil.TeacherTestClaims(int(accountID)), "users:delete"), http.MethodDelete, fmt.Sprintf("/%d?force=true", guardianID), nil)
	testutil.AssertErrorResponse(t, rr, http.StatusForbidden)
	assert.True(t, ctx.guardianExists(t, guardianID))
}

// ===========================================================================
// SPECIAL LISTS AND INVITATIONS
// ===========================================================================

func TestGuardianComposition_SendInvitationGates(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)

	testutil.AssertBadRequest(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodPost, "/invalid/invite", nil))

	// Without an Authorization header the Verifier/Authenticator rejects the
	// request before the handler runs.
	req := testutil.NewJSONRequest(t, http.MethodPost, guardiansPath("/1/invite"), nil)
	testutil.AssertUnauthorized(t, testutil.ExecuteRequest(ctx.router, req))
}

func TestGuardianComposition_SeedTokenHeaderDoesNotExposeTokenOutsideLocalDev(t *testing.T) {
	t.Parallel()
	for _, appEnv := range []string{"production", "staging", "preview", "developement", ""} {
		t.Run(fmt.Sprintf("app_env=%q", appEnv), func(t *testing.T) {
			t.Parallel()
			ctx := setupGuardiansCompositionRoute(t, appEnv)
			guardianID, _ := ctx.createGuardian("invite-" + appEnv)
			studentID, _ := ctx.createStudent("Seed", "Kind", "1a")
			ctx.link(studentID, guardianID, "primary_guardian")

			req := testutil.NewAuthenticatedRequest(t, http.MethodPost, guardiansPath("/%d/invite", guardianID), nil,
				bearer(t, withPerms(testutil.DefaultTestClaims(), "users:create")))
			req.Header.Set("X-Phoenix-Seed-Token", "true")
			rr := testutil.ExecuteRequest(ctx.router, req)

			testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
			data := dataObject(t, rr.Body.Bytes())
			assert.NotZero(t, data["id"])
			assert.NotContains(t, data, "token")
		})
	}
}

func TestGuardianComposition_SeedTokenExposedForLocalSeeder(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t, "development")
	guardianID, _ := ctx.createGuardian("invite-local")
	studentID, _ := ctx.createStudent("Seed", "Kind", "1a")
	ctx.link(studentID, guardianID, "primary_guardian")

	req := testutil.NewAuthenticatedRequest(t, http.MethodPost, guardiansPath("/%d/invite", guardianID), nil,
		bearer(t, withPerms(testutil.DefaultTestClaims(), "users:create")))
	req.Header.Set("X-Phoenix-Seed-Token", "true")
	req.Host = "localhost:8080"
	rr := testutil.ExecuteRequest(ctx.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
	assert.NotEmpty(t, dataObject(t, rr.Body.Bytes())["token"], "the local seeder receives the raw token")
}

// ===========================================================================
// RELATIONSHIPS
// ===========================================================================

func TestGuardianComposition_StudentGuardianReads(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	studentID, _ := ctx.createStudent("Guardian", "TestStudent", "1a")

	rr := ctx.do(t, testutil.DefaultTestClaims(), http.MethodGet, fmt.Sprintf("/students/%d/guardians", studentID), nil)
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	assert.Empty(t, dataArray(t, rr.Body.Bytes()))

	testutil.AssertBadRequest(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodGet, "/students/invalid/guardians", nil))
}

func TestGuardianComposition_AccountStatusReflectsPortalAccess(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	studentID, _ := ctx.createStudent("Status", "Child", "1a")
	contactID, _ := ctx.createGuardian("status-contact")
	ctx.link(studentID, contactID, "pickup_only")

	rows := ctx.studentGuardians(t, studentID)
	require.Len(t, rows, 1)
	assert.Equal(t, "none", rows[0].AccountStatus, "no account, no invitation")
	assert.Equal(t, "pickup_only", rows[0].GuardianRole)
}

func TestGuardianComposition_AlumnusIsRejected(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	studentID, _ := ctx.createStudent("Former", "Student", "4a")
	ctx.graduate(studentID)

	testutil.AssertNotFound(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodGet, fmt.Sprintf("/students/%d/guardians", studentID), nil))
	testutil.AssertForbidden(t, ctx.do(t, testutil.AdminTestClaims(999), http.MethodPost, fmt.Sprintf("/students/%d/guardians", studentID), map[string]any{}))
}

func TestGuardianComposition_LinkGuardianValidation(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)

	testutil.AssertForbidden(t, ctx.do(t, nonStaffClaims(t, "users:update"), http.MethodPost, "/students/1/guardians", map[string]any{
		"guardian_profile_id": 1, "relationship_type": "parent", "is_primary": true,
		"is_emergency_contact": true, "can_pickup": true, "emergency_priority": 1,
	}))
	testutil.AssertBadRequest(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodPost, "/students/invalid/guardians", map[string]any{
		"guardian_profile_id": 1, "relationship_type": "parent", "emergency_priority": 1,
	}))

	studentID, _ := ctx.createStudent("Link", "TestStudent", "1a")
	for name, body := range map[string]map[string]any{
		"missing guardian id":        {"relationship_type": "parent", "emergency_priority": 1},
		"missing relationship type":  {"guardian_profile_id": 1, "emergency_priority": 1},
		"invalid emergency priority": {"guardian_profile_id": 1, "relationship_type": "parent", "emergency_priority": 0},
	} {
		t.Run(name, func(t *testing.T) {
			testutil.AssertBadRequest(t, ctx.do(t, admin, http.MethodPost, fmt.Sprintf("/students/%d/guardians", studentID), body))
		})
	}
}

func TestGuardianComposition_LinkGuardianEchoesTheStoredLink(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	guardianID, _ := ctx.createGuardian("link-echo")
	studentID, _ := ctx.createStudent("Link", "Echo", "1a")

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodPost, fmt.Sprintf("/students/%d/guardians", studentID), map[string]any{
		"guardian_profile_id": guardianID, "relationship_type": "parent", "guardian_role": "primary_guardian",
		"is_primary": true, "can_pickup": true, "emergency_priority": 1,
	})
	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
	data := dataObject(t, rr.Body.Bytes())
	assert.Equal(t, int64(studentID), testpkg.JSONID(t, data["student_id"]))
	assert.Equal(t, int64(guardianID), testpkg.JSONID(t, data["guardian_profile_id"]))
	assert.Equal(t, "primary_guardian", data["guardian_role"])
	assert.Equal(t, true, data["can_pickup"])
	permissions, ok := data["permissions"].(map[string]any)
	require.True(t, ok, "the stored link carries its portal permissions: %s", rr.Body.String())
	assert.Equal(t, true, permissions["parent_portal.access"])

	// Re-linking is idempotent and returns the existing link unchanged.
	rr = ctx.do(t, testutil.AdminTestClaims(999), http.MethodPost, fmt.Sprintf("/students/%d/guardians", studentID), map[string]any{
		"guardian_profile_id": guardianID, "relationship_type": "parent", "guardian_role": "pickup_only", "emergency_priority": 1,
	})
	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
	assert.Equal(t, "primary_guardian", dataObject(t, rr.Body.Bytes())["guardian_role"])
}

func TestGuardianComposition_RelationshipUpdateGates(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	body := map[string]any{"relationship": map[string]any{"is_primary": true}, "expected_version": "any"}
	studentID, _ := ctx.createStudent("Gate", "Child", "1a")
	unlinkedID, _ := ctx.createGuardian("unlinked-entry")

	testutil.AssertBadRequest(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodPut, "/students/invalid/guardians/1", body))
	// A guardian not linked to the child has no entry to save.
	testutil.AssertNotFound(t, ctx.do(t, testutil.AdminTestClaims(999), http.MethodPut, entryPath(studentID, unlinkedID), body))
}

func TestGuardianComposition_RemoveGuardianGates(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)

	testutil.AssertForbidden(t, ctx.do(t, nonStaffClaims(t, "users:update"), http.MethodDelete, "/students/1/guardians/1", nil))
	testutil.AssertBadRequest(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodDelete, "/students/invalid/guardians/1", nil))
	testutil.AssertBadRequest(t, ctx.do(t, testutil.DefaultTestClaims(), http.MethodDelete, "/students/1/guardians/invalid", nil))
}

// ===========================================================================
// PHONE NUMBERS
// ===========================================================================

// createGuardianWithPhones creates a guardian through the API with a primary
// and a secondary phone number.
func (c *guardianCompositionContext) createGuardianWithPhones(t *testing.T) (guardianID, phone1ID, phone2ID int64) {
	t.Helper()
	admin := testutil.AdminTestClaims(999)
	rr := c.do(t, admin, http.MethodPost, "/", map[string]any{
		"first_name":               fmt.Sprintf("TestGuardian-%d", testpkg.UniqueSuffix()),
		"last_name":                "PhoneTest",
		"email":                    fmt.Sprintf("phone-%d@test.com", testpkg.UniqueSuffix()),
		"preferred_contact_method": "phone",
		"language_preference":      "de",
	})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	guardianID = testpkg.JSONID(t, dataObject(t, rr.Body.Bytes())["id"])

	rr = c.do(t, admin, http.MethodPost, fmt.Sprintf("/%d/phone-numbers", guardianID), map[string]any{
		"phone_number": "+49 123 456789", "phone_type": "mobile", "is_primary": true,
	})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	phone1ID = testpkg.JSONID(t, dataObject(t, rr.Body.Bytes())["id"])

	rr = c.do(t, admin, http.MethodPost, fmt.Sprintf("/%d/phone-numbers", guardianID), map[string]any{
		"phone_number": "+49 987 654321", "phone_type": "work", "is_primary": false,
	})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	phone2ID = testpkg.JSONID(t, dataObject(t, rr.Body.Bytes())["id"])
	return guardianID, phone1ID, phone2ID
}

func TestGuardianComposition_ListPhoneNumbers(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	guardianID, _, _ := ctx.createGuardianWithPhones(t)
	reader := withPerms(testutil.DefaultTestClaims(), "users:read")

	rr := ctx.do(t, reader, http.MethodGet, fmt.Sprintf("/%d/phone-numbers", guardianID), nil)
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	assert.Len(t, dataArray(t, rr.Body.Bytes()), 2)

	testutil.AssertBadRequest(t, ctx.do(t, reader, http.MethodGet, "/invalid/phone-numbers", nil))

	emptyID, _ := ctx.createGuardian("no-phone")
	rr = ctx.do(t, reader, http.MethodGet, fmt.Sprintf("/%d/phone-numbers", emptyID), nil)
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	assert.Empty(t, dataArray(t, rr.Body.Bytes()))
}

func TestGuardianComposition_AddPhoneNumber(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)
	guardianID, _ := ctx.createGuardian("add-phone")

	rr := ctx.do(t, admin, http.MethodPost, fmt.Sprintf("/%d/phone-numbers", guardianID), map[string]any{
		"phone_number": "+49 123 456789", "phone_type": "mobile", "label": "Personal", "is_primary": true,
	})
	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
	data := dataObject(t, rr.Body.Bytes())
	assert.Equal(t, "+49 123 456789", data["phone_number"])
	assert.Equal(t, "mobile", data["phone_type"])
	assert.Equal(t, "Personal", data["label"])
	assert.Equal(t, true, data["is_primary"])

	t.Run("defaults the type to mobile", func(t *testing.T) {
		rr := ctx.do(t, admin, http.MethodPost, fmt.Sprintf("/%d/phone-numbers", guardianID), map[string]any{
			"phone_number": "+49 123 456780", "is_primary": false,
		})
		testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
		assert.Equal(t, "mobile", dataObject(t, rr.Body.Bytes())["phone_type"])
	})

	testutil.AssertForbidden(t, ctx.do(t, nonStaffClaims(t, "users:update"), http.MethodPost, "/1/phone-numbers", map[string]any{"phone_number": "+49 123 456789"}))
	testutil.AssertBadRequest(t, ctx.do(t, admin, http.MethodPost, "/invalid/phone-numbers", map[string]any{"phone_number": "+49 123 456789"}))
	testutil.AssertBadRequest(t, ctx.do(t, admin, http.MethodPost, fmt.Sprintf("/%d/phone-numbers", guardianID), map[string]any{"phone_type": "mobile"}))
	testutil.AssertBadRequest(t, ctx.do(t, admin, http.MethodPost, fmt.Sprintf("/%d/phone-numbers", guardianID), map[string]any{"phone_number": "+49 1", "phone_type": "invalid_type"}))
}

// phoneEntry is one number of a saved phone list.
func phoneEntry(id int64, number, kind string, primary bool) map[string]any {
	entry := map[string]any{"phone_number": number, "phone_type": kind, "is_primary": primary}
	if id != 0 {
		entry["id"] = fmt.Sprint(id)
	}
	return entry
}

// linkedGuardianWithPhones is createGuardianWithPhones linked to a fresh child.
func (c *guardianCompositionContext) linkedGuardianWithPhones(t *testing.T) (guardianID, studentID, phone1ID, phone2ID int64) {
	t.Helper()
	guardianID, phone1ID, phone2ID = c.createGuardianWithPhones(t)
	studentID, _ = c.createStudent("Phone", "Child", "1a")
	c.link(studentID, guardianID, "custom")
	return guardianID, studentID, phone1ID, phone2ID
}

// The staff form changes a stored number through the saved list.
func TestGuardianComposition_UpdatePhoneNumber(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)
	guardianID, studentID, phone1ID, phone2ID := ctx.linkedGuardianWithPhones(t)
	list := func(phone1 map[string]any) map[string]any {
		return map[string]any{"phone_numbers": []map[string]any{phone1, phoneEntry(phone2ID, "+49 987 654321", "work", false)}}
	}

	updated := phoneEntry(phone1ID, "+49 111 222333", "home", true)
	updated["label"] = "Updated Label"
	testutil.AssertSuccessResponse(t, ctx.saveEntry(t, admin, studentID, guardianID, list(updated)), http.StatusOK)
	phones := ctx.entryRow(t, studentID, guardianID).Guardian.PhoneNumbers
	require.Len(t, phones, 2)
	assert.Equal(t, wireID(phone1ID), phones[0].ID)
	assert.Equal(t, "+49 111 222333", phones[0].PhoneNumber)
	assert.Equal(t, "home", phones[0].PhoneType)
	require.NotNil(t, phones[0].Label)
	assert.Equal(t, "Updated Label", *phones[0].Label)
	assert.True(t, phones[0].IsPrimary, "a number keeps its primary mark")

	testutil.AssertBadRequest(t, ctx.saveEntry(t, admin, studentID, guardianID, list(phoneEntry(phone1ID, "", "mobile", true))))
	testutil.AssertBadRequest(t, ctx.saveEntry(t, admin, studentID, guardianID, list(phoneEntry(phone1ID, "+49 111 222333", "invalid_type", true))))
	// A number that is not stored for this guardian is no part of its list.
	testutil.AssertBadRequest(t, ctx.saveEntry(t, admin, studentID, guardianID, list(phoneEntry(99999, "+49 111 222333", "mobile", true))))
	testutil.AssertForbidden(t, ctx.saveEntry(t, nonStaffClaims(t, "users:update"), studentID, guardianID, list(updated)))

	t.Run("a phone of another guardian is refused", func(t *testing.T) {
		_, _, otherPhoneID, _ := ctx.linkedGuardianWithPhones(t)
		testutil.AssertBadRequest(t, ctx.saveEntry(t, admin, studentID, guardianID, list(phoneEntry(otherPhoneID, "+49 111 222333", "mobile", true))))
	})
}

// A number missing from the saved list is deleted; deleting the primary
// number moves the mark to the next one.
func TestGuardianComposition_DeletePhoneNumber(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)
	guardianID, studentID, _, phone2ID := ctx.linkedGuardianWithPhones(t)

	testutil.AssertSuccessResponse(t, ctx.saveEntry(t, admin, studentID, guardianID, map[string]any{
		"phone_numbers": []map[string]any{phoneEntry(phone2ID, "+49 987 654321", "work", false)},
	}), http.StatusOK)
	phones := ctx.entryRow(t, studentID, guardianID).Guardian.PhoneNumbers
	require.Len(t, phones, 1)
	assert.Equal(t, wireID(phone2ID), phones[0].ID)
	assert.True(t, phones[0].IsPrimary, "the remaining number becomes primary")

	testutil.AssertSuccessResponse(t, ctx.saveEntry(t, admin, studentID, guardianID, map[string]any{"phone_numbers": []map[string]any{}}), http.StatusOK)
	assert.Empty(t, ctx.entryRow(t, studentID, guardianID).Guardian.PhoneNumbers)
}

// The saved list moves the primary mark and adds new numbers.
func TestGuardianComposition_SetPrimaryPhone(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	admin := testutil.AdminTestClaims(999)
	guardianID, studentID, phone1ID, phone2ID := ctx.linkedGuardianWithPhones(t)

	rr := ctx.saveEntry(t, admin, studentID, guardianID, map[string]any{"phone_numbers": []map[string]any{
		phoneEntry(phone1ID, "+49 123 456789", "mobile", false),
		phoneEntry(phone2ID, "+49 987 654321", "work", true),
		phoneEntry(0, "+49 555 444333", "home", false),
	}})
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	primary := map[wireID]bool{}
	for _, phone := range ctx.entryRow(t, studentID, guardianID).Guardian.PhoneNumbers {
		primary[phone.ID] = phone.IsPrimary
	}
	assert.Len(t, primary, 3, "the new number is added")
	assert.True(t, primary[wireID(phone2ID)])
	assert.False(t, primary[wireID(phone1ID)])
}

// ===========================================================================
// BATCH CREATE
// ===========================================================================

func TestGuardianComposition_BatchCreatesAndLinksGuardian(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	studentID, _ := ctx.createStudent("Batch", "Child", "1a")

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodPost, fmt.Sprintf("/students/%d/guardians/batch", studentID), map[string]any{
		"guardians": []map[string]any{{
			"first_name": "Atomic", "last_name": "Guardian",
			"email":             "batch-guardian-" + time.Now().Format("150405.000000") + "@test.com",
			"relationship_type": "parent", "emergency_priority": 1,
			"phone_numbers": []map[string]any{{"phone_number": "+49 123 456", "phone_type": "mobile", "is_primary": true}},
		}},
	})
	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)

	linked := ctx.studentGuardians(t, studentID)
	require.Len(t, linked, 1)
	assert.Equal(t, "Atomic", linked[0].Guardian.FirstName)
}

// A pure pickup contact (#7770) is saved without phone and e-mail. It gets
// no parent-portal permission, no account, no invitation and no mail.
func TestGuardianComposition_BatchCreatesPickupContactWithoutContactData(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	studentID, _ := ctx.createStudent("Pickup", "Child", "1a")
	tenantID := testpkg.Tenant(t)

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodPost, fmt.Sprintf("/students/%d/guardians/batch", studentID), map[string]any{
		"guardians": []map[string]any{{
			"first_name": "Oma", "last_name": "Abholung",
			"relationship_type": "relative", "guardian_role": "pickup_only",
			"can_pickup": true, "emergency_priority": 1,
		}},
	})
	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)

	read := ctx.do(t, testutil.AdminTestClaims(999), http.MethodGet, fmt.Sprintf("/students/%d/guardians", studentID), nil)
	require.Equal(t, http.StatusOK, read.Code, read.Body.String())
	var response struct {
		Data []struct {
			Guardian struct {
				ID           wireID  `json:"id"`
				Email        *string `json:"email"`
				PhoneNumbers []any   `json:"phone_numbers"`
			} `json:"guardian"`
			RelationshipID wireID `json:"relationship_id"`
			GuardianRole   string `json:"guardian_role"`
			CanPickup      bool   `json:"can_pickup"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(read.Body.Bytes(), &response))
	require.Len(t, response.Data, 1)
	contact := response.Data[0]
	assert.Equal(t, "pickup_only", contact.GuardianRole)
	assert.True(t, contact.CanPickup)
	assert.True(t, contact.Guardian.Email == nil || *contact.Guardian.Email == "", "no e-mail address")
	assert.Empty(t, contact.Guardian.PhoneNumbers)

	guardianID, relationshipID := int64(contact.Guardian.ID), int64(contact.RelationshipID)
	assert.Equal(t, 1, ctx.count(`SELECT COUNT(*) FROM auth.guardian_student_access WHERE relationship_id = ? AND permissions::text NOT LIKE '%parent_portal.%'`, relationshipID),
		"the access row exists and carries no parent_portal permission")
	assert.Equal(t, 1, ctx.count(`SELECT COUNT(*) FROM users.guardian_profiles WHERE id = ? AND account_id IS NULL AND email IS NULL`, guardianID))
	assert.Zero(t, ctx.count(`SELECT COUNT(*) FROM auth.guardian_invitations WHERE guardian_profile_id = ?`, guardianID))
	assert.Zero(t, ctx.count(`SELECT COUNT(*) FROM platform.email_outbox WHERE tenant_id = ?`, tenantID))
}

func TestGuardianComposition_BatchDuplicateEmailCarriesItsCode(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	studentID, _ := ctx.createStudent("Batch", "Duplicate", "1a")
	_, email := ctx.createGuardian("batch-duplicate")

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodPost, fmt.Sprintf("/students/%d/guardians/batch", studentID), map[string]any{
		"guardians": []map[string]any{{
			"first_name": "Second", "last_name": "Person", "email": email,
			"relationship_type": "parent", "emergency_priority": 1,
		}},
	})
	testutil.AssertBadRequest(t, rr)
	// The form explains the duplicate through its own code (#2517).
	assert.Contains(t, rr.Body.String(), `"code":"`+"students.guardian_email_taken"+`"`)
	assert.Empty(t, ctx.studentGuardians(t, studentID))
}

func TestGuardianComposition_BatchRejectsEmptyAndNonStaff(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	studentID, _ := ctx.createStudent("Empty", "Batch", "1a")

	testutil.AssertBadRequest(t, ctx.do(t, testutil.AdminTestClaims(999), http.MethodPost, fmt.Sprintf("/students/%d/guardians/batch", studentID), map[string]any{"guardians": []map[string]any{}}))

	nonStaff := sessiontoken.AppClaims{ID: 555, Sub: "nonstaff@test.com", TenantID: testpkg.Tenant(t), Roles: []string{"user"}, Permissions: []string{"users:read", "users:update"}}
	testutil.AssertForbidden(t, ctx.do(t, nonStaff, http.MethodPost, fmt.Sprintf("/students/%d/guardians/batch", studentID), map[string]any{
		"guardians": []map[string]any{{"first_name": "X", "last_name": "Y", "relationship_type": "parent", "emergency_priority": 1}},
	}))
}

func TestGuardianComposition_BatchValidationIsBadRequestAndWritesNothing(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	studentID, _ := ctx.createStudent("Invalid", "Batch", "1a")
	email := fmt.Sprintf("invalid-batch-%d@test.com", testpkg.UniqueSuffix())

	rr := ctx.do(t, testutil.AdminTestClaims(999), http.MethodPost, fmt.Sprintf("/students/%d/guardians/batch", studentID), map[string]any{
		"guardians": []map[string]any{{
			"first_name": "Bad", "last_name": "Priority", "email": email,
			"relationship_type": "parent", "emergency_priority": 0,
		}},
	})
	testutil.AssertBadRequest(t, rr)
	assert.Contains(t, errorText(t, rr.Body.String()), "Notfall-Priorität")
	assert.Equal(t, 0, ctx.guardianEmailCount(email))
	assert.Empty(t, ctx.studentGuardians(t, studentID))
}

// A bulk invitation whose facts changed since its preview is a 409 business
// rejection (ADR 0311): the composition renders general.changed_since_read
// and observes a 4xx conflict, never a server error.
func TestGuardianComposition_BulkInviteRefusesAStalePreviewAsConflict(t *testing.T) {
	t.Parallel()
	ctx := setupGuardiansCompositionRoute(t)
	studentID, _ := ctx.createStudent("Stale", "Preview", "3a")
	guardianID, _ := ctx.createGuardian("stale-preview")
	ctx.link(studentID, guardianID, "primary_guardian")

	rr := ctx.do(t, withPerms(testutil.DefaultTestClaims(), "admin:*"), http.MethodPost, "/bulk-invite", map[string]any{
		"student_ids": []string{fmt.Sprint(studentID)}, "expected_fingerprint": "a-preview-of-another-state",
	})

	require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	assert.Equal(t, readstate.ChangedCode, testutil.ParseJSONResponse(t, rr.Body.Bytes())["code"])
	assert.Equal(t, usersAPI.FailureConflict, guardianFailureKind(ClassifyGuardianInvitationFailure(fmt.Errorf("bulk invite: %w", readstate.ErrChanged))),
		"the response metric counts the kind's status, 409")
}

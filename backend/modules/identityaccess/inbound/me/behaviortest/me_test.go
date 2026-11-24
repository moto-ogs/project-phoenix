// Package me_test tests the /api/me handlers with hermetic test pattern.
//
// These tests mount the production Resource.Router() and authenticate via real
// signed JWTs (testutil.MintTestJWT + testutil.WithJWTBearer) so the full
// middleware chain (Verifier → Authenticator → TenantScopeMiddleware → TenantTxMiddleware)
// runs exactly as it does in production. They verify HTTP request/response
// handling, status codes, and error responses against a real test database.
package me_test

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/me"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// init seeds JWT viper defaults before any test (and before setupUserContextRoute
// constructs a Resource via jwt.MustNewTokenAuth). CI runs without a .env so
// AUTH_JWT_SECRET is unset; without a secret jwx refuses HMAC signing.
func init() {
	testutil.SeedTestJWTConfig()
}

// testContext holds shared test dependencies.
type testContext struct {
	db       *bun.DB
	avatar   func(context.Context, int64) (string, error)
	resource *me.Resource
	router   chi.Router
}

// setupUserContextRoute initializes test database, caller context, resource, and a router
// that serves the resource at the same paths it would in production.
func setupUserContextRoute(t *testing.T) *testContext {
	t.Helper()

	db, module := setupUserContextModule(t)
	resource := me.NewResource(module.Caller(), module, rootAPI.TenantSessionChain, nativeUploads.UploadFiles{},
		rootAPI.NewAuthTestSettings(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db)))

	return &testContext{
		db: db,
		avatar: func(ctx context.Context, id int64) (string, error) {
			var avatar string
			err := db.NewSelect().
				TableExpr(`auth.accounts AS "account"`).
				ColumnExpr(`"account".avatar`).
				Where(`"account".id = ?`, id).
				Scan(ctx, &avatar)
			return avatar, err
		},
		resource: resource,
		router:   resource.Router(),
	}
}

// =============================================================================
// GET CURRENT PROFILE TESTS
// =============================================================================

func TestGetCurrentProfile_Success(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "Profile", "Test")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/profile", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestGetCurrentProfile_Unauthenticated(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	req := testutil.NewAuthenticatedRequest(t, "GET", "/profile", nil)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code, "Expected 401 for unauthenticated request")
}

// =============================================================================
// UPDATE CURRENT PROFILE TESTS
// =============================================================================

func TestUpdateCurrentProfile_Success(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "Update", "ProfileTest")

	body := map[string]interface{}{
		"first_name":       "Updated",
		"last_name":        "Name",
		"expected_version": readProfileVersion(t, tc, account.ID),
	}

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "PUT", "/profile", body,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

// ADR 0311: the self-edit saves only over the profile it was read from. An
// admin's rename of the same person through PUT /api/users/{id} in between
// (here the row write it ends in) refuses the edit, as do the older version
// and a missing one, and nothing is written; the version the save answers
// saves the next edit without a read, also of bio alone.
func TestUpdateCurrentProfile_SavesOnlyOverTheReadVersion(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)
	person, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "Read", "Version")
	read := readProfileVersion(t, tc, account.ID)
	put := func(body map[string]any) *httptest.ResponseRecorder {
		claims := testutil.TeacherTestClaims(int(account.ID))
		return testutil.ExecuteRequest(tc.router, testutil.NewAuthenticatedRequest(t, "PUT", "/profile", body,
			testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))))
	}

	_, err := tc.db.NewUpdate().TableExpr("users.persons").Set("last_name = ?", "Admin").
		Where("id = ?", person.ID).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	for name, version := range map[string]string{"read before the admin's rename": read, "no version": ""} {
		rr := put(map[string]any{"first_name": "Selbst", "last_name": "Version", "expected_version": version})
		assert.Equal(t, http.StatusConflict, rr.Code, name)
		assert.Contains(t, rr.Body.String(), "general.changed_since_read", name)
	}
	stored := getData(t, tc, "/profile", account.ID, "Current profile retrieved successfully").(map[string]any)
	assert.Equal(t, "Read", stored["first_name"], "a refused edit writes nothing")
	assert.Equal(t, "Admin", stored["last_name"], "the admin's rename stays")

	current, _ := stored["version"].(string)
	rr := put(map[string]any{"first_name": "Selbst", "last_name": "Admin", "expected_version": current})
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	saved := testutil.ParseJSONResponse(t, rr.Body.Bytes())["data"].(map[string]any)
	assert.Equal(t, "Selbst", saved["first_name"])
	answered, _ := saved["version"].(string)
	require.NotEqual(t, current, answered, "the save answers the stored version")
	assert.Equal(t, readProfileVersion(t, tc, account.ID), answered)

	rr = put(map[string]any{"bio": "Nur die Beschreibung", "expected_version": current})
	assert.Equal(t, http.StatusConflict, rr.Code, "an edit of bio alone is checked as well")
	rr = put(map[string]any{"bio": "Nur die Beschreibung", "expected_version": answered})
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

// An account without a person reads its profile as absent; the first edit
// creates the person over that version only.
func TestUpdateCurrentProfile_CreatesThePersonOverTheAbsentVersion(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)
	account := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("profile-absent-%d@example.com", time.Now().UnixNano()))
	put := func(version string) *httptest.ResponseRecorder {
		claims := testutil.TeacherTestClaims(int(account.ID))
		body := map[string]any{"first_name": "Neu", "last_name": "Person", "expected_version": version}
		return testutil.ExecuteRequest(tc.router, testutil.NewAuthenticatedRequest(t, "PUT", "/profile", body,
			testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))))
	}
	read := readProfileVersion(t, tc, account.ID)
	require.Equal(t, readstate.Absent, read)

	assert.Equal(t, http.StatusConflict, put("").Code)
	rr := put(read)
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	saved := testutil.ParseJSONResponse(t, rr.Body.Bytes())["data"].(map[string]any)
	assert.Equal(t, "Neu", saved["first_name"])
	assert.Equal(t, http.StatusConflict, put(read).Code, "the person exists now: the absent version is stale")
}

// readProfileVersion reads the caller's profile version the way the profile
// page does.
func readProfileVersion(t *testing.T, tc *testContext, accountID int64) string {
	t.Helper()
	data := getData(t, tc, "/profile", accountID, "Current profile retrieved successfully").(map[string]any)
	version, _ := data["version"].(string)
	require.NotEmpty(t, version, "the profile read carries its version")
	return version
}

func TestUpdateCurrentProfile_Unauthenticated(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	body := map[string]interface{}{"first_name": "Updated"}
	req := testutil.NewAuthenticatedRequest(t, "PUT", "/profile", body)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code, "Expected 401 for unauthenticated request")
}

func TestUpdateCurrentProfile_EmptyBody(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "Empty", "Update")

	body := map[string]interface{}{"expected_version": readProfileVersion(t, tc, account.ID)}

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "PUT", "/profile", body,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

// =============================================================================
// GET CURRENT STAFF TESTS
// =============================================================================

func TestGetCurrentStaff_Success(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	teacher, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Staff", "Test")
	personnelNumber := "90001"
	teacher.Staff.PersonnelNumber = &personnelNumber
	_, err := tc.db.NewUpdate().
		TableExpr(`users.staff_employment_profiles`).
		Set("personnel_number = ?", personnelNumber).
		Where("membership_id = ?", teacher.Staff.ID).
		Where("tenant_id = ?", teacher.Staff.TenantID).
		Exec(context.Background())
	require.NoError(t, err)

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/staff", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
	assert.NotContains(t, rr.Body.String(), "personnel_number")
}

func TestGetCurrentStaff_NotStaff(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	account := testpkg.CreateTestAccount(t, tc.db, "not-staff@example.com")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/staff", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Contains(t, []int{http.StatusNotFound, http.StatusForbidden, http.StatusInternalServerError}, rr.Code)
}

func TestGetCurrentStaff_Unauthenticated(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	req := testutil.NewAuthenticatedRequest(t, "GET", "/staff", nil)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code, "Expected 401 for unauthenticated request")
}

// =============================================================================
// GET MY GROUPS TESTS
// =============================================================================

func TestGetMyGroups_Success(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Groups", "Test")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/groups", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestGetMyGroups_Unauthenticated(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	req := testutil.NewAuthenticatedRequest(t, "GET", "/groups", nil)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code, "Expected 401 for unauthenticated request")
}

// =============================================================================
// GET MY SUPERVISED GROUPS TESTS
// =============================================================================

func TestGetMySupervisedGroups_Success(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Supervised", "Groups")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/groups/supervised", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestGetMySupervisedGroups_Unauthenticated(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	req := testutil.NewAuthenticatedRequest(t, "GET", "/groups/supervised", nil)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code, "Expected 401 for unauthenticated request")
}

// =============================================================================
// AVATAR TESTS
// =============================================================================

func TestDeleteAvatar_Unauthenticated(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	req := testutil.NewAuthenticatedRequest(t, "DELETE", "/profile/avatar", nil)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code, "Expected 401 for unauthenticated request")
}

func TestDeleteAvatar_NoAvatar(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "NoAvatar", "Test")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "DELETE", "/profile/avatar", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertBadRequest(t, rr)
}

func TestServeAvatar_MissingFilename(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "Avatar", "Serve")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/profile/avatar/", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Contains(t, []int{http.StatusBadRequest, http.StatusNotFound}, rr.Code)
}

func TestServeAvatar_Unauthenticated(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	req := testutil.NewAuthenticatedRequest(t, "GET", "/profile/avatar/test.jpg", nil)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code, "Expected 401 for unauthenticated request")
}

func TestServeAvatar_GlobalAvatarFile(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "Avatar", "GlobalFile")

	avatarDir := filepath.Join(publicDir(t), "uploads", "avatars", "global")
	err := os.MkdirAll(avatarDir, 0755)
	require.NoError(t, err)

	filename := fmt.Sprintf("%d_test-avatar.jpg", account.ID)
	filePath := filepath.Join(avatarDir, filename)
	err = os.WriteFile(filePath, []byte("fake-image-data"), 0644)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = os.Remove(filePath)
	})

	_, err = tc.db.ExecContext(context.Background(),
		`UPDATE auth.accounts SET avatar = ? WHERE id = ?`,
		"/uploads/avatars/global/"+filename,
		account.ID,
	)
	require.NoError(t, err)

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/profile/avatar/"+filename, nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, []byte("fake-image-data"), rr.Body.Bytes())
}

// =============================================================================
// UPDATE PROFILE WITH ALL FIELDS TESTS
// =============================================================================

func TestUpdateCurrentProfile_WithUsernameAndBio(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "FullUpdate", "ProfileTest")

	uniqueUsername := fmt.Sprintf("user_%d", account.ID)
	body := map[string]interface{}{
		"first_name":       "NewFirst",
		"last_name":        "NewLast",
		"username":         uniqueUsername,
		"bio":              "This is my bio text",
		"expected_version": readProfileVersion(t, tc, account.ID),
	}

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "PUT", "/profile", body,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

// =============================================================================
// SERVE AVATAR INVALID PATH TESTS
// =============================================================================

func TestServeAvatar_InvalidFilename(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "InvalidPath", "Avatar")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/profile/avatar/../../../etc/passwd", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound}, rr.Code)
}

func TestServeAvatar_NonExistentFile(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "NonExistent", "Avatar")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/profile/avatar/nonexistent_file_12345.jpg", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, rr.Code)
}

// =============================================================================
// UPLOAD AVATAR TESTS
// =============================================================================

func TestUploadAvatar_Unauthenticated(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	req := testutil.NewAuthenticatedRequest(t, "POST", "/profile/avatar", nil)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Contains(t, []int{http.StatusBadRequest, http.StatusUnauthorized}, rr.Code,
		"Expected 400 or 401 for unauthenticated request")
}

func TestUploadAvatar_NoFile(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "NoFile", "Upload")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "POST", "/profile/avatar", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertBadRequest(t, rr)
}

func TestUploadAvatar_Success(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "Upload", "Success")

	// A real encoded PNG: uploads are parsed chunk by chunk to strip metadata.
	var pngBuf bytes.Buffer
	require.NoError(t, png.Encode(&pngBuf, image.NewRGBA(image.Rect(0, 0, 1, 1))))
	pngContent := pngBuf.String()
	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewMultipartRequest(t, "POST", "/profile/avatar", "avatar", "avatar.png", pngContent,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	avatar, err := tc.avatar(context.Background(), account.ID)
	require.NoError(t, err)
	require.NotEmpty(t, avatar)
	assert.Contains(t, avatar, "/uploads/avatars/global/")
	assert.Equal(t, ".png", filepath.Ext(avatar))

	// The upload goes through the storage backend, which resolves a relative
	// upload directory against the discovered public dir. Rebuilding the path
	// from the working directory would look for the avatar in the test
	// package's directory instead of where the handler just wrote it.
	avatarFilePath := storedFile(t, avatar)
	t.Cleanup(func() {
		_ = os.Remove(avatarFilePath)
	})

	fileInfo, err := os.Stat(avatarFilePath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), fileInfo.Mode().Perm())
	dirInfo, err := os.Stat(filepath.Dir(avatarFilePath))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o700), dirInfo.Mode().Perm())

	getReq := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/profile/avatar/"+filepath.Base(avatar), nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	imageResponse := testutil.ExecuteRequest(tc.router, getReq)
	require.Equal(t, http.StatusOK, imageResponse.Code)
	assert.Equal(t, pngContent, imageResponse.Body.String())
	assert.Equal(t, "private, max-age=86400", imageResponse.Header().Get("Cache-Control"))
	assert.Equal(t, "image/png", imageResponse.Header().Get("Content-Type"), "the handler names the type; the proxy adds none (#2352)")

	// Only the caller's own stored file name opens: a traversal or a name
	// with a backslash is refused by the handler, not by the frontend proxy.
	for _, name := range []string{"..%5C..%5Cetc%5Cpasswd", "other.png", url.PathEscape(filepath.Base(avatar) + "\\x")} {
		otherReq := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/profile/avatar/"+name, nil,
			testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
		assert.Equal(t, http.StatusForbidden, testutil.ExecuteRequest(tc.router, otherReq).Code, name)
	}
}

// =============================================================================
// DELETE AVATAR WITH AVATAR TESTS
// =============================================================================

func TestDeleteAvatar_WithAvatar(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "HasAvatar", "Delete")
	avatarDir := filepath.Join("public", "uploads", "avatars", "global")
	err := os.MkdirAll(avatarDir, 0755)
	require.NoError(t, err)

	avatarPath := filepath.Join(avatarDir, "test_avatar.jpg")
	err = os.WriteFile(avatarPath, []byte("fake-image-data"), 0644)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = os.Remove(avatarPath)
	})

	_, err = tc.db.ExecContext(context.Background(),
		`UPDATE auth.accounts SET avatar = ? WHERE id = ?`,
		"/uploads/avatars/global/test_avatar.jpg",
		account.ID,
	)
	require.NoError(t, err)

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "DELETE", "/profile/avatar", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	_, err = os.Stat(avatarPath)
	assert.True(t, os.IsNotExist(err))
}

// =============================================================================
// GET MY GROUPS WITH SUBSTITUTION TESTS
// =============================================================================

func TestGetMyGroups_WithSubstitution(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)

	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "SubstGroups", "Teacher")

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewAuthenticatedRequest(t, "GET", "/groups", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)

	rr := testutil.ExecuteRequest(tc.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)

	response := testutil.ParseJSONResponse(t, rr.Body.Bytes())
	assert.Equal(t, "success", response["status"])
}

// A direct API upload skips the browser's re-encoding; the stored avatar must
// still be free of Exif (and so of GPS coordinates).
func TestUploadAvatar_StripsExifGPS(t *testing.T) {
	t.Parallel()
	tc := setupUserContextRoute(t)
	_, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "Upload", "Exif")

	var plain bytes.Buffer
	require.NoError(t, jpeg.Encode(&plain, image.NewGray(image.Rect(0, 0, 1, 1)), nil))
	exifGPS := "\xFF\xE1\x00\x2CExif\x00\x00II\x2A\x00\x08\x00\x00\x00\x01\x00\x25\x88\x04\x00\x01\x00\x00\x00\x1A\x00\x00\x00\x00\x00\x00\x00GPS-51.22N"
	upload := "\xFF\xD8" + exifGPS + plain.String()[2:]

	claims := testutil.TeacherTestClaims(int(account.ID))
	req := testutil.NewMultipartRequest(t, "POST", "/profile/avatar", "avatar", "avatar.jpg", upload,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)),
	)
	rr := testutil.ExecuteRequest(tc.router, req)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	avatar, err := tc.avatar(context.Background(), account.ID)
	require.NoError(t, err)
	avatarFilePath := storedFile(t, avatar)
	t.Cleanup(func() { _ = os.Remove(avatarFilePath) })
	stored, err := os.ReadFile(avatarFilePath)
	require.NoError(t, err)
	assert.NotContains(t, string(stored), "Exif")
	assert.NotContains(t, string(stored), "GPS-51.22N")
	assert.Equal(t, plain.Bytes(), stored, "only the metadata segment is removed")
}

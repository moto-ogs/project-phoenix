package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	timetableHTTPAdapter "github.com/moto-ogs/project-phoenix/modules/timetable/http/activities"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The shift-type route is composed here, so the permission gate, the
// Kategorie↔Schichtart sync and the rollback of a rejected mapping are
// asserted against the real runtime, the real services and the database.

type shiftTypeRoute struct {
	db                *bun.DB
	router            chi.Router
	categories        chi.Router
	token             string
	ctx               context.Context
	categoryShiftType func(context.Context, int64) (*int64, error)
}

func setupShiftTypeRoute(t *testing.T) *shiftTypeRoute {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	shiftTypes, references, module, err := NewShiftTypeTestModule(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	resource := newShiftTypesResource(shiftTypes, references)
	activityModule, activities, people, caller, err := NewActivitiesTestModule(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	categories := chi.NewRouter()
	categories.Mount("/activities", timetableHTTPAdapter.NewResource(activities, activityModule.Timetable,
		NewTimetableSupervisorDirectory(people), caller, TimetableHTTPTransactions).Router(ProtectedTenantRoutes))

	claims := testutil.DefaultTestClaims()
	claims.TenantID = testpkg.Tenant(t)
	claims.Permissions = []string{permissions.TimeTrackingManage}
	claims.IsAdmin = false
	return &shiftTypeRoute{db: db, router: resource.Router(), categories: categories, token: testutil.MintTestJWT(t, claims), ctx: testpkg.Ctx(t), categoryShiftType: func(ctx context.Context, categoryID int64) (*int64, error) {
		category, err := module.Repositories.Rows.ActivityCategory.FindCategory(ctx, categoryID)
		if err != nil {
			return nil, err
		}
		return category.ShiftTypeID, nil
	}}
}

func (s *shiftTypeRoute) do(t *testing.T, method, path string, body any) *http.Response {
	t.Helper()
	request := testutil.NewAuthenticatedRequest(t, method, path, body, testutil.WithJWTBearer(s.token))
	return testutil.ExecuteRequest(s.router, request).Result()
}

func (s *shiftTypeRoute) shiftTypeIDOf(t *testing.T, categoryID int64) *int64 {
	t.Helper()
	shiftTypeID, err := s.categoryShiftType(s.ctx, categoryID)
	require.NoError(t, err)
	return shiftTypeID
}

// linkVersions are the link tokens the category list answers (ADR 0311),
// read from GET /api/activities/categories as the shift-type form reads them
// and keyed as it sends them.
func (s *shiftTypeRoute) linkVersions(t *testing.T, categoryIDs ...int64) map[string]string {
	t.Helper()
	request := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/activities/categories", nil, testutil.WithJWTBearer(s.token))
	listed := testutil.ExecuteRequest(s.categories, request).Result()
	defer func() { _ = listed.Body.Close() }()
	require.Equal(t, http.StatusOK, listed.StatusCode)
	var envelope struct {
		Data []struct {
			ID                   wireID `json:"id"`
			ShiftTypeLinkVersion string `json:"shift_type_link_version"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(listed.Body).Decode(&envelope))
	listedVersions := make(map[int64]string, len(envelope.Data))
	for _, row := range envelope.Data {
		listedVersions[int64(row.ID)] = row.ShiftTypeLinkVersion
	}
	versions := make(map[string]string, len(categoryIDs))
	for _, id := range categoryIDs {
		version, ok := listedVersions[id]
		require.True(t, ok, "category %d is listed", id)
		require.NotEmpty(t, version, "category %d carries its link token", id)
		versions[strconv.FormatInt(id, 10)] = version
	}
	return versions
}

func (s *shiftTypeRoute) typeName(t *testing.T, typeID int64) string {
	t.Helper()
	listed := s.do(t, http.MethodGet, "/", nil)
	defer func() { _ = listed.Body.Close() }()
	var envelope struct {
		Data []struct {
			ID   wireID `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(listed.Body).Decode(&envelope))
	for _, row := range envelope.Data {
		if int64(row.ID) == typeID {
			return row.Name
		}
	}
	return ""
}

// typeVersion reads the type's version from the list, as the catalog page
// does.
func (s *shiftTypeRoute) typeVersion(t *testing.T, typeID int64) string {
	t.Helper()
	listed := s.do(t, http.MethodGet, "/", nil)
	defer func() { _ = listed.Body.Close() }()
	require.Equal(t, http.StatusOK, listed.StatusCode)
	var envelope struct {
		Data []struct {
			ID      wireID `json:"id"`
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(listed.Body).Decode(&envelope))
	for _, row := range envelope.Data {
		if int64(row.ID) == typeID {
			return row.Version
		}
	}
	t.Fatalf("shift type %d is not listed", typeID)
	return ""
}

func decodeShiftTypeID(t *testing.T, response *http.Response) int64 {
	t.Helper()
	defer func() { _ = response.Body.Close() }()
	var envelope struct {
		Data struct {
			ID wireID `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(response.Body).Decode(&envelope))
	require.NotZero(t, envelope.Data.ID)
	return int64(envelope.Data.ID)
}

func TestShiftTypesRouteCreatesWithCategoryLinks(t *testing.T) {
	t.Parallel()
	route := setupShiftTypeRoute(t)

	first := testpkg.CreateTestActivityCategory(t, route.db, "st-create-1")
	second := testpkg.CreateTestActivityCategory(t, route.db, "st-create-2")

	read := route.linkVersions(t, first.ID, second.ID)
	// ADR 0311: linking moves a category from the type it had; a form that
	// read another link is refused and creates nothing.
	stale := map[string]string{fmt.Sprint(first.ID): "anders", fmt.Sprint(second.ID): read[fmt.Sprint(second.ID)]}
	name := fmt.Sprintf("Betreuung-%d", time.Now().UnixNano())
	refused := route.do(t, http.MethodPost, "/", map[string]any{
		"name": name, "color": "#83CD2D", "category_ids": []string{fmt.Sprint(first.ID), fmt.Sprint(second.ID)},
		"expected_category_link_versions": stale,
	})
	require.Equal(t, http.StatusConflict, refused.StatusCode)
	assert.Nil(t, route.shiftTypeIDOf(t, first.ID), "a refused create links nothing")
	assert.Nil(t, route.shiftTypeIDOf(t, second.ID), "a refused create links nothing")

	created := route.do(t, http.MethodPost, "/", map[string]any{
		"name": name, "color": "#83CD2D", "category_ids": []string{fmt.Sprint(first.ID), fmt.Sprint(second.ID)},
		"expected_category_link_versions": read,
	})
	require.Equal(t, http.StatusCreated, created.StatusCode, "the refused create rolled its type back")
	typeID := decodeShiftTypeID(t, created)

	require.NotNil(t, route.shiftTypeIDOf(t, first.ID))
	assert.Equal(t, typeID, *route.shiftTypeIDOf(t, first.ID))
	require.NotNil(t, route.shiftTypeIDOf(t, second.ID))
	assert.Equal(t, typeID, *route.shiftTypeIDOf(t, second.ID))
}

func TestShiftTypesRouteUpdateSyncsAndOmittedLeavesUntouched(t *testing.T) {
	t.Parallel()
	route := setupShiftTypeRoute(t)

	first := testpkg.CreateTestActivityCategory(t, route.db, "st-upd-1")
	second := testpkg.CreateTestActivityCategory(t, route.db, "st-upd-2")

	name := fmt.Sprintf("Vorbereitung-%d", time.Now().UnixNano())
	created := route.do(t, http.MethodPost, "/", map[string]any{
		"name": name, "color": "#5080D8", "category_ids": []string{fmt.Sprint(first.ID), fmt.Sprint(second.ID)},
		"expected_category_link_versions": route.linkVersions(t, first.ID, second.ID),
	})
	require.Equal(t, http.StatusCreated, created.StatusCode)
	typeID := decodeShiftTypeID(t, created)

	// Narrowing the set to the first category unlinks the second.
	read := route.linkVersions(t, first.ID, second.ID)
	updated := route.do(t, http.MethodPut, fmt.Sprintf("/%d", typeID), map[string]any{
		"name": name, "color": "#5080D8", "is_active": true, "category_ids": []string{fmt.Sprint(first.ID)},
		"expected_version": route.typeVersion(t, typeID), "expected_category_link_versions": read,
	})
	require.Equal(t, http.StatusOK, updated.StatusCode)
	require.NotNil(t, route.shiftTypeIDOf(t, first.ID))
	assert.Equal(t, typeID, *route.shiftTypeIDOf(t, first.ID))
	assert.Nil(t, route.shiftTypeIDOf(t, second.ID), "the de-selected category is unlinked on update")

	// ADR 0311: a form read before that save would link the second category
	// again; its link moved since, so the save is refused and writes nothing.
	stale := route.do(t, http.MethodPut, fmt.Sprintf("/%d", typeID), map[string]any{
		"name": name + " überschrieben", "color": "#5080D8", "is_active": true, "category_ids": []string{fmt.Sprint(first.ID), fmt.Sprint(second.ID)},
		"expected_version": route.typeVersion(t, typeID), "expected_category_link_versions": read,
	})
	require.Equal(t, http.StatusConflict, stale.StatusCode)
	assert.Nil(t, route.shiftTypeIDOf(t, second.ID), "a refused save links nothing")
	assert.Equal(t, name, route.typeName(t, typeID), "a refused link write rolls the type's write back too")

	// An update without category_ids leaves the mapping untouched, and an
	// omitted is_active keeps the stored flag.
	untouched := route.do(t, http.MethodPut, fmt.Sprintf("/%d", typeID), map[string]any{"name": name, "color": "#5080D8", "expected_version": route.typeVersion(t, typeID)})
	require.Equal(t, http.StatusOK, untouched.StatusCode)
	require.NotNil(t, route.shiftTypeIDOf(t, first.ID), "omitted category_ids must not clear the mapping")
	var envelope struct {
		Data struct {
			IsActive bool `json:"is_active"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(untouched.Body).Decode(&envelope))
	assert.True(t, envelope.Data.IsActive)
}

func TestShiftTypesRouteRejectsUnknownCategoryIDsAndRollsBack(t *testing.T) {
	t.Parallel()
	route := setupShiftTypeRoute(t)

	first := testpkg.CreateTestActivityCategory(t, route.db, "st-unknown-1")
	name := fmt.Sprintf("Betreuung-%d", time.Now().UnixNano())
	created := route.do(t, http.MethodPost, "/", map[string]any{
		"name": name, "color": "#83CD2D", "category_ids": []string{fmt.Sprint(first.ID)},
		"expected_category_link_versions": route.linkVersions(t, first.ID),
	})
	require.Equal(t, http.StatusCreated, created.StatusCode)
	typeID := decodeShiftTypeID(t, created)
	require.NotNil(t, route.shiftTypeIDOf(t, first.ID))

	// An update carrying an unknown category id is a 400 and must NOT clear
	// the existing mapping nor persist the renamed type.
	rejected := route.do(t, http.MethodPut, fmt.Sprintf("/%d", typeID), map[string]any{
		"name": name + " neu", "color": "#83CD2D", "is_active": true, "category_ids": []string{fmt.Sprint(first.ID), fmt.Sprint(999999999)},
		"expected_version": route.typeVersion(t, typeID),
	})
	require.Equal(t, http.StatusBadRequest, rejected.StatusCode)
	require.NotNil(t, route.shiftTypeIDOf(t, first.ID), "existing mapping must survive a rejected update")
	assert.Equal(t, typeID, *route.shiftTypeIDOf(t, first.ID))
	listed := route.do(t, http.MethodGet, "/", nil)
	require.Equal(t, http.StatusOK, listed.StatusCode)
	var envelope struct {
		Data []struct {
			ID   wireID `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(listed.Body).Decode(&envelope))
	for _, entry := range envelope.Data {
		if int64(entry.ID) == typeID {
			assert.Equal(t, name, entry.Name, "the rejected rename must roll back with the mapping")
		}
	}

	// A duplicate name is a conflict; an unknown id is not found.
	duplicate := route.do(t, http.MethodPost, "/", map[string]any{"name": name, "color": "#000000"})
	assert.Equal(t, http.StatusConflict, duplicate.StatusCode)
	missing := route.do(t, http.MethodPut, "/999999999", map[string]any{"name": "Neu", "color": "#000000"})
	assert.Equal(t, http.StatusNotFound, missing.StatusCode)
}

func TestShiftTypesRouteRequiresManagePermission(t *testing.T) {
	t.Parallel()
	route := setupShiftTypeRoute(t)

	claims := testutil.DefaultTestClaims()
	claims.TenantID = testpkg.Tenant(t)
	claims.Permissions = []string{permissions.TimeTrackingOwn}
	claims.IsAdmin = false
	token := testutil.MintTestJWT(t, claims)
	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/"},
		{method: http.MethodPost, path: "/"},
		{method: http.MethodPost, path: "/defaults"},
		{method: http.MethodPut, path: "/1"},
		{method: http.MethodDelete, path: "/1"},
	} {
		request := testutil.NewAuthenticatedRequest(t, test.method, test.path, map[string]any{"name": "Neu"}, testutil.WithJWTBearer(token))
		assert.Equal(t, http.StatusForbidden, testutil.ExecuteRequest(route.router, request).Code, test.method+" "+test.path)
	}
}

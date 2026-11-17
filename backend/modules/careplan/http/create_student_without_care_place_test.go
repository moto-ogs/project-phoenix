package careplanhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/settings"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCreateStudentWithoutCarePlace creates a child of the class without an
// OGS place (#4803, ADR 0282) only while the school keeps such children: its
// switch and Unterricht am Vormittag on. Such a child gets no group.
func TestCreateStudentWithoutCarePlace(t *testing.T) {
	t.Parallel()
	testpkg.OwnTenant(t)
	tc := setupStudentsRoute(t)
	ctx := testpkg.Ctx(t)
	body := func(extra map[string]any) map[string]any {
		values := map[string]any{"first_name": "Ohne", "last_name": "Platz", "school_class": "2a", "without_care_place": true}
		for key, value := range extra {
			values[key] = value
		}
		return values
	}
	post := func(values map[string]any) (int, string) {
		req := testutil.NewAuthenticatedRequest(t, "POST", "/", values)
		rr := authExec(t, tc, req, testutil.AdminTestClaims(1), []string{"admin:*"})
		var problem struct {
			Code string `json:"code"`
		}
		_ = json.Unmarshal(rr.Body.Bytes(), &problem)
		return rr.Code, problem.Code
	}

	status, code := post(body(nil))
	assert.Equal(t, http.StatusConflict, status, "the switch is off by default")
	assert.Equal(t, "students.without_care_place_off", code)

	require.NoError(t, tc.settings().SetValue(ctx, settings.KeyChildrenWithoutCarePlace, true, nil, nil))
	group := testpkg.CreateTestEducationGroup(t, tc.db, "Gruppe ohne Platz")
	status, code = post(body(map[string]any{"group_id": group.ID}))
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "students.without_care_place_group", code)
	for _, wayHome := range []map[string]any{
		{"bus_days": map[string]bool{"mon": true}},
		{"pickup_status": "Wird abgeholt"},
		{"bus": true},
	} {
		status, code = post(body(wayHome))
		assert.Equal(t, http.StatusConflict, status, "no way home of the OGS either: %v", wayHome)
		assert.Equal(t, "students.without_care_place_care_data", code)
	}

	unterricht, ok := settings.LookupModule(settings.ModuleUnterrichtVormittag)
	require.True(t, ok)
	require.NoError(t, tc.settings().SetValue(ctx, unterricht.SettingKey, false, nil, nil))
	status, code = post(body(nil))
	assert.Equal(t, http.StatusConflict, status, "without the module the switch has no effect")
	assert.Equal(t, "students.without_care_place_off", code)
	require.NoError(t, tc.settings().SetValue(ctx, unterricht.SettingKey, true, nil, nil))

	req := testutil.NewAuthenticatedRequest(t, "POST", "/", body(nil))
	rr := authExec(t, tc, req, testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	var created createStudentResponse
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &created))
	withoutPlace := func() bool {
		var mark bool
		require.NoError(t, tc.db.NewRaw(`SELECT without_care_place FROM users.student_school_memberships
			WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t), created.Data.ID).Scan(ctx, &mark))
		return mark
	}
	assert.True(t, withoutPlace())

	// Every later write of the child (an edit, a sick note) rewrites its
	// membership; it keeps the mark and gives the child no OGS place.
	update := testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/%d", created.Data.ID), map[string]any{
		"extra_info": "Brille", "bus_days": map[string]bool{"mon": true},
	})
	rr = authExec(t, tc, update, testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.True(t, withoutPlace(), "an edit keeps the child without an OGS place")
	read := authExec(t, tc, testutil.NewAuthenticatedRequest(t, "GET", fmt.Sprintf("/%d", created.Data.ID), nil), testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusOK, read.Code, read.Body.String())
	var stored struct {
		Data struct {
			BusDays map[string]bool `json:"bus_days"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(read.Body.Bytes(), &stored))
	assert.False(t, stored.Data.BusDays["mon"], "an edit stores no OGS way home")

	// No OGS arrival or pickup times for it either.
	times := testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/%d/arrival-schedules", created.Data.ID), map[string]any{"schedules": []any{}})
	rr = authExec(t, tc, times, testutil.AdminTestClaims(1), []string{"admin:*"})
	assert.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), "students.without_care_place_care_data")
}

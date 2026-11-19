package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// substitutionAnswer is the envelope of a substitution route.
type substitutionAnswer[T any] struct {
	Status string `json:"status"`
	Data   T      `json:"data"`
}

func decodeSubstitutionAnswer[T any](t *testing.T, body []byte) T {
	t.Helper()
	var answer substitutionAnswer[T]
	require.NoError(t, json.Unmarshal(body, &answer), string(body))
	assert.Equal(t, "success", answer.Status)
	return answer.Data
}

// checkSubstitutionRoutes hands a group over, finds the handover in the
// overview and ends it, through the production router. The assignment
// answer names its shape in type and carries the handover under the member
// of that name (#2352); the ids in the request may be numbers or strings.
func checkSubstitutionRoutes(t *testing.T, graph *goldenRuntime) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	owner, ownerAccount := testpkg.CreateTestTeacherWithAccount(t, db, "Robin", "Owner")
	// The target is an active caregiver of the school: an active staff
	// account with a teacher row.
	target, _ := testpkg.CreateTestCalendarStaff(t, db, "Toni", "Target")
	_, err := db.NewInsert().Model(&testpkg.Teacher{StaffID: target.ID, TenantID: testpkg.Tenant(t)}).ModelTableExpr("users.teachers").Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	group := testpkg.CreateTestEducationGroup(t, db, "Robins Gruppe")
	testpkg.CreateTestGroupTeacher(t, db, group.ID, owner.ID)
	token := testpkg.MintLiveSessionJWT(t, db, testutil.AdminTestClaimsForTenant(int(ownerAccount.ID), testpkg.Tenant(t)))

	rec := checkpointRequest(graph, checkpointScenario{
		Method: http.MethodPost, Path: "/api/substitutions/", Authenticated: true,
		Body: fmt.Sprintf(`{"type":"group_handover","group_handover":{"group_id":"%d","target_staff_id":%d}}`, group.ID, target.ID),
	}, token)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assigned := decodeSubstitutionAnswer[struct {
		Type          string `json:"type"`
		GroupHandover *struct {
			ID     string `json:"id"`
			Target struct {
				FullName string `json:"full_name"`
			} `json:"target"`
		} `json:"group_handover"`
		ScheduleSubstitution json.RawMessage `json:"schedule_substitution"`
	}](t, rec.Body.Bytes())
	assert.Equal(t, "group_handover", assigned.Type)
	require.NotNil(t, assigned.GroupHandover, rec.Body.String())
	assert.Nil(t, assigned.ScheduleSubstitution, "only the member the type names is set")
	assert.Contains(t, assigned.GroupHandover.Target.FullName, "Toni")
	handoverID := assigned.GroupHandover.ID

	type overview struct {
		GroupHandovers []struct {
			ID string `json:"id"`
		} `json:"group_handovers"`
	}
	overviewPath := fmt.Sprintf("/api/substitutions/?group_id=%d", group.ID)
	rec = checkpointRequest(graph, checkpointScenario{Method: http.MethodGet, Path: overviewPath, Authenticated: true}, token)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	running := decodeSubstitutionAnswer[overview](t, rec.Body.Bytes())
	require.Len(t, running.GroupHandovers, 1)
	assert.Equal(t, handoverID, running.GroupHandovers[0].ID)

	rec = checkpointRequest(graph, checkpointScenario{
		Method: http.MethodPost, Path: "/api/substitutions/end", Authenticated: true,
		Body: fmt.Sprintf(`{"type":"group_handover","id":%q}`, handoverID),
	}, token)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.True(t, decodeSubstitutionAnswer[struct {
		Ended bool `json:"ended"`
	}](t, rec.Body.Bytes()).Ended)

	rec = checkpointRequest(graph, checkpointScenario{Method: http.MethodGet, Path: overviewPath, Authenticated: true}, token)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Empty(t, decodeSubstitutionAnswer[overview](t, rec.Body.Bytes()).GroupHandovers, "the ended handover no longer runs")
}

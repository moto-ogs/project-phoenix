package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The staff portal reads and writes the staff record through the catalog
// proxy (#7563), which holds every answer to the contract. These requests go
// through the composed /staff router, so the answer check holds the create
// and the offboarding to their registrations.
func TestStaffRecordCreateAndOffboardThroughTheRouter(t *testing.T) {
	t.Parallel()
	route := setupExternalCaregiverRoute(t, "test")
	person := testpkg.CreateTestPersonForTenant(t, route.db, route.tenantID, "Rita", "Record")
	claims := testutil.DefaultTestClaims()
	claims.ID = int(route.actor)
	claims.Permissions = []string{"users:create", "users:delete"}
	auth := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))

	// The person id travels as a decimal string, as the staff screens send it.
	status, body := route.post(t, "/staff", map[string]any{"person_id": strconv.FormatInt(person.ID, 10), "staff_notes": " neu "}, auth)
	require.Equal(t, http.StatusCreated, status, string(body))
	var created struct {
		Data struct {
			ID        string `json:"id"`
			PersonID  string `json:"person_id"`
			IsTeacher bool   `json:"is_teacher"`
			TeacherID *int64 `json:"teacher_id"`
			Person    struct {
				FirstName string `json:"first_name"`
			} `json:"person"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &created), string(body))
	assert.Equal(t, strconv.FormatInt(person.ID, 10), created.Data.PersonID)
	assert.Equal(t, "Rita", created.Data.Person.FirstName)
	assert.False(t, created.Data.IsTeacher)
	assert.Nil(t, created.Data.TeacherID, "a record without a teacher profile carries no teacher_id")
	require.NotEmpty(t, created.Data.ID)

	rr := testutil.ExecuteRequest(route.router, testutil.NewAuthenticatedRequest(t, http.MethodDelete, "/staff/"+created.Data.ID, nil, auth))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var deleted map[string]any
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &deleted))
	assert.NotContains(t, deleted, "data", "the offboarding answers no data")
}

package students_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/stretchr/testify/require"
)

// detailVersion is the master-data version the child's page reads and its
// edit form sends back as expected_version (ADR 0311).
func detailVersion(t *testing.T, tc *testContext, studentID int64) string {
	t.Helper()
	rr := authExec(t, tc, testutil.NewRequest("GET", fmt.Sprintf("/%d", studentID), nil), testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var detail struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &detail))
	require.NotEmpty(t, detail.Data.Version)
	return detail.Data.Version
}

// studentUpdateRequest is the PUT /{id} the edit form sends after reading the
// child: a body with master data carries the version unless the case sets
// its own; a pure absence report carries none.
func studentUpdateRequest(t *testing.T, tc *testContext, studentID int64, body map[string]any) *http.Request {
	t.Helper()
	if _, own := body["expected_version"]; !own {
		for key := range body {
			if key != "sick" && key != "excused" && key != "sick_reason" {
				body["expected_version"] = detailVersion(t, tc, studentID)
				break
			}
		}
	}
	return testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/%d", studentID), body)
}

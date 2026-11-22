package careplanhttp_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	careplanhttp "github.com/moto-ogs/project-phoenix/modules/careplan/http"
)

// A refused author is the caller's to fix and names its reason; a failed
// lookup is the server's and must not read as a missing right (#7766).
func TestRenderScheduleAuthorError(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"account without staff record", careplanhttp.ErrUserNotStaffForTest, http.StatusForbidden, "students.schedule_staff_profile_required"},
		{"account without person", careplanhttp.ErrPersonNotFoundForAccountForTest, http.StatusForbidden, "students.schedule_staff_profile_required"},
		{"failed staff lookup", errors.New("find staff by person: connection refused"), http.StatusInternalServerError, "general.server"},
	}
	for _, tc := range cases {
		recorder := httptest.NewRecorder()
		careplanhttp.RenderScheduleAuthorErrorForTest(recorder, httptest.NewRequest(http.MethodPost, "/", nil), tc.err)

		assert.Equal(t, tc.status, recorder.Code, tc.name)
		assert.Contains(t, recorder.Body.String(), `"code":"`+tc.code+`"`, tc.name)
	}
}

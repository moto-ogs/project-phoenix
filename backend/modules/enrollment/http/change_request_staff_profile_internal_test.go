package enrollmenthttp

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// Approving a change of weekly times writes them in the reviewer's name. A
// reviewer without a staff record is told so, as at a first approval, and
// does not get a server error (#7818).
func TestChangeRequestApprovalWithoutStaffProfileNamesTheReason(t *testing.T) {
	t.Parallel()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/change-requests/1/approve", nil)
	mapChangeRequestError(rr, req, fmt.Errorf("sync approved child: %w", capability.ErrDecisionReviewerStaffRequired))

	assert.Equal(t, http.StatusForbidden, rr.Code)
	assert.Contains(t, rr.Body.String(), `"code":"enrollment.approval_staff_profile_required"`)
}

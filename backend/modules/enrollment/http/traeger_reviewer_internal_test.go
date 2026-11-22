package enrollmenthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/api/testutil/routetest"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// Only a session the Träger-Büro opened through the Absprung marks the
// request (#7818); an ordinary admin session stays unmarked.
func TestMarkTraegerBueroReviewerFollowsTheClaim(t *testing.T) {
	t.Parallel()

	for _, viaTraeger := range []bool{true, false} {
		var marked bool
		handler := markTraegerBueroReviewer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			marked = capability.TraegerBueroReviewer(r.Context())
		}))
		claims := testutil.AdminTestClaims(1)
		claims.ViaTraeger = viaTraeger
		req := httptest.NewRequest(http.MethodPost, "/admin/requests/1/children/2/decide", nil)
		routetest.WithClaims(t, claims)(req)
		handler.ServeHTTP(httptest.NewRecorder(), req)
		assert.Equal(t, viaTraeger, marked, "via_traeger=%v", viaTraeger)
	}
}

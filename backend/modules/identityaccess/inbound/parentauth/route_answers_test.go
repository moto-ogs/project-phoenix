//go:build testhooks

package parentauth_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil/routetest"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/parentauth"
)

// parentSecondFactorStub switches the factor off; every other method of the
// capability is unused here.
type parentSecondFactorStub struct {
	identityaccess.ParentSecondFactor
	accountID int64
	password  string
}

func (s *parentSecondFactorStub) DisableParentMFA(_ context.Context, accountID int64, currentPassword, _, _ string) error {
	s.accountID, s.password = accountID, currentPassword
	return nil
}

type parentSignInStub struct{ identityaccess.ParentSignIn }

// The parent switches the voluntary factor off under the /parent mount, so
// the answer is held to its registered route (#7808). The real switch-off
// with the current password is covered by the Identity & Access behaviour
// tests.
func TestParentMFADisableAnswersUnderItsMount(t *testing.T) {
	t.Parallel()
	svc := &parentSecondFactorStub{}
	routes := parentauth.NewResource(&identityaccess.ParentAccess{ParentSignIn: parentSignInStub{}, ParentSecondFactor: svc})
	const accountID = 52
	parent := chi.NewRouter()
	parent.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := routetest.Claims{ID: accountID, Scope: "parent"}
			next.ServeHTTP(w, r.WithContext(routetest.WithAuthenticatedContext(r.Context(), claims, nil)))
		})
	})
	routes.MountCredentialChecks(parent)
	router := chi.NewRouter()
	router.Mount("/parent", parent)

	req := httptest.NewRequest(http.MethodPost, "/parent/me/mfa/disable", bytes.NewBufferString(`{"current_password":"secret"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.EqualValues(t, accountID, svc.accountID)
	assert.Equal(t, "secret", svc.password)
}

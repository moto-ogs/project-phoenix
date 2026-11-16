package account

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
)

// logoutStub satisfies AccountSessions with only LogoutWithAudit.
type logoutStub struct {
	AccountSessions
	err      error
	gotToken string
}

func (s *logoutStub) LogoutWithAudit(_ context.Context, refreshToken, _, _ string) error {
	s.gotToken = refreshToken
	return s.err
}

func runLogout(t *testing.T, sessions *logoutStub) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	req = req.WithContext(context.WithValue(req.Context(), sessiontoken.CtxRefreshToken, "refresh-token"))
	rr := httptest.NewRecorder()
	(&Resource{Sessions: sessions}).logout(rr, req)
	return rr
}

// A logout whose revocation fails must not pass for done (#7209): the
// answer is an error with its own code, and the cause stays in the log.
func TestLogoutAnswersFailedRevocationWithItsCode(t *testing.T) {
	t.Parallel()

	sessions := &logoutStub{err: errors.New("delete token family: connection reset")}
	rr := runLogout(t, sessions)

	assert.Equal(t, "refresh-token", sessions.gotToken)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	assert.Equal(t, "identity.logout_not_revoked", decodeWireError(t, rr).Code)
	assert.NotContains(t, rr.Body.String(), "connection reset", "the cause stays in the log")
}

func TestLogoutOutcomes(t *testing.T) {
	t.Parallel()

	t.Run("revoked", func(t *testing.T) {
		t.Parallel()
		rr := runLogout(t, &logoutStub{})
		assert.Equal(t, http.StatusNoContent, rr.Code)
	})
	t.Run("nothing left to revoke", func(t *testing.T) {
		t.Parallel()
		rr := runLogout(t, &logoutStub{err: identityaccess.ErrInvalidToken})
		assert.Equal(t, http.StatusUnauthorized, rr.Code)
	})
}

package me

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// preferencesDouble keeps the choices per holder, so a test sees which
// holder (account or operator) a session wrote; err injects a failure.
type preferencesDouble struct {
	choices map[identityaccess.DisplayPreferenceHolder]bool
	err     error
}

func (d *preferencesDouble) FindDisplayPreferences(_ context.Context, holder identityaccess.DisplayPreferenceHolder) (identityaccess.DisplayPreferences, error) {
	if d.err != nil {
		return identityaccess.DisplayPreferences{}, d.err
	}
	choice, ok := d.choices[holder]
	if !ok {
		return identityaccess.DisplayPreferences{}, nil
	}
	return identityaccess.DisplayPreferences{MoreContrast: &choice}, nil
}

func (d *preferencesDouble) SetMoreContrast(ctx context.Context, holder identityaccess.DisplayPreferenceHolder, moreContrast bool) (identityaccess.DisplayPreferences, error) {
	if d.err != nil {
		return identityaccess.DisplayPreferences{}, d.err
	}
	d.choices[holder] = moreContrast
	return d.FindDisplayPreferences(ctx, holder)
}

func preferencesRouter(preferences identityaccess.AccountDisplayPreferences, claims sessiontoken.AppClaims) http.Handler {
	return NewDisplayPreferencesResource(preferences).Router(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessiontoken.CtxClaims, claims)))
			})
		})
	})
}

// Every portal reads and writes its own person's choice: the platform scope
// the operator's, every other scope the account's with the same ID.
func TestDisplayPreferencesStartUndecidedAndRecordTheOwnChoicePerPortal(t *testing.T) {
	t.Parallel()

	sessions := map[string]struct {
		claims sessiontoken.AppClaims
		holder identityaccess.DisplayPreferenceHolder
	}{
		"tenant":   {sessiontoken.AppClaims{ID: consentAccountID, TenantID: 42}, identityaccess.DisplayPreferenceHolder{ID: consentAccountID}},
		"school":   {sessiontoken.AppClaims{ID: consentAccountID, Scope: "school", TenantID: 42}, identityaccess.DisplayPreferenceHolder{ID: consentAccountID}},
		"parent":   {sessiontoken.AppClaims{ID: consentAccountID, Scope: "parent"}, identityaccess.DisplayPreferenceHolder{ID: consentAccountID}},
		"org":      {sessiontoken.AppClaims{ID: consentAccountID, Scope: "org", OrgID: 7}, identityaccess.DisplayPreferenceHolder{ID: consentAccountID}},
		"caterer":  {sessiontoken.AppClaims{ID: consentAccountID, Scope: "caterer"}, identityaccess.DisplayPreferenceHolder{ID: consentAccountID}},
		"platform": {sessiontoken.AppClaims{ID: consentAccountID, Scope: "platform"}, identityaccess.DisplayPreferenceHolder{Operator: true, ID: consentAccountID}},
	}
	for name, session := range sessions {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			preferences := &preferencesDouble{choices: map[identityaccess.DisplayPreferenceHolder]bool{}}
			router := preferencesRouter(preferences, session.claims)

			rec, body := serveConsent(t, router, http.MethodGet, "")
			require.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			data := body["data"].(map[string]any)
			require.Contains(t, data, "moreContrast")
			assert.Nil(t, data["moreContrast"], "undecided reads as null, never as false")

			rec, body = serveConsent(t, router, http.MethodPut, `{"moreContrast":true}`)
			require.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			assert.Equal(t, true, body["data"].(map[string]any)["moreContrast"])
			assert.Equal(t, map[identityaccess.DisplayPreferenceHolder]bool{session.holder: true}, preferences.choices,
				"the session writes its own holder only")

			_, body = serveConsent(t, router, http.MethodPut, `{"moreContrast":false}`)
			assert.Equal(t, false, body["data"].(map[string]any)["moreContrast"])
			_, body = serveConsent(t, router, http.MethodGet, "")
			assert.Equal(t, false, body["data"].(map[string]any)["moreContrast"])
		})
	}
}

// A staff-view preview carries the target's identity: it neither reads nor
// changes the target's preferences.
func TestDisplayPreferencesRefusePreviewSessions(t *testing.T) {
	t.Parallel()

	for name, claims := range map[string]sessiontoken.AppClaims{
		"preview":    {ID: consentAccountID, TenantID: 42, ReadOnly: true, ActingAdminID: 9},
		"no account": {TenantID: 42},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			preferences := &preferencesDouble{choices: map[identityaccess.DisplayPreferenceHolder]bool{}}
			router := preferencesRouter(preferences, claims)
			for _, method := range []string{http.MethodGet, http.MethodPut} {
				rec, body := serveConsent(t, router, method, `{"moreContrast":true}`)
				assert.Equal(t, http.StatusForbidden, rec.Code, method)
				assert.NotEmpty(t, body["code"])
			}
			assert.Empty(t, preferences.choices)
		})
	}
}

func TestDisplayPreferencesNeedAChoice(t *testing.T) {
	t.Parallel()

	preferences := &preferencesDouble{choices: map[identityaccess.DisplayPreferenceHolder]bool{}}
	router := preferencesRouter(preferences, sessiontoken.AppClaims{ID: consentAccountID, TenantID: 42})
	for _, body := range []string{`{}`, `{"moreContrast":null}`, `not json`} {
		rec, decoded := serveConsent(t, router, http.MethodPut, body)
		assert.Equal(t, http.StatusBadRequest, rec.Code, body)
		assert.NotEmpty(t, decoded["code"])
	}
	assert.Empty(t, preferences.choices)
}

func TestDisplayPreferencesMapCapabilityFailures(t *testing.T) {
	t.Parallel()

	claims := sessiontoken.AppClaims{ID: consentAccountID, TenantID: 42}
	for err, status := range map[error]int{
		identityaccess.ErrAccountNotFound:  http.StatusUnauthorized,
		identityaccess.ErrOperatorNotFound: http.StatusUnauthorized,
		errors.New("db down"):              http.StatusInternalServerError,
	} {
		router := preferencesRouter(&preferencesDouble{err: err}, claims)
		for _, method := range []string{http.MethodGet, http.MethodPut} {
			rec, _ := serveConsent(t, router, method, `{"moreContrast":true}`)
			assert.Equal(t, status, rec.Code, "%s %v", method, err)
		}
	}
}

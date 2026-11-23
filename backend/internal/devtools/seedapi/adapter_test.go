package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type seedHTTPRequest = testpkg.HTTPRequest
type seedHTTPResponseWriter = testpkg.HTTPResponseWriter
type seedHTTPTestServer = testpkg.HTTPTestServer

const (
	seedHTTPMethodGet    = testpkg.HTTPMethodGet
	seedHTTPMethodPost   = testpkg.HTTPMethodPost
	seedHTTPMethodPut    = testpkg.HTTPMethodPut
	seedHTTPMethodDelete = testpkg.HTTPMethodDelete

	seedHTTPStatusOK                  = testpkg.HTTPStatusOK
	seedHTTPStatusCreated             = testpkg.HTTPStatusCreated
	seedHTTPStatusNoContent           = testpkg.HTTPStatusNoContent
	seedHTTPStatusUnauthorized        = testpkg.HTTPStatusUnauthorized
	seedHTTPStatusForbidden           = testpkg.HTTPStatusForbidden
	seedHTTPStatusNotFound            = testpkg.HTTPStatusNotFound
	seedHTTPStatusConflict            = testpkg.HTTPStatusConflict
	seedHTTPStatusInternalServerError = testpkg.HTTPStatusInternalServerError
	seedHTTPStatusServiceUnavailable  = testpkg.HTTPStatusServiceUnavailable
)

// newSeedHTTPTestServer answers the reads a seeded save takes its version
// from (ADR 0311) before the test's handler: the meal plan days and a
// child's regular lunch days, from the staff or the parents' route.
func newSeedHTTPTestServer(handler func(seedHTTPResponseWriter, *seedHTTPRequest)) *testpkg.HTTPTestServer {
	return testpkg.NewHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		if r.Method == seedHTTPMethodGet {
			switch {
			case r.URL.Path == "/api/meal-plan/days":
				_, _ = fmt.Fprint(w, `{"status":"success","data":[]}`)
				return
			case strings.HasPrefix(r.URL.Path, "/api/meal-plan/participation/"), strings.HasSuffix(r.URL.Path, "/meal-participation"):
				_, _ = fmt.Fprint(w, `{"status":"success","data":{"version":"read-version"}}`)
				return
			}
		}
		handler(w, r)
	})
}

type seedTestAdapter struct{ inner *testpkg.HTTPAPIAdapter }

type seedTestRandom struct{ next byte }

func (r *seedTestRandom) Read(buffer []byte) (int, error) {
	for index := range buffer {
		r.next++
		buffer[index] = r.next
	}
	return len(buffer), nil
}

func newSeedTestRandom() *seedTestRandom { return &seedTestRandom{} }

func newSeedTestAdapter(baseURL string) *seedTestAdapter {
	return &seedTestAdapter{inner: testpkg.NewHTTPAPIAdapter(baseURL)}
}

func (a *seedTestAdapter) BaseURL() string                       { return a.inner.BaseURL() }
func (a *seedTestAdapter) CheckHealth(ctx context.Context) error { return a.inner.CheckHealth(ctx) }

func (a *seedTestAdapter) LoginOperator(ctx context.Context, email, password string) (AuthRef, error) {
	auth, err := a.inner.Login(ctx, "/operator/auth/login", email, password, "")
	return seedTestAuth(auth), seedTestLoginError(err, "operator login request failed")
}

func (a *seedTestAdapter) LoginTenant(ctx context.Context, email, password, tenantSlug string) (AuthRef, error) {
	auth, err := a.inner.Login(ctx, "/auth/login", email, password, tenantSlug)
	return seedTestAuth(auth), seedTestLoginError(err, "login request failed")
}

func (a *seedTestAdapter) LoginParent(ctx context.Context, email, password string) (AuthRef, error) {
	auth, err := a.inner.Login(ctx, "/parent/auth/login", email, password, "")
	return seedTestAuth(auth), seedTestLoginError(err, "parent login request failed")
}

// LoginTraeger reads the session of a test server that answers the Träger
// sign-in directly; the second factor is the command adapter's.
func (a *seedTestAdapter) LoginTraeger(ctx context.Context, email, password string, organizationID int64) (AuthRef, error) {
	raw, _, err := a.inner.Raw(ctx, testpkg.APIAuth{}, seedHTTPMethodPost, "/traeger/auth/login",
		map[string]any{"email": email, "password": password, "organization_id": strconv.FormatInt(organizationID, 10)}, nil)
	if err != nil {
		return AuthRef{}, seedTestLoginError(err, "traeger login request failed")
	}
	var login struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(raw, &login); err != nil || login.AccessToken == "" {
		return AuthRef{}, fmt.Errorf("traeger login returned no session: %s", raw)
	}
	return AuthRef{Kind: AuthBearer, Label: "traeger", Token: login.AccessToken}, nil
}

func (a *seedTestAdapter) Raw(ctx context.Context, auth AuthRef, method, path string, body any, headers map[string]string) ([]byte, int, error) {
	raw, status, err := a.inner.Raw(ctx, seedTestAPIAuth(auth), method, path, body, headers)
	return raw, status, seedTestError(err)
}

func (a *seedTestAdapter) RawUpload(ctx context.Context, auth AuthRef, method, path, contentType string, body []byte) ([]byte, int, error) {
	raw, status, err := a.inner.RawUpload(ctx, seedTestAPIAuth(auth), method, path, contentType, body)
	return raw, status, seedTestError(err)
}

func seedTestAuth(auth testpkg.APIAuth) AuthRef {
	return AuthRef{Kind: AuthKind(auth.Kind), Label: auth.Label, Token: auth.Token, APIKey: auth.APIKey, PIN: auth.PIN}
}

func seedTestAPIAuth(auth AuthRef) testpkg.APIAuth {
	return testpkg.APIAuth{Kind: string(auth.Kind), Label: auth.Label, Token: auth.Token, APIKey: auth.APIKey, PIN: auth.PIN}
}

func seedTestError(err error) error {
	var requestErr *testpkg.APIRequestError
	if errors.As(err, &requestErr) {
		return &APIError{Method: requestErr.Method, Path: requestErr.Path, StatusCode: requestErr.StatusCode, Code: requestErr.Code, Message: requestErr.Message, Body: requestErr.Body, RetryAfter: requestErr.RetryAfter}
	}
	return err
}

func seedTestLoginError(err error, operation string) error {
	if err == nil {
		return nil
	}
	var apiErr *testpkg.APIRequestError
	if !errors.As(err, &apiErr) {
		return err
	}
	return fmt.Errorf("%s: %w", operation, seedTestError(err))
}

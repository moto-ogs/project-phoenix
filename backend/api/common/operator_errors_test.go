package common_test

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These cases pinned the Err* helpers of api/operator, which were thin
// delegations to the Operator* constructors; they moved here when the
// delegations were removed (#3231).

// extractOperatorErrResponse renders the body and returns the HTTP status,
// the envelope's status member and its detail.
func extractOperatorErrResponse(t *testing.T, renderer render.Renderer) (int, int, string) {
	t.Helper()
	errResp, ok := renderer.(*common.ErrResponse)
	require.True(t, ok, "Expected *common.ErrResponse")
	require.NoError(t, render.Render(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil), renderer))
	return errResp.HTTPStatusCode, errResp.Status, errResp.Detail
}

func TestOperatorInvalidRequest(t *testing.T) {
	t.Parallel()

	err := errors.New("invalid field")
	renderer := common.OperatorInvalidRequest(err)

	status, statusText, errorText := extractOperatorErrResponse(t, renderer)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, status, statusText, "the envelope status is the HTTP status number")
	assert.Contains(t, errorText, "invalid field")
}

func TestOperatorInvalidCredentials(t *testing.T) {
	t.Parallel()

	renderer := common.OperatorInvalidCredentials()

	status, statusText, errorText := extractOperatorErrResponse(t, renderer)
	assert.Equal(t, http.StatusUnauthorized, status)
	assert.Equal(t, status, statusText, "the envelope status is the HTTP status number")
	assert.Equal(t, "Invalid email or password", errorText)
}

func TestOperatorForbidden(t *testing.T) {
	t.Parallel()

	renderer := common.OperatorForbidden("Access denied")

	status, statusText, errorText := extractOperatorErrResponse(t, renderer)
	assert.Equal(t, http.StatusForbidden, status)
	assert.Equal(t, status, statusText, "the envelope status is the HTTP status number")
	assert.Equal(t, "Access denied", errorText)
}

func TestOperatorInternal(t *testing.T) {
	t.Parallel()

	renderer := common.OperatorInternal(errors.New("adapter: connection reset"), "Internal error")

	status, statusText, errorText := extractOperatorErrResponse(t, renderer)
	assert.Equal(t, http.StatusInternalServerError, status)
	assert.Equal(t, status, statusText, "the envelope status is the HTTP status number")
	assert.Equal(t, "Internal error", errorText)
}

// An operator renderer's internal fallback keeps its error, so RenderError
// lifts a business rejection in it, an edit on a changed state among them
// (ADR 0311), to its 409 and code; any other error stays a 500 with the
// fixed text.
func TestOperatorInternalKeepsABusinessRejection(t *testing.T) {
	t.Parallel()
	render := func(err error) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		common.RenderError(rec, httptest.NewRequest(http.MethodPut, "/", nil), common.OperatorInternal(err, "An error occurred"))
		return rec
	}

	changed := render(fmt.Errorf("update announcement: %w", readstate.ErrChanged))
	assert.Equal(t, http.StatusConflict, changed.Code, changed.Body.String())
	assert.Contains(t, changed.Body.String(), `"code":"general.changed_since_read"`)

	failed := render(errors.New("adapter: connection reset"))
	assert.Equal(t, http.StatusInternalServerError, failed.Code)
	assert.Contains(t, failed.Body.String(), "An error occurred")
	assert.NotContains(t, failed.Body.String(), "connection reset", "the cause is logged, not answered")
}

func TestOperatorServiceUnavailable(t *testing.T) {
	t.Parallel()

	renderer := common.OperatorServiceUnavailable("MFA status temporarily unavailable, please retry")

	status, statusText, errorText := extractOperatorErrResponse(t, renderer)
	assert.Equal(t, http.StatusServiceUnavailable, status)
	assert.Equal(t, status, statusText, "the envelope status is the HTTP status number")
	assert.Equal(t, "MFA status temporarily unavailable, please retry", errorText)
}

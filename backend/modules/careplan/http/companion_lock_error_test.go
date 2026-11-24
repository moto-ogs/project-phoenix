package careplanhttp_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/departure"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/moto-ogs/project-phoenix/workflows/studentdeletion"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// rendererStatus reads the HTTP status a renderer will set. The renderers under
// test always produce *common.ErrResponse; anything else is a bug worth failing
// on rather than skipping over.
func rendererStatus(t *testing.T, renderer interface{}) *common.ErrResponse {
	t.Helper()
	resp, ok := renderer.(*common.ErrResponse)
	require.True(t, ok, "renderer is not a *common.ErrResponse: %T", renderer)
	return resp
}

func TestUpdateStudentTxErrorRenderer_CompanionLockBusy(t *testing.T) {
	t.Parallel()

	t.Run("busy lock is a retriable conflict", func(t *testing.T) {
		resp := rendererStatus(t, updateStudentTxErrorRenderer(careplan.ErrCompanionLockBusy))

		assert.Equal(t, http.StatusConflict, resp.HTTPStatusCode)
		// The German sentence travels to the UI unchanged — it is the only
		// instruction the user gets ("in einem Moment erneut speichern").
		assert.Equal(t, studentdeletion.ErrCompanionLockBusy.Error(), resp.Detail)
		assert.Equal(t, careplan.ErrCompanionLockBusy.Error(), resp.Detail, "the workflow keeps the user-facing text of the update path")
	})

	t.Run("still a conflict when wrapped by a caller", func(t *testing.T) {
		// The repository raises the sentinel several layers below the handler,
		// and intermediate layers are free to add context — errors.Is has to
		// carry the classification, not a top-level equality check.
		resp := rendererStatus(t, updateStudentTxErrorRenderer(
			errors.Join(errors.New("update student"), departure.ErrCompanionLockBusy),
		))

		assert.Equal(t, http.StatusConflict, resp.HTTPStatusCode)
	})

	t.Run("the Care Plan and People Directory sentinels answer alike", func(t *testing.T) {
		// Care Plan raises its own sentinel for a companion row it may not
		// wait for; the People Directory write path raises the models one.
		// Both must reach the same retriable conflict with the same German
		// text, or one path would silently fall through to the 500 branch.
		carePlan := rendererStatus(t, updateStudentTxErrorRenderer(careplan.ErrCompanionLockBusy))
		people := rendererStatus(t, updateStudentTxErrorRenderer(departure.ErrCompanionLockBusy))

		assert.Equal(t, http.StatusConflict, carePlan.HTTPStatusCode)
		assert.Equal(t, http.StatusConflict, people.HTTPStatusCode)
		assert.Equal(t, departure.ErrCompanionLockBusy.Error(), careplan.ErrCompanionLockBusy.Error())
	})

	t.Run("an unrelated error is still a server error", func(t *testing.T) {
		resp := rendererStatus(t, updateStudentTxErrorRenderer(errors.New("boom")))

		assert.Equal(t, http.StatusInternalServerError, resp.HTTPStatusCode)
	})
}

// TestUpdateStudentTxErrorRenderer_CompanionsChanged pins the third 409 this
// endpoint can answer with: the submitted "läuft mit" list was built on a
// snapshot someone else has since replaced. The owner refuses it with
// readstate.ErrChanged (ADR 0311), which the shared error path answers with
// 409 general.changed_since_read; this table must not claim it first, or the
// lock collision's "just try again" would hide the "reload first".
func TestUpdateStudentTxErrorRenderer_CompanionsChanged(t *testing.T) {
	t.Parallel()

	for name, err := range map[string]error{
		"a stale list":        readstate.ErrChanged,
		"wrapped by a caller": errors.Join(errors.New("update student"), readstate.ErrChanged),
	} {
		w := httptest.NewRecorder()
		common.RenderError(w, httptest.NewRequest(http.MethodPut, "/", nil), updateStudentTxErrorRenderer(err))
		assert.Equal(t, http.StatusConflict, w.Code, name)
		assert.Contains(t, w.Body.String(), `"code":"`+readstate.ChangedCode+`"`, name)
	}
}

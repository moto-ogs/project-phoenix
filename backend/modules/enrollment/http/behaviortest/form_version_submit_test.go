package enrollmenthttp_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The form version is the read-state token of a submission (ADR 0311): a
// family that filled the form before the school published a new version is
// refused and nothing is stored, so its consents are never recorded as given
// to a form it did not see. The current version submits.
func TestSubmitRefusesAnOutdatedFormVersion(t *testing.T) {
	t.Parallel()
	env := setupRequestTest(t)
	ctx := testpkg.Ctx(t)
	shown := env.schemaID
	published, err := NewTestFormSchemas(env.repos.Enrollment()).UpdateSchema(ctx, env.schemaID, []capability.FormField{
		{Key: "allergies", Label: "Allergien und Unverträglichkeiten", Type: capability.FormFieldText, SortOrder: 0},
	}, env.creatorID)
	require.NoError(t, err)

	stale := validSubmission(t, env.phaseID)
	stale.DisplayedFormSchemaID = shown
	_, err = env.svc.Submit(ctx, stale)
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.Zero(t, tableCount(t, env.db, "enrollment.requests", "phase_id = ?", env.phaseID))

	submission := validSubmission(t, env.phaseID)
	submission.DisplayedFormSchemaID = published.ID
	_, err = env.svc.Submit(ctx, submission)
	require.NoError(t, err)
	assert.Equal(t, 1, tableCount(t, env.db, "enrollment.requests", "phase_id = ? AND schema_id = ?", env.phaseID, published.ID))
}

// The office's manual enrollment sends the version of the form it filled;
// another one is answered 409 general.changed_since_read and stores nothing.
func TestCreateManualApprovedEnrollment_RefusesAnOutdatedForm(t *testing.T) {
	t.Parallel()
	m := setupManualEnrollmentRouter(t)
	rec := m.postManualEnrollmentForm(t, *m.phase.FormSchemaID+1_000_000, manualPaperChild(), "", false)

	require.Equal(t, http.StatusConflict, rec.Code, "Body: %s", rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"code":"`+readstate.ChangedCode+`"`)
	assert.Zero(t, tableCount(t, m.db, "enrollment.requests", "phase_id = ?", m.phase.ID))
	assert.Zero(t, studentsNamed(t, m.db, "Mara", "Papier"))
}

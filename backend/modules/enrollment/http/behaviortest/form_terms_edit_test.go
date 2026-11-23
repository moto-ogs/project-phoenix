package enrollmenthttp_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// draftTerms is the terms_fingerprint the status page's edit bootstrap shows.
func draftTerms(t *testing.T, env *requestTestEnv, statusToken string) string {
	t.Helper()
	draft, err := env.svc.GetEditDraft(testpkg.Ctx(t), statusToken)
	require.NoError(t, err)
	return capability.FormTermsFingerprint(draft.Schema, draft.LegalTexts.Blocks)
}

// schoolTextsChangeAfterTheRead submits a request, reads its edit page and
// then changes the school's Datenschutz text, which the form shows because
// it has no blocks of its own. It returns the submission and the token read.
func schoolTextsChangeAfterTheRead(t *testing.T, env *requestTestEnv) (*enrollmentAPI.SubmitResult, string) {
	t.Helper()
	env.settings.boolValues[settingKeyLegalDSGVOEnabled] = true
	env.settings.stringValues[settingKeyLegalDSGVOText] = "Wir speichern die Angaben bis zum Ende der Betreuung."
	result, err := env.svc.Submit(testpkg.Ctx(t), validSubmission(t, env.phaseID))
	require.NoError(t, err)
	read := draftTerms(t, env, result.Request.StatusToken)
	env.settings.stringValues[settingKeyLegalDSGVOText] = "Wir geben die Angaben an den Träger weiter."
	return result, read
}

// An edit over the status link re-confirms the legal blocks: an edit page
// read before the school changed its texts is refused and changes nothing,
// so the old consent is not stored for the new text (ADR 0311).
func TestReplaceEditable_RefusesAnEditPageReadBeforeTheTextsChanged(t *testing.T) {
	t.Parallel()
	env := setupRequestTest(t)
	ctx := testpkg.Ctx(t)
	result, read := schoolTextsChangeAfterTheRead(t, env)

	edit := proposedChangeSubmission(t, env, result)
	edit.GuardianFirstName = "Anne"
	edit.ExpectedTermsFingerprint = read
	_, err := env.svc.ReplaceEditable(ctx, result.Request.StatusToken, edit)
	require.ErrorIs(t, err, readstate.ErrChanged)
	stored, _, err := env.svc.GetByStatusToken(ctx, result.Request.StatusToken)
	require.NoError(t, err)
	assert.Equal(t, "Anna", stored.GuardianFirstName, "the refused edit changes nothing")

	edit.ExpectedTermsFingerprint = draftTerms(t, env, result.Request.StatusToken)
	_, err = env.svc.ReplaceEditable(ctx, result.Request.StatusToken, edit)
	require.NoError(t, err)
}

// A change request carries the same token: one proposed on a form read
// before the school changed its texts is refused and stores no proposal.
func TestChangeRequestService_Create_RefusesAFormReadBeforeTheTextsChanged(t *testing.T) {
	t.Parallel()
	env := setupRequestTest(t)
	ctx := testpkg.Ctx(t)
	result, _ := schoolTextsChangeAfterTheRead(t, env)
	enableChangeRequestMode(t, env, result.Children[0].ID)
	read := draftTerms(t, env, result.Request.StatusToken)
	env.settings.stringValues[settingKeyLegalDSGVOText] = "Wir geben die Angaben an den Träger und das Schulamt weiter."
	svc := newChangeRequestServiceForTest(env)

	proposed := proposedChangeSubmission(t, env, result)
	proposed.Children[0].FirstName = "Lina-Marie"
	proposed.ExpectedTermsFingerprint = read
	_, err := svc.Create(ctx, result.Request.StatusToken, enrollmentAPI.CreateChangeRequestInput{Submission: proposed, ParentNote: "Bitte Namen korrigieren."})
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.Zero(t, tableCount(t, env.db, "enrollment.change_requests", "request_id = ?", result.Request.ID))

	proposed.ExpectedTermsFingerprint = draftTerms(t, env, result.Request.StatusToken)
	_, err = svc.Create(ctx, result.Request.StatusToken, enrollmentAPI.CreateChangeRequestInput{Submission: proposed, ParentNote: "Bitte Namen korrigieren."})
	require.NoError(t, err)
}

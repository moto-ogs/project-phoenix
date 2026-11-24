package enrollmenthttp_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// shownTerms is the terms_fingerprint the phase's form shows now.
func shownTerms(t *testing.T, env *requestTestEnv) string {
	t.Helper()
	return phaseTerms(t, env.svc, env.phaseID)
}

// phaseTerms is the terms_fingerprint the form of the phase shows now, read
// through the form load like the form client.
func phaseTerms(t *testing.T, requests enrollmentAPI.RequestService, phaseID int64) string {
	t.Helper()
	id, err := tenant.NewTenantID(testpkg.Tenant(t))
	require.NoError(t, err)
	var terms string
	require.NoError(t, tenant.WithinTenant(testpkg.Ctx(t), id, func(ctx context.Context) error {
		bootstrap, err := requests.LoadManualEnrollmentBootstrap(ctx, phaseID)
		if err == nil {
			terms = capability.FormTermsFingerprint(bootstrap.Schema, bootstrap.LegalTexts.Blocks)
		}
		return err
	}))
	require.NotEmpty(t, terms)
	return terms
}

// The form token is the read-state token of a submission (ADR 0311): a
// family that filled the form before the school published a new version is
// refused and nothing is stored, so its consents are never recorded as given
// to a form it did not see. The current token submits.
func TestSubmitRefusesAnOutdatedFormVersion(t *testing.T) {
	t.Parallel()
	env := setupRequestTest(t)
	ctx := testpkg.Ctx(t)
	read := shownTerms(t, env)
	published, err := NewTestFormSchemas(env.repos.Enrollment()).UpdateSchema(ctx, env.schemaID, []capability.FormField{
		{Key: "allergies", Label: "Allergien und Unverträglichkeiten", Type: capability.FormFieldText, SortOrder: 0},
	}, env.creatorID)
	require.NoError(t, err)

	stale := validSubmission(t, env.phaseID)
	stale.DisplayedFormSchemaID, stale.ExpectedTermsFingerprint = env.schemaID, read
	_, err = env.svc.Submit(ctx, stale)
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.Zero(t, tableCount(t, env.db, "enrollment.requests", "phase_id = ?", env.phaseID))

	_, err = env.svc.Submit(ctx, validSubmission(t, env.phaseID))
	require.NoError(t, err)
	assert.Equal(t, 1, tableCount(t, env.db, "enrollment.requests", "phase_id = ? AND schema_id = ?", env.phaseID, published.ID))
}

// A form without blocks of its own shows the school's legal texts. When the
// school changes them, the form version stays, but the token changes: the
// family's consent to the old Datenschutz text is refused, not stored for
// the new one.
func TestSubmitRefusesAFormWhoseSchoolTextsChanged(t *testing.T) {
	t.Parallel()
	env := setupRequestTest(t)
	env.settings.boolValues[settingKeyLegalDSGVOEnabled] = true
	env.settings.stringValues[settingKeyLegalDSGVOText] = "Wir speichern die Angaben bis zum Ende der Betreuung."
	read := shownTerms(t, env)
	env.settings.stringValues[settingKeyLegalDSGVOText] = "Wir geben die Angaben an den Träger weiter."

	stale := validSubmission(t, env.phaseID)
	stale.ExpectedTermsFingerprint = read
	_, err := env.svc.Submit(testpkg.Ctx(t), stale)
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.Zero(t, tableCount(t, env.db, "enrollment.requests", "phase_id = ?", env.phaseID))

	_, err = env.svc.Submit(testpkg.Ctx(t), validSubmission(t, env.phaseID))
	require.NoError(t, err)
}

// A new version that asks for a signature refuses a form of the old one as
// outdated, not as unsigned: only the reload shows the family the signature
// field, so the signature check must not answer first.
func TestSubmitRefusesAnOutdatedFormBeforeAskingForItsSignature(t *testing.T) {
	t.Parallel()
	env := setupRequestTest(t)
	read := shownTerms(t, env)
	_, err := NewTestFormSchemas(env.repos.Enrollment()).UpdateSchema(testpkg.Ctx(t), env.schemaID, []capability.FormField{
		{Key: "allergies", Label: "Allergien", Type: capability.FormFieldText, SortOrder: 0},
	}, env.creatorID, capability.CoreRequirements{capability.CoreRequirementSignature: true})
	require.NoError(t, err)

	stale := validSubmission(t, env.phaseID)
	stale.ExpectedTermsFingerprint = read
	_, err = env.svc.Submit(testpkg.Ctx(t), stale)
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.NotErrorIs(t, err, capability.ErrSignatureRequired)
}

// The office's manual enrollment sends the token of the form it filled;
// another one is answered 409 general.changed_since_read and stores nothing.
func TestCreateManualApprovedEnrollment_RefusesAnOutdatedForm(t *testing.T) {
	t.Parallel()
	m := setupManualEnrollmentRouter(t)
	m.terms = "outdated"
	rec := m.postManualEnrollmentForm(t, *m.phase.FormSchemaID, manualPaperChild(), "", false)

	require.Equal(t, http.StatusConflict, rec.Code, "Body: %s", rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"code":"`+readstate.ChangedCode+`"`)
	assert.Zero(t, tableCount(t, m.db, "enrollment.requests", "phase_id = ?", m.phase.ID))
	assert.Zero(t, studentsNamed(t, m.db, "Mara", "Papier"))
}

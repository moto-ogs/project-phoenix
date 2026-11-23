package enrollmenttest

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// ShowPhaseForm sets the form token of a submission as the form page sends
// it (ADR 0311): the version and terms_fingerprint of the phase's form load.
// The caller runs inside the tenant transaction.
func ShowPhaseForm(ctx context.Context, intake *Intake, req *SubmitRequest) error {
	bootstrap, err := intake.LoadManualEnrollmentBootstrap(ctx, req.PhaseID)
	if err != nil {
		return err
	}
	showForm(bootstrap.Schema, bootstrap.LegalTexts.Blocks, req)
	return nil
}

// ShowEditForm sets the form token of an edit or a change request as the
// status page sends it: from the edit bootstrap of the request.
func ShowEditForm(ctx context.Context, intake *Intake, statusToken string, req *SubmitRequest) error {
	draft, err := intake.EditDraft(ctx, statusToken)
	if err != nil {
		return err
	}
	showForm(draft.Schema, draft.LegalTexts.Blocks, req)
	return nil
}

func showForm(schema *enrollment.FormSchema, blocks []enrollment.LegalBlock, req *SubmitRequest) {
	req.ExpectedTermsFingerprint = enrollment.FormTermsFingerprint(schema, blocks)
	if schema != nil {
		req.DisplayedFormSchemaID = schema.ID
	}
}

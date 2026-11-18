package enrollmenthttp_test

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	enrollment "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestSubmissionFreezesTheBytesOfLinkedTerms(t *testing.T) {
	t.Parallel()
	env := setupRequestTest(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)

	const pdf = "%PDF-1.7\nArchived participation terms.\n"
	const digest = "6b8794899b1a94bb2334ae24efbd27b87f1a8b7d33ef8cadcee234ea8dc0cc85"
	files := objects.UploadFiles{}
	filename := fmt.Sprintf("%d_terms.pdf", tenantID)
	path, err := files.SaveNamed(strings.NewReader(pdf), "public/uploads/enrollment-legal-documents", filename, false)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, files.RemoveUploadContext(context.Background(), path)) })

	documentURL := enrollment.EnrollmentLegalDocumentUploadPrefix + filepath.Base(path)
	env.settings.boolValues[settingKeyLegalTermsEnabled] = true
	env.settings.stringValues["enrollment.legal_agb_display_mode"] = "pdf"
	env.settings.stringValues["enrollment.legal_agb_document_url"] = documentURL

	result, err := env.svc.Submit(ctx, validSubmission(t, env.phaseID))
	require.NoError(t, err)
	stored, _, err := env.svc.GetByStatusToken(ctx, result.Request.StatusToken)
	require.NoError(t, err)
	require.Len(t, stored.LegalBlocksSnapshot, 1)
	require.Len(t, stored.LegalBlocksSnapshot[0].Blocks, 1)
	require.Equal(t, map[string]string{
		enrollment.PublicEnrollmentLegalDocumentURL(documentURL): digest,
	}, stored.LegalBlocksSnapshot[0].Blocks[0].PDFSHA256)
}

func TestApprovedChangeKeepsTheConsentWordingFromTheProposal(t *testing.T) {
	t.Parallel()
	env := setupRequestTest(t)
	ctx := testpkg.Ctx(t)
	env.settings.boolValues[settingKeyLegalPhotoEnabled] = true
	env.settings.stringValues[settingKeyLegalPhotoText] = "Nur Fotos beim Sommerfest."

	result, err := env.svc.Submit(ctx, validSubmission(t, env.phaseID))
	require.NoError(t, err)
	enableChangeRequestMode(t, env, result.Children[0].ID)
	service := newChangeRequestServiceForTest(env)

	env.settings.stringValues[settingKeyLegalPhotoText] = "Fotos beim Sportfest."
	submission := proposedChangeSubmission(t, env, result)
	submission.ConsentFlags = testFormValues(map[string]any{"photo": true})
	created, err := service.Create(ctx, result.Request.StatusToken, enrollmentAPI.CreateChangeRequestInput{Submission: submission})
	require.NoError(t, err)
	require.NotContains(t, created.ChangeRequest.ProposedSnapshot, "_legal_evidence")

	before, _, err := env.svc.GetByStatusToken(ctx, result.Request.StatusToken)
	require.NoError(t, err)
	require.Len(t, before.LegalBlocksSnapshot, 1)

	env.settings.stringValues[settingKeyLegalPhotoText] = "Fotos bei allen Schulveranstaltungen."
	_, err = testpkg.TenantQuery2(t, ctx, env.db, service.Approve, created.ChangeRequest.ID, enrollmentAPI.ReviewChangeRequestInput{
		ActorAccountID: env.creatorID,
		ActorRole:      "admin",
	})
	require.NoError(t, err)

	after, _, err := env.svc.GetByStatusToken(ctx, result.Request.StatusToken)
	require.NoError(t, err)
	require.Len(t, after.LegalBlocksSnapshot, 2)
	require.Equal(t, before.LegalBlocksSnapshot[0], after.LegalBlocksSnapshot[0])
	evidence := after.LegalBlocksSnapshot[1]
	require.True(t, evidence.ChangeRequest)
	require.Len(t, evidence.Blocks, 1)
	require.Equal(t, "Fotos beim Sportfest.", evidence.Blocks[0].Text)
	require.JSONEq(t, `{"photo":true}`, string(evidence.ConsentFlags))
	require.True(t, testFormValue(after.ConsentFlags, "photo").(bool))
}

func TestApprovalSkipsConsentEvidenceForABlockRemovedWhilePending(t *testing.T) {
	t.Parallel()
	env := setupRequestTest(t)
	ctx := testpkg.Ctx(t)
	env.settings.boolValues[settingKeyLegalPhotoEnabled] = true
	env.settings.stringValues[settingKeyLegalPhotoText] = "Fotos beim Sportfest."

	result, err := env.svc.Submit(ctx, validSubmission(t, env.phaseID))
	require.NoError(t, err)
	enableChangeRequestMode(t, env, result.Children[0].ID)
	service := newChangeRequestServiceForTest(env)

	submission := proposedChangeSubmission(t, env, result)
	phone := "+49 221 555 051"
	submission.GuardianPhone = &phone
	submission.ConsentFlags = testFormValues(map[string]any{"photo": true})
	created, err := service.Create(ctx, result.Request.StatusToken, enrollmentAPI.CreateChangeRequestInput{Submission: submission})
	require.NoError(t, err)

	env.settings.boolValues[settingKeyLegalPhotoEnabled] = false
	_, err = testpkg.TenantQuery2(t, ctx, env.db, service.Approve, created.ChangeRequest.ID, enrollmentAPI.ReviewChangeRequestInput{
		ActorAccountID: env.creatorID,
		ActorRole:      "admin",
	})
	require.NoError(t, err)

	stored, _, err := env.svc.GetByStatusToken(ctx, result.Request.StatusToken)
	require.NoError(t, err)
	require.Equal(t, &phone, stored.GuardianPhone)
	require.Len(t, stored.LegalBlocksSnapshot, 1)
	require.Nil(t, testFormValue(stored.ConsentFlags, "photo"))
}

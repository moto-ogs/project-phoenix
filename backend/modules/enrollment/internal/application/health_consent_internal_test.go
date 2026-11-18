package application

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// Health answers need the health consent; the enrollment itself never does
// (Art. 9 Abs. 2 lit. a, Art. 7 Abs. 4 DSGVO, #2787).

func healthSchema() *enrollmentNative.FormSchema {
	return &enrollmentNative.FormSchema{
		Fields: []enrollmentNative.FormField{
			{Key: "gesundheit", Type: enrollmentNative.FormFieldTextarea, AppliesToCh: true, Target: enrollmentNative.TargetStudentHealthInfo},
		},
		LegalBlocks: []enrollmentNative.FormLegalBlock{
			{Key: "pool", Kind: enrollmentNative.LegalBlockKindConsent, Title: "Schwimmen", Label: "Ja", Enabled: true, SortOrder: 50, Source: enrollmentNative.LegalBlockSourceCustom},
			{Key: enrollmentNative.ConsentKeyAGB, Kind: enrollmentNative.LegalBlockKindTerms, Title: "AGB", Label: "AGB", Required: true, Enabled: true, SortOrder: 10, Source: enrollmentNative.LegalBlockSourceStandard},
		},
	}
}

func healthSubmission(answer string, flags map[string]any) SubmitRequest {
	return SubmitRequest{ConsentFlags: flags, Children: []SubmitChild{{CustomData: map[string]any{"gesundheit": answer}}}}
}

func TestResolveSubmissionLegalBlocks_AddsHealthConsentInSortOrder(t *testing.T) {
	t.Parallel()

	svc := NewIntake(IntakeDependencies{Now: enrollmentTestClock, Settings: intakeSettingsFake{}})

	blocks, err := svc.resolveSubmissionLegalBlocks(context.Background(), healthSchema())

	require.NoError(t, err)
	keys := make([]string, 0, len(blocks))
	for _, block := range blocks {
		keys = append(keys, block.Key)
	}
	assert.Equal(t, []string{enrollmentNative.ConsentKeyAGB, enrollmentNative.ConsentKeyHealthData, "pool"}, keys)
	assert.NotContains(t, requiredConsentKeys(blocks), enrollmentNative.ConsentKeyHealthData, "the health consent stays voluntary")
	assert.Equal(t, blocks, applyTemplateLegalBlocks(enrollmentNative.LegalTexts{}, healthSchema()).Blocks, "the form shows what the submission is checked against")
}

func TestResolveSubmissionLegalBlocks_NoHealthConsentWithoutHealthField(t *testing.T) {
	t.Parallel()

	svc := NewIntake(IntakeDependencies{Now: enrollmentTestClock, Settings: intakeSettingsFake{}})
	schema := healthSchema()
	schema.Fields = nil

	blocks, err := svc.resolveSubmissionLegalBlocks(context.Background(), schema)

	require.NoError(t, err)
	for _, block := range blocks {
		assert.NotEqual(t, enrollmentNative.ConsentKeyHealthData, block.Key)
	}
}

func TestValidateHealthConsent(t *testing.T) {
	t.Parallel()

	consent := map[string]any{enrollmentNative.ConsentKeyHealthData: true}
	cases := []struct {
		name    string
		req     SubmitRequest
		refused bool
	}{
		{"answer without consent", healthSubmission("Nussallergie", nil), true},
		{"answer with declined consent", healthSubmission("Nussallergie", map[string]any{enrollmentNative.ConsentKeyHealthData: false}), true},
		{"answer with consent", healthSubmission("Nussallergie", consent), false},
		{"blank answer without consent", healthSubmission("  ", nil), false},
		{"no answer without consent", SubmitRequest{Children: []SubmitChild{{}}}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			err := validateHealthConsent(healthSchema(), tc.req, nil)

			if !tc.refused {
				assert.NoError(t, err)
				return
			}
			var rejected *enrollmentNative.InvalidInputError
			require.True(t, errors.As(err, &rejected), "got %v", err)
			assert.Equal(t, enrollmentNative.CodeHealthConsentRequired, rejected.Code)
			assert.Equal(t, "consent_flags."+enrollmentNative.ConsentKeyHealthData, rejected.Field)
		})
	}
}

func TestValidateRequiredChildFields_HealthFieldSavedAsRequiredStaysVoluntary(t *testing.T) {
	t.Parallel()

	schema := healthSchema()
	schema.Fields[0].Required = true

	assert.NoError(t, validateRequiredCustomFields(schema, SubmitRequest{Children: []SubmitChild{{}}}, nil))
}

func TestLegalBlocksSnapshotEntry_RecordsTheGuardianAgreement(t *testing.T) {
	t.Parallel()

	entry, err := legalBlocksSnapshotEntry([]enrollmentNative.LegalBlock{
		{Key: "internet_photos", Kind: enrollmentNative.LegalBlockKindConsent, Label: "Fotos im Internet", GuardianAgreement: true},
		{Key: "pool", Kind: enrollmentNative.LegalBlockKindConsent, Label: "Schwimmen"},
	}, map[string]any{"internet_photos": true}, snapshotForms{}, enrollmentTestClock(), nil)

	require.NoError(t, err)
	require.Len(t, entry.Blocks, 2)
	assert.Equal(t, enrollmentNative.GuardianAgreementLabel, entry.Blocks[0].GuardianAgreementLabel)
	assert.Empty(t, entry.Blocks[1].GuardianAgreementLabel)
}

// A request from before #2787 holds health answers without the flag. An edit
// or a change request that keeps them unchanged, and its approval, pass; a new
// or changed answer still needs the consent.
func TestValidateHealthConsent_UnchangedStoredAnswerPasses(t *testing.T) {
	t.Parallel()

	stored := []*enrollmentNative.RequestChild{{ID: 7, CustomData: formValues(map[string]any{"gesundheit": "Nussallergie"})}}
	unchanged := healthSubmission(" Nussallergie ", nil)
	unchanged.Children[0].ID = 7
	changed := healthSubmission("Nussallergie, Asthma", nil)
	changed.Children[0].ID = 7
	sibling := healthSubmission("Laktose", nil)
	sibling.Children[0].ID = 8

	assert.NoError(t, validateHealthConsent(healthSchema(), unchanged, stored))
	for _, req := range []SubmitRequest{changed, sibling} {
		var rejected *enrollmentNative.InvalidInputError
		require.True(t, errors.As(validateHealthConsent(healthSchema(), req, stored), &rejected))
		assert.Equal(t, enrollmentNative.CodeHealthConsentRequired, rejected.Code)
	}
}

// Withdrawing the health consent through the status page while health
// answers stay stored is refused; the full form withdraws both together.
func TestValidateStoredHealthConsent(t *testing.T) {
	t.Parallel()

	withAnswer := []*enrollmentNative.RequestChild{{ID: 7, CustomData: formValues(map[string]any{"gesundheit": "Nussallergie"})}}
	withoutAnswer := []*enrollmentNative.RequestChild{{ID: 7}}

	var rejected *enrollmentNative.InvalidInputError
	require.True(t, errors.As(validateStoredHealthConsent(healthSchema(), map[string]any{"health_data": false}, withAnswer), &rejected))
	assert.Equal(t, enrollmentNative.CodeHealthConsentRequired, rejected.Code)
	assert.NoError(t, validateStoredHealthConsent(healthSchema(), map[string]any{"health_data": true}, withAnswer))
	assert.NoError(t, validateStoredHealthConsent(healthSchema(), map[string]any{}, withoutAnswer))
}

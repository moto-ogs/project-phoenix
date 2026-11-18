package enrollment

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The rules decided in #2787, applied when a template is saved.

func TestFormLegalBlockValidate_PrivacyNoticeHasNoCheckbox(t *testing.T) {
	t.Parallel()

	block := FormLegalBlock{
		Key: ConsentKeyDataProcessing, Kind: LegalBlockKindPrivacyNotice, Title: "Datenschutzinformation",
		Label: legacyPrivacyNoticeLabel, Required: true, Enabled: true, Source: LegalBlockSourceStandard,
	}

	require.NoError(t, block.Validate())
	assert.False(t, block.Required)
	assert.Equal(t, PrivacyNoticeLabel, block.Label)
}

func TestFormLegalBlockValidate_PrivacyNoticeKeepsTheSchoolsOwnLabel(t *testing.T) {
	t.Parallel()

	block := FormLegalBlock{
		Key: ConsentKeyDataProcessing, Kind: LegalBlockKindPrivacyNotice, Title: "Datenschutz",
		Label: "Unsere Hinweise zum Datenschutz.", Enabled: true, Source: LegalBlockSourceStandard,
	}

	require.NoError(t, block.Validate())
	assert.Equal(t, "Unsere Hinweise zum Datenschutz.", block.Label)
}

func TestFormLegalBlockValidate_GuardianAgreementOnlyOnConsent(t *testing.T) {
	t.Parallel()

	consent := FormLegalBlock{Key: "internet_photos", Kind: LegalBlockKindConsent, Title: "Fotos im Internet", Label: "Fotos dürfen auf die Website.", Enabled: true, GuardianAgreement: true}
	terms := FormLegalBlock{Key: "rules", Kind: LegalBlockKindTerms, Title: "Regeln", Label: "Ich akzeptiere die Regeln.", Required: true, Enabled: true, GuardianAgreement: true}

	require.NoError(t, consent.Validate())
	require.NoError(t, terms.Validate())
	assert.True(t, consent.GuardianAgreement)
	assert.False(t, terms.GuardianAgreement)
}

func TestFormLegalBlockValidate_HealthConsentKeyIsReserved(t *testing.T) {
	t.Parallel()

	block := FormLegalBlock{Key: ConsentKeyHealthData, Kind: LegalBlockKindConsent, Title: "Gesundheit", Label: "Ja", Enabled: true}

	err := block.Validate()

	var rejected *InvalidInputError
	require.True(t, errors.As(err, &rejected), "got %v", err)
	assert.Equal(t, CodeLegalBlockKeyInvalid, rejected.Code)
}

func TestFormFieldValidate_HealthInformationIsNeverRequired(t *testing.T) {
	t.Parallel()

	field := FormField{Key: "health", Label: "Gesundheit", Type: FormFieldTextarea, AppliesToCh: true, Target: TargetStudentHealthInfo, Required: true}

	require.NoError(t, field.Validate())
	assert.False(t, field.Required)
}

func TestPublicLegalBlock_OldPrivacyNoticeRendersWithoutCheckbox(t *testing.T) {
	t.Parallel()

	block := PublicLegalBlock(LegalBlock{Key: ConsentKeyDataProcessing, Kind: LegalBlockKindPrivacyNotice, Label: legacyPrivacyNoticeLabel, Required: true, GuardianAgreement: true})

	assert.False(t, block.Required)
	assert.Equal(t, PrivacyNoticeLabel, block.Label)
	assert.False(t, block.GuardianAgreement)
}

func TestFormSchemaAsksForHealthInformation(t *testing.T) {
	t.Parallel()

	schema := validSchema()
	assert.False(t, schema.AsksForHealthInformation())
	schema.Fields = append(schema.Fields, FormField{Key: "health", Target: TargetStudentHealthInfo})
	assert.True(t, schema.AsksForHealthInformation())
	assert.False(t, (*FormSchema)(nil).AsksForHealthInformation())
}

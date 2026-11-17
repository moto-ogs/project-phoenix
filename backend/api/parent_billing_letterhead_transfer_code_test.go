// Unit tests of the letterhead's GiroCode switch (#5624): the letterhead
// reads parent_billing.transfer_code of the Träger and leaves the code off
// when it is false; a failed read refuses the letterhead instead of
// printing either way.
package api

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/documentrendering/templates"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// letterheadMasterData answers the profile of a Träger without a logo.
type letterheadMasterData struct {
	organizationtenancy.TraegerMasterData
}

func (letterheadMasterData) Profile(context.Context, int64, int64) (organizationtenancy.TraegerProfile, error) {
	return organizationtenancy.TraegerProfile{BankAccounts: []organizationtenancy.TraegerBankAccount{
		{AccountHolder: "Ganztag e.V.", IBAN: "DE02120300000000202051", IsDefault: true},
	}}, nil
}

// letterheadTemplates answers the standard template.
type letterheadTemplates struct {
	organizationtenancy.TraegerDocumentTemplates
}

func (letterheadTemplates) Current(context.Context, int64, templates.Kind) (organizationtenancy.TraegerDocumentTemplate, error) {
	return organizationtenancy.TraegerDocumentTemplate{}, nil
}

// letterheadSettings answers the Träger values of the switches it holds, or
// boolErr for every switch.
type letterheadSettings struct {
	bools   map[string]bool
	boolErr error
	asked   []string
}

func (*letterheadSettings) TraegerInts(context.Context, int64, []string) (map[string]int, error) {
	return map[string]int{}, nil
}

func (*letterheadSettings) TraegerTexts(context.Context, int64, []string) (map[string]string, error) {
	return map[string]string{}, nil
}

func (s *letterheadSettings) TraegerBools(_ context.Context, _ int64, keys []string) (map[string]bool, error) {
	s.asked = append(s.asked, keys...)
	return s.bools, s.boolErr
}

func TestLetterheadFollowsTheTransferCodeSwitchOfTheTraeger(t *testing.T) {
	t.Parallel()
	reviewer := parentbilling.HolidayReviewer{OrganizationID: 7, AccountID: 9}
	for name, tc := range map[string]struct {
		value   bool
		without bool
	}{
		"on prints the code": {value: true, without: false},
		"off leaves it off":  {value: false, without: true},
	} {
		settings := &letterheadSettings{bools: map[string]bool{configModels.KeyParentBillingTransferCode: tc.value}}
		letterheads := parentBillingLetterheads{masterData: letterheadMasterData{}, templates: letterheadTemplates{}, settings: settings}
		head, err := letterheads.Letterhead(context.Background(), reviewer)
		require.NoError(t, err, name)
		assert.Equal(t, tc.without, head.WithoutTransferCode, name)
		assert.Equal(t, []string{configModels.KeyParentBillingTransferCode}, settings.asked, name)
		require.NotNil(t, head.BankAccount, name)
	}

	failed := errors.New("settings unavailable")
	settings := &letterheadSettings{boolErr: failed}
	letterheads := parentBillingLetterheads{masterData: letterheadMasterData{}, templates: letterheadTemplates{}, settings: settings}
	_, err := letterheads.Letterhead(context.Background(), reviewer)
	assert.ErrorIs(t, err, failed, "a failed read refuses the letter instead of guessing the switch")
}

// Tests of the letterhead's GiroCode switch (#5624): the letterhead
// reads parent_billing.print_transfer_qr of the Träger and leaves the code off
// when it is false; a failed read refuses the letterhead instead of
// printing either way.
package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/documentrendering/templates"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
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

func (*letterheadSettings) TraegerBools(context.Context, int64, []string) (map[string]bool, error) {
	return map[string]bool{}, nil
}

func (s *letterheadSettings) TraegerTextsAndBools(_ context.Context, _ int64, _, boolKeys []string) (map[string]string, map[string]bool, error) {
	s.asked = append(s.asked, boolKeys...)
	return map[string]string{}, s.bools, s.boolErr
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
		settings := &letterheadSettings{bools: map[string]bool{configModels.KeyParentBillingPrintTransferQR: tc.value}}
		letterheads := parentBillingLetterheads{masterData: letterheadMasterData{}, templates: letterheadTemplates{}, settings: settings}
		head, err := letterheads.Letterhead(context.Background(), reviewer)
		require.NoError(t, err, name)
		assert.Equal(t, tc.without, head.WithoutTransferCode, name)
		assert.Equal(t, []string{configModels.KeyParentBillingPrintTransferQR}, settings.asked, name)
		require.NotNil(t, head.BankAccount, name)
	}

	failed := errors.New("settings unavailable")
	settings := &letterheadSettings{boolErr: failed}
	letterheads := parentBillingLetterheads{masterData: letterheadMasterData{}, templates: letterheadTemplates{}, settings: settings}
	_, err := letterheads.Letterhead(context.Background(), reviewer)
	assert.ErrorIs(t, err, failed, "a failed read refuses the letter instead of guessing the switch")
}

// TestTransferCodeSwitchResolvesPerTraeger reads the switch through the
// settings of the Träger level as the letterhead does: on without a value
// of the Träger, off once its office switches it off, and a switch of one
// Träger never reaches another. Texts and switch come from one read.
func TestTransferCodeSwitchResolvesPerTraeger(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "GiroCode Schalter")
	foreign := newTraegerOffice(t, f.db, f.traeger, "GiroCode Nachbar", identityaccess.TraegerRoleAdministration)
	organizations, err := owners.NewOrganizationTenancy(testpkg.NewDatabase(t, f.db))
	require.NoError(t, err)
	unit := testpkg.TenantRuntime(t, f.db)
	settings, err := owners.BuildTraegerSettings(testpkg.NewDatabase(t, f.db), unit, slog.Default(), organizations, nil)
	require.NoError(t, err)
	ctx := tenant.WithUnitOfWork(context.Background(), unit)
	read := func(organizationID int64) bool {
		t.Helper()
		texts, switches, err := settings.TraegerTextsAndBools(ctx, organizationID,
			[]string{configModels.KeyBrandingFooterText}, []string{configModels.KeyParentBillingPrintTransferQR})
		require.NoError(t, err)
		require.Contains(t, texts, configModels.KeyBrandingFooterText)
		require.Contains(t, switches, configModels.KeyParentBillingPrintTransferQR)
		return switches[configModels.KeyParentBillingPrintTransferQR]
	}

	assert.True(t, read(f.office.organization), "without a value of its own the Träger prints the code")
	path := "/traeger/settings/values/" + configModels.KeyParentBillingPrintTransferQR
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	rec := traegerJSON(t, f.traeger, billing, http.MethodPut, path, map[string]any{"value": false})
	assert.Equal(t, http.StatusForbidden, rec.Code, "the billing right does not switch it: %s", rec.Body.String())
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, path, map[string]any{"value": false})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.False(t, read(f.office.organization), "the office switched the code off")
	var logged []bool
	require.NoError(t, f.db.NewRaw(`SELECT (new_value)::boolean FROM config.traeger_setting_audit
		WHERE organization_id = ? AND setting_key = ? AND action = 'set' ORDER BY id`,
		f.office.organization, configModels.KeyParentBillingPrintTransferQR).Scan(context.Background(), &logged))
	assert.Equal(t, []bool{false}, logged, "the switch stands once in the change log of the Träger")
	assert.True(t, read(foreign.organization), "another Träger keeps printing it")

	_, _, err = settings.TraegerTextsAndBools(ctx, f.office.organization, nil, []string{configModels.KeyBrandingFooterText})
	assert.Error(t, err, "a text read as a switch is an error, not a guess")
}

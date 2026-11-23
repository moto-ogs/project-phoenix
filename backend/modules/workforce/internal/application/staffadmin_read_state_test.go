package application

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ADR 0311: each Stammdaten section carries the token of the read the form
// showed. A save over a section someone changed since is refused with
// nothing written; the current token saves; a save of one section does not
// refuse the next save of another one from the same read.

func TestStammdatenSectionRefusesAStaleRead(t *testing.T) {
	t.Parallel()

	sections := map[string]struct {
		token func(StammdatenVersions) string
		save  func(f *adminFixture, version string) error
	}{
		"person": {
			token: func(v StammdatenVersions) string { return v.Person },
			save: func(f *adminFixture, version string) error {
				return f.admin.UpdateStaffStammdatenPerson(t.Context(), 7, domain.PersonSection{FirstName: "Ada", LastName: "Byron", ExpectedVersion: &version}, 3, "")
			},
		},
		"kontakt": {
			token: func(v StammdatenVersions) string { return v.Kontakt },
			save: func(f *adminFixture, version string) error {
				return f.admin.UpdateStaffStammdatenKontakt(t.Context(), 7, domain.ContactSection{AddressCity: newCity(), ExpectedVersion: &version}, 3, "")
			},
		},
		"arbeitsvertrag": {
			token: func(v StammdatenVersions) string { return v.Arbeitsvertrag },
			save: func(f *adminFixture, version string) error {
				return f.admin.UpdateStaffStammdatenArbeitsvertrag(t.Context(), 7, domain.ContractSection{WeeklyHours: ptr(20.0), ExpectedVersion: &version}, 3, "")
			},
		},
	}
	for name, section := range sections {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newAdminFixture()
			read, err := f.admin.StaffStammdaten(t.Context(), 7)
			require.NoError(t, err)

			// A colleague changes every section after the read.
			f.subjects.subject.FirstName = "Augusta"
			f.subjects.subject.EmploymentType = ptr(domain.EmploymentTypePartTime)
			f.store.masterData = &domain.StaffMasterData{ID: 1, StaffID: 7, Phone: ptr("0170"), WeeklyHours: ptr(10.0)}
			f.log.events = nil

			for _, stale := range []string{section.token(read.Versions), ""} {
				require.ErrorIs(t, section.save(f, stale), readstate.ErrChanged, "token %q", stale)
			}
			assert.Equal(t, []string{"begin", "lock staff", "end", "begin", "lock staff", "end"}, f.log.events, "nothing is written")
			assert.Empty(t, f.audit.masterData)

			current, err := f.admin.StaffStammdaten(t.Context(), 7)
			require.NoError(t, err)
			require.NoError(t, section.save(f, section.token(current.Versions)))
			assert.NotEmpty(t, f.audit.masterData)
		})
	}
}

// newCity is a contact section change: a new town.
func newCity() *string { return ptr("Köln") }

func TestStammdatenSectionsSaveOneAfterAnotherFromOneRead(t *testing.T) {
	t.Parallel()

	f := newAdminFixture()
	read, err := f.admin.StaffStammdaten(t.Context(), 7)
	require.NoError(t, err)

	require.NoError(t, f.admin.UpdateStaffStammdatenPerson(t.Context(), 7, domain.PersonSection{
		FirstName: "Ada", LastName: "L", Gender: ptr(domain.GenderFemale), ExpectedVersion: &read.Versions.Person,
	}, 3, ""))
	require.NoError(t, f.admin.UpdateStaffStammdatenKontakt(t.Context(), 7, domain.ContactSection{
		AddressCity: newCity(), ExpectedVersion: &read.Versions.Kontakt,
	}, 3, ""), "the person section shares the master data row with the contact section")
	require.NoError(t, f.admin.UpdateStaffStammdatenArbeitsvertrag(t.Context(), 7, domain.ContractSection{
		EmploymentType: ptr(domain.EmploymentTypePartTime), ExpectedVersion: &read.Versions.Arbeitsvertrag,
	}, 3, ""))
	require.ErrorIs(t, f.admin.UpdateStaffStammdatenKontakt(t.Context(), 7, domain.ContactSection{
		ExpectedVersion: &read.Versions.Kontakt,
	}, 3, ""), readstate.ErrChanged, "the second save of the same section needs the new read")
}

func TestFinancialSectionRefusesAStaleRead(t *testing.T) {
	t.Parallel()

	f := newAdminFixture()
	ctx := tenant.WithTenantID(t.Context(), 5)
	read, err := f.admin.RevealStaffFinancial(ctx, 7, 9, "admin")
	require.NoError(t, err)
	readVersion := financialSectionVersion(&read)

	// A colleague stores an IBAN after the read.
	first := financialSectionVersion(nil)
	require.NoError(t, f.admin.UpdateStaffFinancial(ctx, 7, domain.FinancialSection{IBAN: ptr("DE89 3704 0044 0532 0130 00"), ExpectedVersion: &first}, 3, ""))
	f.store.financial.ID, f.store.financial.TenantID = 1, 5 // as the store keeps the row
	stored := *f.store.financial
	f.log.events = nil

	for _, stale := range []string{readVersion, ""} {
		err := f.admin.UpdateStaffFinancial(ctx, 7, domain.FinancialSection{TaxID: ptr("12345678901"), ExpectedVersion: &stale}, 3, "")
		require.ErrorIs(t, err, readstate.ErrChanged, "token %q", stale)
	}
	assert.Equal(t, stored, *f.store.financial, "nothing is written")
	assert.NotContains(t, f.log.events, "update financial data")

	masked, err := f.admin.StaffFinancialMasked(ctx, 7, 9, "admin")
	require.NoError(t, err)
	assert.NotContains(t, masked.Version, "DE89", "the token is no plaintext")
	require.NoError(t, f.admin.UpdateStaffFinancial(ctx, 7, domain.FinancialSection{TaxID: ptr("12345678901"), ExpectedVersion: &masked.Version}, 3, ""))
}

func TestPersonnelNumberRefusesAStaleRead(t *testing.T) {
	t.Parallel()

	f := newAdminFixture()
	read := workforce.PersonnelNumberVersion(f.subjects.subject.PersonnelNumber)
	f.subjects.subject.PersonnelNumber = ptr("4711")

	for _, stale := range []string{read, ""} {
		_, err := f.admin.UpdatePersonnelNumber(t.Context(), 7, ptr("4712"), &stale, 3, "")
		require.ErrorIs(t, err, readstate.ErrChanged, "token %q", stale)
	}
	assert.NotContains(t, f.log.events, "set personnel number")
	assert.Empty(t, f.audit.personnel)

	current := workforce.PersonnelNumberVersion(f.subjects.subject.PersonnelNumber)
	_, err := f.admin.UpdatePersonnelNumber(context.WithoutCancel(t.Context()), 7, ptr("4712"), &current, 3, "")
	require.NoError(t, err)
	assert.Contains(t, f.log.events, "set personnel number")
}

package compose_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// letterheadFunc stands in for the letterhead port; the test below runs the
// catalog rollout in it, between the save's read and its write.
type letterheadFunc func(context.Context, carecontract.Reviewer) (carecontract.Letterhead, error)

func (f letterheadFunc) Letterhead(ctx context.Context, reviewer carecontract.Reviewer) (carecontract.Letterhead, error) {
	return f(ctx, reviewer)
}

// A first save, read while the offering had no template, is refused once
// the catalog rollout inserted one in between, and leaves the rollout's
// template as it is (ADR 0311): it must not replace conditions its author
// never saw.
func TestFirstTemplateSaveIsRefusedOnceTheRolloutInsertedOne(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, db))
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger Vorlage Rollout", Slug: fmt.Sprintf("traeger-vorlage-rollout-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	testpkg.OwnTraegerCareContracts(t, db, organization)
	account := testpkg.CreateTestAccountWithPassword(t, db, fmt.Sprintf("rollout-%d@test.local", testpkg.UniqueTestTenantID(t)), testpkg.NewTestPassword())
	reviewer := carecontract.Reviewer{OrganizationID: organization, AccountID: account.ID}
	accesses := 0
	school := schoolDouble{school: carecontract.School{ID: testpkg.UniqueTestTenantID(t), Name: "OGS Am Lindenhof"},
		child: testpkg.UniqueTestTenantID(t), offering: testpkg.UniqueTestTenantID(t), accesses: &accesses}
	rolledOut := carecontract.TemplateInput{TermKind: carecontract.TermFixedMonths, TermMonths: new(12), NoticeMonths: 3, NoticeTo: carecontract.NoticeMonthEnd}
	var intake carecontract.Intake
	// The rollout runs in its own transaction while the save holds the
	// template's lock: it takes no template lock.
	rolled, rolloutErr := false, error(nil)
	rollout := func() error {
		// The school double knows three offerings; the rollout covers all.
		batch := make([]carecontract.ModuleTemplateInput, 0, 3)
		for offering := school.offering; offering < school.offering+3; offering++ {
			batch = append(batch, carecontract.ModuleTemplateInput{CareOfferingID: offering, Input: rolledOut})
		}
		prepared, err := intake.PrepareTemplateBatch(ctx, reviewer, school.school.ID, batch)
		if err != nil {
			return err
		}
		return tenant.WithinTraeger(ctx, organization, prepared)
	}
	letterhead := letterheadFunc(func(ctx context.Context, reviewer carecontract.Reviewer) (carecontract.Letterhead, error) {
		if !rolled {
			rolled, rolloutErr = true, rollout()
		}
		return letterheadDouble{}.Letterhead(ctx, reviewer)
	})
	intake = compose.NewIntake(compose.IntakePorts{Schools: school, Applications: school, Bookings: school, Access: school,
		Runtime: runtimeDouble{}, Modes: school, Mail: noMailBlocks{}, Letterheads: letterhead, Families: familyNumbersDouble{}}, publicContractToday)

	_, err := intake.SaveTemplate(ctx, reviewer, school.school.ID, school.offering, carecontract.TemplateInput{
		TermKind: carecontract.TermOpenEnded, NoticeMonths: 1, NoticeTo: carecontract.NoticeMonthEnd,
	}, readstate.Absent)
	require.True(t, rolled, "the save reached the letterhead")
	require.NoError(t, rolloutErr, "the rollout ran inside the save")
	require.ErrorIs(t, err, readstate.ErrChanged, "the save read no template, the rollout inserted one")

	stored, err := intake.Templates(ctx, reviewer)
	require.NoError(t, err)
	found := false
	for _, offering := range stored {
		if offering.OfferingID.Int64() == school.offering {
			found = true
			require.NotNil(t, offering.Template)
			assert.Equal(t, carecontract.TermFixedMonths, offering.Template.TermKind, "the rollout's template stays")
			assert.Equal(t, 3, offering.Template.NoticeMonths)
		}
	}
	require.True(t, found, "the offering is listed")
}

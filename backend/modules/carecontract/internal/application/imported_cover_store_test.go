package application

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The cover of an imported contract against the real store (#7760): what
// ContractChildren reads decides whether an application child gets a
// contract, so it reads the last day of a contract as the billing does, and
// a creation decides under the lock of the links.

var coverToday = calendar.NewDate(2026, 11, 22)

// coverFixture is the race fixture with one imported contract of Linn
// Muster, a misspelt copy of the application child Lina, at its school,
// whose child record Lina's application names.
type coverFixture struct {
	raceFixture
	store                                   *postgres.Store
	school, requestChild, student, imported int64
}

func newCoverFixture(t *testing.T, name string, importedEnd *calendar.Date) coverFixture {
	t.Helper()
	f := newRaceFixture(t, name)
	f.conclusions.intake.today = func() calendar.Date { return coverToday }
	f.conclusions.intake.runtime = raceRuntime{}
	c := coverFixture{raceFixture: f, school: testpkg.UniqueTestTenantID(t), requestChild: testpkg.UniqueTestTenantID(t) + 1,
		student: testpkg.UniqueTestTenantID(t) + 2, store: postgres.NewStore(func() calendar.Date { return coverToday })}
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		stored, err := c.store.InsertImportedContracts(txCtx, f.org, f.reviewer.AccountID, []ports.ImportedContract{{
			Line: 1, SchoolID: c.school, ImportKey: "linn", ConcludedAt: time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC),
			Version: carecontract.Version{EffectiveFrom: calendar.NewDate(2026, 8, 1), EndsOn: importedEnd,
				ChildFirstName: "Linn", ChildLastName: "Muster", SchoolName: "OGS Am Lindenhof",
				Services: []carecontract.Service{{Weekday: "mon", CareOfferingID: 7, ModuleName: "Ganztag", EndsAt: "16:00"}},
				Terms: carecontract.TemplateInput{TermKind: carecontract.TermOpenEnded, NoticeMonths: 1,
					NoticeTo: carecontract.NoticeMonthEnd, ContractPartner: "Ganztag im Quartier e.V."}},
		}})
		c.imported = stored[1]
		return err
	}))
	return c
}

// reads is the school with Lina's application, her care booked on Mondays
// from bookedFrom.
func (c coverFixture) reads(bookedFrom calendar.Date) []schoolRead {
	full := 15000
	return []schoolRead{{school: carecontract.School{ID: c.school},
		offerings: map[int64]carecontract.Offering{7: {ID: 7, Name: "Ganztag", PriceCents: &full, EndTimes: map[string]string{"mon": "16:00"}}},
		applications: []carecontract.Application{{RequestChildID: c.requestChild, StudentID: &c.student, ChildFirstName: "Lina",
			ChildLastName: "Muster", Bookings: []carecontract.Booking{{CareOfferingID: 7, Days: []string{"mon"}, ValidFrom: &bookedFrom}}}},
	}}
}

func (c coverFixture) key() ContractKey {
	return ContractKey{SchoolID: c.school, RequestChildID: c.requestChild}
}

func (c coverFixture) link(t *testing.T) {
	t.Helper()
	require.NoError(t, testpkg.WithinTraeger(c.ctx, c.org, func(txCtx context.Context) error {
		linked, err := c.store.LinkContractChildren(txCtx, c.org, []ports.ChildLink{{ContractID: c.imported, StudentID: c.student}})
		require.Equal(t, []int64{c.imported}, linked)
		return err
	}))
}

// The conclusion at the acceptance reads its candidates in one transaction
// and concludes each in its own. A link run between the two that links the
// imported contract to the child's record makes it cover the child: the
// conclusion reads that under the lock of the links and concludes nothing,
// so the child keeps one contract and the parents get no mail.
func TestConclusionSkipsADraftAnImportCoversSinceTheRead(t *testing.T) {
	t.Parallel()
	c := newCoverFixture(t, "Träger Abschluss Import gedeckt", nil)
	reads := c.reads(calendar.NewDate(2026, 12, 7))
	existing, _, _, err := c.conclusions.readContracts(c.ctx, c.org, reads)
	require.NoError(t, err)
	require.False(t, existing[c.key()], "before the link the misspelt copy covers nothing: Lina is a candidate")

	c.link(t)
	key := carecontract.CandidateKey{SchoolID: ident.ID(c.school), RequestChildID: ident.ID(c.requestChild)}
	accepted := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	draft := NewContract{Key: c.key(), StudentID: &c.student, AcceptedAt: &accepted,
		Version: carecontract.Version{Number: 1, Status: carecontract.VersionRequested, EffectiveFrom: calendar.NewDate(2026, 12, 7),
			ChildFirstName: "Lina", ChildLastName: "Muster"}}
	run := carecontract.ConclusionRun{Concluded: []int64{}, Skipped: []carecontract.CreateSkip{}}
	require.NoError(t, c.conclusions.concludeChild(c.ctx, c.org, key, draft, "", reads, &run))

	assert.Empty(t, run.Concluded)
	assert.Equal(t, []carecontract.CreateSkip{{CandidateKey: key, Reason: carecontract.SkipContractExists}}, run.Skipped)
	var contracts, mailings int
	require.NoError(t, c.db.NewRaw(`SELECT COUNT(*) FROM care_contract.contracts WHERE organization_id = ? AND request_child_id = ?`,
		c.org, c.requestChild).Scan(context.Background(), &contracts))
	require.NoError(t, c.db.NewRaw(`SELECT COUNT(*) FROM care_contract.contract_mailings WHERE organization_id = ?`,
		c.org).Scan(context.Background(), &mailings))
	assert.Zero(t, contracts, "no second contract")
	assert.Zero(t, mailings, "no mail")
}

// ContractChildren reads the last day of a contract as the billing does
// (VersionsInForce): the earlier of the end of its termination and the end
// of its newest version. An imported contract whose version ends on 31.07.
// covers no care booked from August, although its termination names 31.08.
func TestContractChildrenEndsAContractOnItsEarlierEnd(t *testing.T) {
	t.Parallel()
	versionEnd := calendar.NewDate(2027, 7, 31)
	c := newCoverFixture(t, "Träger Vertragsende Import", &versionEnd)
	_, err := c.db.ExecContext(context.Background(), `UPDATE care_contract.contracts SET status = ?, ends_on = DATE '2027-08-31' WHERE id = ?`,
		carecontract.StatusTerminated, c.imported)
	require.NoError(t, err)
	c.link(t)

	var children []ports.ContractChild
	require.NoError(t, testpkg.WithinTraeger(c.ctx, c.org, func(txCtx context.Context) error {
		children, err = c.conclusions.intake.store.ContractChildren(txCtx, c.org, []int64{c.school})
		return err
	}))
	require.Len(t, children, 1)
	require.NotNil(t, children[0].EndsOn)
	assert.Equal(t, versionEnd, *children[0].EndsOn, "the version ends before the termination")
	assert.False(t, coveredByImport(c.reads(calendar.NewDate(2027, 8, 2)), children, coverToday)[c.key()],
		"care booked from August is not covered")
	assert.True(t, coveredByImport(c.reads(calendar.NewDate(2027, 7, 5)), children, coverToday)[c.key()],
		"care booked in July is")
}

// A contract whose open-ended first version a later one superseded ends with
// the later one, as the billing reads it: the superseded version holds only
// until the next begins. An imported contract after that end is no second
// contract of the same time.
func TestContractChildrenEndsWithTheEffectiveVersionThatStartsLast(t *testing.T) {
	t.Parallel()
	c := newCoverFixture(t, "Träger Vertragsende abgelöst", nil)
	end := calendar.NewDate(2027, 3, 31)
	var children []ports.ContractChild
	require.NoError(t, testpkg.WithinTraeger(c.ctx, c.org, func(txCtx context.Context) error {
		versions, err := c.store.Versions(txCtx, c.org, c.imported)
		if err != nil {
			return err
		}
		next := versions[0]
		next.Number, next.EffectiveFrom, next.EndsOn = 2, calendar.NewDate(2027, 3, 1), &end
		if _, err := c.store.InsertVersion(txCtx, c.org, c.imported,
			VersionStep{Supersede: versions[0].ID.Int64(), Status: carecontract.VersionEffective}, next); err != nil {
			return err
		}
		children, err = c.store.ContractChildren(txCtx, c.org, []int64{c.school})
		return err
	}))
	require.Len(t, children, 1)
	require.NotNil(t, children[0].EndsOn, "the superseded open-ended version does not keep the contract open")
	assert.Equal(t, end, *children[0].EndsOn)
	assert.Equal(t, calendar.NewDate(2026, 8, 1), children[0].StartsOn)
}

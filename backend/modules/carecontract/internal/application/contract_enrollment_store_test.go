package application

import (
	"context"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The enrollment of the child of an imported contract against the real
// store (#7760, ADR 0309): the plan, the binding, and what the bound
// contract is to every reader afterwards.

// enrolledSchool is the school of the cover fixture as the plan and the
// amendment read it: the module of the imported contract in a phase that
// runs from 1 August 2026, and the accepted applications a test gives it.
type enrolledSchool struct {
	school       carecontract.School
	applications []carecontract.Application
}

// interruptedBookings are the bookings of a school with what happens once
// they were read, before the contract is written.
type interruptedBookings struct {
	carecontract.SchoolBookings
	then func()
}

func (b interruptedBookings) Bookings(ctx context.Context, ids []int64) (map[int64][]carecontract.Booking, error) {
	bookings, err := b.SchoolBookings.Bookings(ctx, ids)
	b.then()
	return bookings, err
}

func (s *enrolledSchool) TraegerSchools(context.Context, int64) ([]carecontract.School, error) {
	return []carecontract.School{s.school}, nil
}

func (s *enrolledSchool) AcceptedApplications(_ context.Context, ids []int64) ([]carecontract.Application, error) {
	accepted := []carecontract.Application{}
	for _, application := range s.applications {
		if len(ids) == 0 || slices.Contains(ids, application.RequestChildID) {
			application.Bookings = nil
			accepted = append(accepted, application)
		}
	}
	return accepted, nil
}

func (s *enrolledSchool) AcceptedStudentApplications(_ context.Context, studentIDs []int64) ([]carecontract.Application, error) {
	accepted := []carecontract.Application{}
	for _, application := range s.applications {
		if application.StudentID != nil && slices.Contains(studentIDs, *application.StudentID) {
			application.Bookings = nil
			accepted = append(accepted, application)
		}
	}
	return accepted, nil
}

func (s *enrolledSchool) NamePhases(_ context.Context, offerings []carecontract.Offering) ([]carecontract.Offering, error) {
	start, end := calendar.NewDate(2026, 8, 1), calendar.NewDate(2099, 7, 31)
	for i := range offerings {
		offerings[i].PhaseName, offerings[i].ServiceStart, offerings[i].ServiceEnd = "Schuljahr", &start, &end
	}
	return offerings, nil
}

func (s *enrolledSchool) Bookings(_ context.Context, ids []int64) (map[int64][]carecontract.Booking, error) {
	bookings := map[int64][]carecontract.Booking{}
	for _, application := range s.applications {
		if slices.Contains(ids, application.RequestChildID) {
			bookings[application.RequestChildID] = application.Bookings
		}
	}
	return bookings, nil
}

func (s *enrolledSchool) Offerings(context.Context, []int64) ([]carecontract.Offering, error) {
	week := []string{"mon", "tue", "wed", "thu", "fri"}
	ends := map[string]string{"mon": "16:00", "tue": "16:00", "wed": "16:00", "thu": "16:00", "fri": "16:00"}
	return []carecontract.Offering{{ID: 7, PhaseID: 70, Name: "Ganztag", Active: true, EndTimes: ends,
		DaysOfWeekMode: "parent_choice", AvailableDays: week}}, nil
}

// enrollmentFixture is the cover fixture with its imported contract linked
// to the child record, and the enrollment over the real store.
type enrollmentFixture struct {
	coverFixture
	school      *enrolledSchool
	enrollments *ContractEnrollments
}

func newEnrollmentFixture(t *testing.T, name string) enrollmentFixture {
	t.Helper()
	c := newCoverFixture(t, name, nil)
	c.link(t)
	school := &enrolledSchool{school: carecontract.School{ID: c.school, Name: "OGS Am Lindenhof"}}
	c.conclusions.intake.schools, c.conclusions.intake.applications, c.conclusions.intake.bookings = school, school, school
	return enrollmentFixture{coverFixture: c, school: school,
		enrollments: NewContractEnrollments(c.store, EnrollmentPorts{Applications: school, Bookings: school}, func() calendar.Date { return coverToday })}
}

// plan reads the contracts in the Träger transaction and plans them.
func (f enrollmentFixture) plan(t *testing.T) carecontract.EnrollmentPlan {
	t.Helper()
	var read carecontract.EnrollmentRead
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		var err error
		read, err = f.enrollments.EnrollmentContracts(txCtx, f.reviewer, f.school.school.ID)
		return err
	}))
	return f.planRead(t, read)
}

// planRead plans a read in the tenant transaction of the fixture's school.
func (f enrollmentFixture) planRead(t *testing.T, read carecontract.EnrollmentRead) carecontract.EnrollmentPlan {
	t.Helper()
	var plan carecontract.EnrollmentPlan
	require.NoError(t, testpkg.WithinTenantContext(t, f.ctx, f.db, f.school.school.ID, func(txCtx context.Context) error {
		var err error
		plan, err = f.enrollments.EnrollmentPlans(txCtx, read)
		return err
	}))
	return plan
}

func (f enrollmentFixture) bind(t *testing.T, bindings ...carecontract.ApplicationBinding) []carecontract.ApplicationBindingResult {
	t.Helper()
	var results []carecontract.ApplicationBindingResult
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		var err error
		results, err = f.enrollments.BindApplications(txCtx, f.reviewer, f.school.school.ID, bindings)
		return err
	}))
	return results
}

// binding is the binding of the fixture's contract as its plan row names
// it, for the application child the school's enrollment answered as
// enrolled.
func (f enrollmentFixture) binding(row carecontract.EnrollmentPlanRow) carecontract.ApplicationBinding {
	return carecontract.ApplicationBinding{ContractID: row.ContractID, StudentID: row.StudentID,
		RequestChildID: ident.ID(f.requestChild), Token: row.Token, Enrollment: carecontract.EnrollmentAnswerEnrolled}
}

// enroll gives the school the accepted application the enrollment made for
// the child: the bookings of the plan row.
func (f enrollmentFixture) enroll(row carecontract.EnrollmentPlanRow) {
	f.school.applications = []carecontract.Application{{RequestChildID: f.requestChild, StudentID: &f.student,
		ChildFirstName: "Linn", ChildLastName: "Muster", Bookings: enrollmentBookings(row.Bookings)}}
}

func (f enrollmentFixture) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	require.NoError(t, f.db.NewRaw(query, args...).Scan(context.Background(), &count))
	return count
}

func (f enrollmentFixture) amendable(t *testing.T) []AmendableContract {
	t.Helper()
	var contracts []AmendableContract
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		var err error
		contracts, err = f.store.AmendableContracts(txCtx, f.org)
		return err
	}))
	return contracts
}

// The run of one school: the plan names the bookings, the school enrolls the
// child, the contract is bound. Afterwards it follows its bookings: the
// bookings of the plan make no version, a changed booking makes one with the
// source of every booking change.
func TestAnImportedContractIsBoundAndThenFollowsItsBookings(t *testing.T) {
	t.Parallel()
	f := newEnrollmentFixture(t, "Träger Anmeldung nachziehen")
	plan := f.plan(t)
	require.Len(t, plan.Rows, 1)
	row := plan.Rows[0]
	require.Equal(t, carecontract.EnrollmentReady, row.Status)
	assert.Equal(t, carecontract.EnrollmentCounts{Ready: 1}, plan.Counts)
	assert.Equal(t, ident.ID(f.student), row.StudentID)
	assert.Equal(t, []carecontract.EnrollmentBooking{{CareOfferingID: 7, ModuleName: "Ganztag", Days: []string{"mon"},
		ValidFrom: calendar.NewDate(2026, 8, 1), ValidUntil: calendar.NewDate(2099, 8, 1), EndTimes: map[string]string{"mon": "16:00"},
		AvailableDays: []string{"mon", "tue", "wed", "thu", "fri"}, DaysOfWeekMode: "parent_choice"}}, row.Bookings,
		"the row carries what the plan read of the module")
	assert.Equal(t, calendar.NewDate(2026, 8, 1), row.PhaseStart)
	assert.Equal(t, calendar.NewDate(2099, 7, 31), row.PhaseEnd)
	assert.Empty(t, f.amendable(t), "an imported contract that is not bound follows no bookings")

	f.enroll(row)
	assert.Equal(t, []carecontract.ApplicationBindingResult{{ContractID: row.ContractID, Status: carecontract.BindingBound}},
		f.bind(t, f.binding(row)))
	events := `SELECT COUNT(*) FROM care_contract.contract_events WHERE organization_id = ? AND contract_id = ? AND action = 'bind_application'
		AND (details->>'request_child_id')::bigint = ? AND (details->>'student_id')::bigint = ?`
	assert.Equal(t, 1, f.count(t, events, f.org, f.imported, f.requestChild, f.student), "the trail records the binding")
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_versions WHERE organization_id = ? AND contract_id = ?`,
		f.org, f.imported), "the binding writes no version")

	// A repeated binding changes nothing, and the plan answers the contract
	// as done.
	assert.Equal(t, carecontract.BindingDone, f.bind(t, f.binding(row))[0].Status)
	assert.Equal(t, 1, f.count(t, events, f.org, f.imported, f.requestChild, f.student), "no second entry")
	again := f.plan(t)
	assert.Equal(t, carecontract.EnrollmentDone, again.Rows[0].Status)
	assert.Equal(t, ident.ID(f.requestChild), again.Rows[0].RequestChildID)

	amendable := f.amendable(t)
	require.Len(t, amendable, 1, "the bound contract follows its bookings")
	assert.Equal(t, ContractKey{SchoolID: f.school.school.ID, RequestChildID: f.requestChild}, amendable[0].Key)
	run, err := f.conclusions.AmendFromBookings(f.ctx, f.org)
	require.NoError(t, err)
	assert.Empty(t, run.Amended, "the bookings of the plan make no version")

	// The school approves a second weekday from 5 January 2099.
	changed := calendar.NewDate(2099, 1, 5)
	f.school.applications[0].Bookings[0].ValidUntil = &changed
	f.school.applications[0].Bookings = append(f.school.applications[0].Bookings,
		carecontract.Booking{CareOfferingID: 7, Days: []string{"mon", "tue"}, ValidFrom: &changed})
	run, err = f.conclusions.AmendFromBookings(f.ctx, f.org)
	require.NoError(t, err)
	require.Equal(t, []carecontract.AmendedContract{{ContractID: f.imported, VersionNumber: 2, EffectiveFrom: changed}}, run.Amended)
	var source string
	require.NoError(t, f.db.NewRaw(`SELECT source FROM care_contract.contract_versions WHERE organization_id = ? AND contract_id = ?
		AND version_number = 2`, f.org, f.imported).Scan(context.Background(), &source))
	assert.Equal(t, carecontract.SourceBookingChange, source, "a bound imported contract is amended like every other")
}

// The amendment read the bound contract and the changed bookings of its
// application child; before it takes the row lock of the contract, the
// office takes the binding off. The contract no longer follows these
// bookings: no version is written from them.
func TestAnAmendmentWritesNoVersionForAContractUnboundSinceItsRead(t *testing.T) {
	t.Parallel()
	f := newEnrollmentFixture(t, "Träger Anpassung nach dem Lösen")
	row := f.plan(t).Rows[0]
	require.Equal(t, carecontract.EnrollmentReady, row.Status)
	f.enroll(row)
	require.Equal(t, carecontract.BindingBound, f.bind(t, f.binding(row))[0].Status)
	// The school approved a second weekday from 5 January 2099: the run
	// would write version 2.
	changed := calendar.NewDate(2099, 1, 5)
	f.school.applications[0].Bookings[0].ValidUntil = &changed
	f.school.applications[0].Bookings = append(f.school.applications[0].Bookings,
		carecontract.Booking{CareOfferingID: 7, Days: []string{"mon", "tue"}, ValidFrom: &changed})
	unbound := false
	interrupted := *f.conclusions
	intake := *interrupted.intake
	intake.bookings = interruptedBookings{SchoolBookings: f.school, then: func() {
		unbound = true
		require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
			_, err := f.enrollments.UnbindApplication(txCtx, f.reviewer, f.imported, f.requestChild)
			return err
		}))
	}}
	interrupted.intake = &intake

	run, err := interrupted.AmendFromBookings(f.ctx, f.org)
	require.NoError(t, err)
	require.True(t, unbound, "the office took the binding off between the read and the write")
	assert.Empty(t, run.Amended, "an unbound contract follows no bookings")
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_versions WHERE organization_id = ? AND contract_id = ?`,
		f.org, f.imported), "no version from bookings the contract no longer follows")

	// Bound again, the same bookings make the version.
	again := f.plan(t).Rows[0]
	require.Equal(t, carecontract.EnrollmentHeld, again.Status, "the changed bookings are not the contract's any more")
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		_, err := f.store.BindContractApplications(txCtx, f.org, []ports.ApplicationBinding{{ContractID: f.imported, StudentID: f.student, RequestChildID: f.requestChild}})
		return err
	}))
	run, err = f.conclusions.AmendFromBookings(f.ctx, f.org)
	require.NoError(t, err)
	assert.Len(t, run.Amended, 1, "a bound contract is amended as before")
}

// What the bound contract is to the other readers: it keeps its child
// record, its summary says that it follows bookings, and it still holds
// back every other application of the child whose care it overlaps. Only
// the application it is bound to is its own.
func TestABoundContractKeepsItsChildRecordAndStillCoversOtherApplications(t *testing.T) {
	t.Parallel()
	f := newEnrollmentFixture(t, "Träger Anmeldung gebunden")
	next := ContractKey{SchoolID: f.school.school.ID, RequestChildID: f.requestChild + 5}
	nextYear := func() []schoolRead {
		reads := f.reads(calendar.NewDate(2026, 12, 7))
		reads[0].applications[0].RequestChildID = next.RequestChildID
		return reads
	}
	children := func() []ports.ContractChild {
		var found []ports.ContractChild
		require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
			var err error
			found, err = f.store.ContractChildren(txCtx, f.org, []int64{f.school.school.ID})
			return err
		}))
		return found
	}
	summary := func() carecontract.ContractSummary {
		var record ContractRecord
		require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
			var err error
			record, err = f.store.Contract(txCtx, f.org, f.imported, false)
			return err
		}))
		return record.Summary
	}
	require.True(t, coveredByImport(nextYear(), children(), coverToday)[next], "linked and unbound, the contract covers the child's applications")
	assert.False(t, summary().FollowsBookings)

	row := f.plan(t).Rows[0]
	f.enroll(row)
	require.Equal(t, carecontract.BindingBound, f.bind(t, f.binding(row))[0].Status)

	assert.Equal(t, f.imported, importCoverage(nextYear(), children(), coverToday)[next],
		"bound and without an end, it still holds back a later application of the child")
	own := ContractKey{SchoolID: f.school.school.ID, RequestChildID: f.requestChild}
	assert.NotContains(t, importCoverage(f.reads(calendar.NewDate(2026, 12, 7)), children(), coverToday), own,
		"the application it is bound to is its own, not one it covers")
	// The list of candidates shows the later application held back with the
	// imported contract, and the bound application as one with a contract.
	var existing map[ContractKey]bool
	var named map[ContractKey]int64
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		var err error
		reads := append(nextYear(), f.reads(calendar.NewDate(2026, 12, 7))...)
		existing, named, err = f.conclusions.intake.contractedKeys(txCtx, f.org, reads)
		return err
	}))
	assert.Equal(t, f.imported, named[next], "the later application is a candidate held back by the imported contract")
	assert.True(t, existing[own])
	assert.Zero(t, named[own])
	candidates := []carecontract.Candidate{{SchoolID: ident.ID(next.SchoolID), RequestChildID: ident.ID(next.RequestChildID)}}
	markNamedByImport(candidates, named)
	assert.Equal(t, carecontract.SkipImportedContract, candidates[0].TemplateIssue)
	assert.Equal(t, ident.ID(f.imported), candidates[0].ImportedContractID)
	bound := summary()
	assert.True(t, bound.FollowsBookings)
	assert.True(t, bound.Imported, "it stays an imported contract")
	require.NotNil(t, bound.Concluded)
	assert.True(t, bound.Concluded.TakenOver)

	links := NewContractChildLinks(f.store, ChildLinkPorts{Schools: f.school, Children: noSchoolChildren{}, Access: raceAccess{},
		Runtime: raceRuntime{}, Fingerprint: func([]byte) string { return "" }}, func() calendar.Date { return coverToday })
	require.ErrorIs(t, links.UnlinkChild(f.ctx, f.reviewer, f.imported, f.student), carecontract.ErrChildLinkBound)
	require.NotNil(t, summary().StudentID, "the link stays")
	assert.Equal(t, ident.ID(f.student), *summary().StudentID)
	assert.Zero(t, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_events WHERE organization_id = ? AND action = 'unlink_child'`, f.org))
}

type noSchoolChildren struct{}

func (noSchoolChildren) SchoolChildren(context.Context, []int64) ([]carecontract.SchoolChild, error) {
	return nil, nil
}

// A run that enrolled the child and stopped before the binding leaves the
// contract unbound. The next run finds the child's application with the
// bookings of the contract and binds to it; nothing is enrolled twice.
func TestARunCutShortBeforeTheBindingIsFinishedByTheNext(t *testing.T) {
	t.Parallel()
	f := newEnrollmentFixture(t, "Träger Anmeldung abgebrochen")
	first := f.plan(t).Rows[0]
	require.Equal(t, carecontract.EnrollmentReady, first.Status)
	require.Zero(t, first.RequestChildID)
	f.enroll(first)

	rerun := f.plan(t).Rows[0]
	require.Equal(t, carecontract.EnrollmentReady, rerun.Status)
	assert.Equal(t, ident.ID(f.requestChild), rerun.RequestChildID, "the row names the enrollment the first run made")
	assert.Equal(t, coverToday, rerun.ProvedOn)
	assert.Equal(t, []carecontract.EnrollmentBooking{{CareOfferingID: 7, ModuleName: "Ganztag", Days: []string{"mon"},
		ValidFrom: coverToday, ValidUntil: calendar.NewDate(2099, 8, 1), EndTimes: map[string]string{"mon": "16:00"},
		AvailableDays: []string{"mon", "tue", "wed", "thu", "fri"}, DaysOfWeekMode: "parent_choice"}}, rerun.ApplicationBookings,
		"the row carries the stored bookings from today on: the school's enrollment compares them under its gates")
	binding := carecontract.ApplicationBinding{ContractID: rerun.ContractID, StudentID: rerun.StudentID,
		RequestChildID: rerun.RequestChildID, Token: rerun.Token, Enrollment: carecontract.EnrollmentAnswerExisting}
	other := binding
	other.RequestChildID++
	assert.Equal(t, carecontract.BindingChanged, f.bind(t, other)[0].Status, "only the application the row proved is bound")
	// The proof of the plan alone binds nothing: the school's enrollment
	// confirms the application under its gates first, and an application it
	// found changed, or one it could only have enrolled anew, is not bound.
	for _, answer := range []string{"", "changed", "has_application", carecontract.EnrollmentAnswerEnrolled} {
		unconfirmed := binding
		unconfirmed.Enrollment = answer
		assert.Equal(t, carecontract.BindingChanged, f.bind(t, unconfirmed)[0].Status, "enrollment answer %q", answer)
	}
	assert.Equal(t, carecontract.BindingBound, f.bind(t, binding)[0].Status)
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contracts WHERE organization_id = ? AND request_child_id = ?`,
		f.org, f.requestChild))
}

// A contract that is no longer what the plan saw is not bound: another child
// record, another timeline, a contract that ended, and an application child
// that has a contract already.
func TestAContractThatChangedSinceThePlanIsNotBound(t *testing.T) {
	t.Parallel()
	f := newEnrollmentFixture(t, "Träger Anmeldung geändert")
	row := f.plan(t).Rows[0]
	bound := func() int {
		return f.count(t, `SELECT COUNT(*) FROM care_contract.contracts WHERE organization_id = ? AND id = ? AND request_child_id IS NOT NULL`,
			f.org, f.imported)
	}
	// The binding names the child record the school's enrollment answered
	// for. An answer for another child record, or for none, binds nothing:
	// the caller relays the answers, and the binding does not trust it.
	other := f.binding(row)
	other.StudentID++
	assert.Equal(t, carecontract.BindingChanged, f.bind(t, other)[0].Status, "another child record")
	nobody := f.binding(row)
	nobody.StudentID = 0
	assert.Equal(t, carecontract.BindingChanged, f.bind(t, nobody)[0].Status, "no child record")
	moved := f.binding(row)
	moved.Token = "1:wirksam|new"
	assert.Equal(t, carecontract.BindingChanged, f.bind(t, moved)[0].Status, "another timeline")
	// A row is bound only to what the school's enrollment answered as
	// enrolled or existing: never to an application it only named
	// (has_application), refused or found changed.
	for _, answer := range []string{"", "has_application", "changed", "refused"} {
		unconfirmed := f.binding(row)
		unconfirmed.Enrollment = answer
		assert.Equal(t, carecontract.BindingChanged, f.bind(t, unconfirmed)[0].Status, "enrollment answer %q", answer)
	}
	require.Zero(t, bound())
	unknown := f.binding(row)
	unknown.ContractID = ident.ID(f.contract)
	assert.Equal(t, carecontract.BindingChanged, f.bind(t, unknown)[0].Status, "a contract from an application")

	// A contract named twice in one call is answered per row: the first row
	// binds it, a second row for another application child is changed, and
	// one for the same application child finds it bound. The call does not
	// fail and writes the contract once.
	second := f.binding(row)
	second.RequestChildID++
	twice := f.bind(t, f.binding(row), second, f.binding(row))
	assert.Equal(t, []string{carecontract.BindingBound, carecontract.BindingChanged, carecontract.BindingDone},
		[]string{twice[0].Status, twice[1].Status, twice[2].Status})
	require.Equal(t, 1, bound())
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_events WHERE organization_id = ? AND contract_id = ?
		AND action = 'bind_application'`, f.org, f.imported), "one entry in the trail")
	taken := f.binding(row)
	taken.RequestChildID++
	assert.Equal(t, carecontract.BindingChanged, f.bind(t, taken)[0].Status, "bound to another application child")
	// A bound contract is answered as done only for its own child record.
	misplaced := f.binding(row)
	misplaced.StudentID++
	assert.Equal(t, carecontract.BindingChanged, f.bind(t, misplaced)[0].Status, "an answer for another child record finds no contract done")
	assert.Equal(t, carecontract.BindingDone, f.bind(t, f.binding(row))[0].Status)

	// The key of the contract from an application is taken at its school.
	var keySchool, keyChild int64
	require.NoError(t, f.db.NewRaw(`SELECT school_id, request_child_id FROM care_contract.contracts WHERE id = ?`, f.contract).
		Scan(context.Background(), &keySchool, &keyChild))
	_, err := f.db.ExecContext(context.Background(), `UPDATE care_contract.contracts SET request_child_id = NULL WHERE id = ?`, f.imported)
	require.NoError(t, err)
	_, err = f.db.ExecContext(context.Background(), `UPDATE care_contract.contracts SET school_id = ? WHERE id = ?`, f.school.school.ID, f.contract)
	require.NoError(t, err)
	contracted := f.binding(row)
	contracted.RequestChildID = ident.ID(keyChild)
	assert.Equal(t, carecontract.BindingChanged, f.bind(t, contracted)[0].Status, "the application child has a contract")
	assert.Zero(t, bound())

	_, err = f.db.ExecContext(context.Background(), `UPDATE care_contract.contracts SET status = ?, ends_on = DATE '2027-01-31' WHERE id = ?`,
		carecontract.StatusTerminated, f.imported)
	require.NoError(t, err)
	assert.Equal(t, carecontract.BindingChanged, f.bind(t, f.binding(row))[0].Status, "a terminated contract")
	assert.Equal(t, carecontract.EnrollmentReasonContractNotActive, f.plan(t).Rows[0].Reason)
}

// The store refuses a second contract for one application child even when a
// caller skips the checks: the unique key answers ErrContractExists.
func TestTheStoreRefusesASecondContractOfAnApplicationChild(t *testing.T) {
	t.Parallel()
	f := newEnrollmentFixture(t, "Träger Anmeldung Schlüssel")
	var keySchool, keyChild int64
	require.NoError(t, f.db.NewRaw(`SELECT school_id, request_child_id FROM care_contract.contracts WHERE id = ?`, f.contract).
		Scan(context.Background(), &keySchool, &keyChild))
	_, err := f.db.ExecContext(context.Background(), `UPDATE care_contract.contracts SET school_id = ? WHERE id = ?`, f.school.school.ID, f.contract)
	require.NoError(t, err)
	err = testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		_, err := f.store.BindContractApplications(txCtx, f.org, []ports.ApplicationBinding{
			{ContractID: f.imported, StudentID: f.student, RequestChildID: keyChild}})
		return err
	})
	require.ErrorIs(t, err, carecontract.ErrContractExists)
}

// The plan answers the school whose tenant transaction the caller holds. A
// read of another school is refused: it would be planned on the offerings
// and applications of the wrong school.
func TestThePlanRefusesAReadOfAnotherSchool(t *testing.T) {
	t.Parallel()
	f := newEnrollmentFixture(t, "Träger Anmeldung fremde Schule")
	read := carecontract.EnrollmentRead{SchoolID: f.school.school.ID + 1}
	err := testpkg.WithinTenantContext(t, f.ctx, f.db, f.school.school.ID, func(txCtx context.Context) error {
		_, err := f.enrollments.EnrollmentPlans(txCtx, read)
		return err
	})
	require.ErrorIs(t, err, carecontract.ErrSchoolOutsideTraeger)
	_, err = f.enrollments.EnrollmentPlans(f.ctx, carecontract.EnrollmentRead{SchoolID: f.school.school.ID})
	require.ErrorIs(t, err, carecontract.ErrSchoolOutsideTraeger, "without the tenant transaction of the school nothing is planned")
}

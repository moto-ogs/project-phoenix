package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The plan of the enrollment of an imported contract (#7760, ADR 0309): the
// bookings it derives, and the proof that the amendment after the binding
// writes no version for them. Today is 22 November 2030 in every case; the
// school year runs from 1 August 2030 to 31 July 2031.

var enrollmentToday = calendar.NewDate(2030, 11, 22)

// The child record and the application child of the plan's cases: the plan
// is a pure function, so they name no stored row.
const (
	plannedStudent      int64 = 8
	plannedRequestChild int64 = 5
)

// enrollmentSchool is a school with two care modules of the school year, a
// module with fixed weekdays, and a module of the year after.
func enrollmentSchool() schoolRead {
	days := func(end string) map[string]string {
		return map[string]string{"mon": end, "tue": end, "wed": end, "thu": end, "fri": end}
	}
	week := []string{"mon", "tue", "wed", "thu", "fri"}
	year := func(id int64, name, end, mode string, available []string) carecontract.Offering {
		return carecontract.Offering{ID: id, PhaseID: 70, Name: name, PhaseName: "Schuljahr 2030/31", Active: true, EndTimes: days(end),
			DaysOfWeekMode: mode, AvailableDays: available, ServiceStart: date(2030, 8, 1), ServiceEnd: date(2031, 7, 31)}
	}
	next := year(4, "Ganztag 2031/32", "16:30", "parent_choice", week)
	next.PhaseID, next.PhaseName, next.ServiceStart, next.ServiceEnd = 71, "Schuljahr 2031/32", date(2031, 8, 1), date(2032, 7, 31)
	return schoolRead{offerings: map[int64]carecontract.Offering{
		1: year(1, "Kurzbetreuung", "14:00", "parent_choice", week),
		2: year(2, "Ganztag", "16:30", "parent_choice", week),
		3: year(3, "Frühbetreuung", "08:00", "fixed", []string{"mon", "wed"}),
		4: next,
	}}
}

func importedService(day string, offering int64, name, end string) carecontract.Service {
	return carecontract.Service{Weekday: day, CareOfferingID: ident.ID(offering), ModuleName: name, EndsAt: end}
}

// enrollableContract is an active imported contract linked to child record 8
// whose only version books the short module on Monday and Tuesday from 1
// August 2030, without an end.
func enrollableContract() carecontract.EnrollmentContract {
	student := plannedStudent
	return carecontract.EnrollmentContract{ID: 9, SchoolID: 4, Status: carecontract.StatusActive, StudentID: &student,
		FirstFrom: *date(2030, 8, 1), NextNumber: 2, ChildFirstName: "Lina", ChildLastName: "Muster",
		Versions: []carecontract.Version{{
			ID: 31, Number: 1, Status: carecontract.VersionEffective, EffectiveFrom: *date(2030, 8, 1),
			Services: []carecontract.Service{importedService("mon", 1, "Kurzbetreuung", "14:00"), importedService("tue", 1, "Kurzbetreuung", "14:00")},
			Terms:    carecontract.TemplateInput{TermKind: carecontract.TermOpenEnded, NoticeMonths: 1, NoticeTo: carecontract.NoticeMonthEnd},
			Source:   carecontract.SourceImport,
		}}}
}

func planRow(contract carecontract.EnrollmentContract, applications ...carecontract.Application) carecontract.EnrollmentPlanRow {
	return planEnrollmentRow(enrollmentSchool(), contract, applications, map[int64]bool{}, enrollmentToday)
}

var schoolWeek = []string{"mon", "tue", "wed", "thu", "fri"}

// moduleBooking is a booking of a module of enrollmentSchool with what the
// plan read of it: its end time on the booked weekdays and its weekdays.
func moduleBooking(offering int64, name, end string, from, until *calendar.Date, days ...string) carecontract.EnrollmentBooking {
	ends := map[string]string{}
	for _, day := range days {
		ends[day] = end
	}
	return carecontract.EnrollmentBooking{CareOfferingID: ident.ID(offering), ModuleName: name, Days: days, ValidFrom: *from, ValidUntil: *until,
		EndTimes: ends, AvailableDays: schoolWeek, DaysOfWeekMode: "parent_choice"}
}

func shortBooking(from, until *calendar.Date, days ...string) carecontract.EnrollmentBooking {
	return moduleBooking(1, "Kurzbetreuung", "14:00", from, until, days...)
}

// Walk (i): one version without an end. The booking starts with the service
// of the phase and ends with it; the care the contract promises after the
// school year makes no version, so the row is ready.
func TestAnOpenEndedContractIsBookedOverItsPhase(t *testing.T) {
	t.Parallel()
	row := planRow(enrollableContract())
	assert.Equal(t, carecontract.EnrollmentReady, row.Status)
	assert.Empty(t, row.Reason)
	assert.Equal(t, ident.ID(70), row.PhaseID)
	assert.Equal(t, "Schuljahr 2030/31", row.PhaseName)
	assert.Equal(t, []carecontract.EnrollmentBooking{shortBooking(date(2030, 8, 1), date(2031, 8, 1), "mon", "tue")}, row.Bookings)
	assert.Empty(t, row.Changes)
	assert.Equal(t, "31:wirksam|new", row.Token, "the token names the timeline and that the school enrolls the child")
	assert.Zero(t, row.RequestChildID, "the child gets a new enrollment")
	assert.Equal(t, *date(2030, 8, 1), row.PhaseStart)
	assert.Equal(t, *date(2031, 7, 31), row.PhaseEnd)
}

// Walk (ii): the version ends on 31 July, the day the phase ends. The
// booking ends the day after, exclusive.
func TestAContractEndingWithTheSchoolYearIsBookedToItsEnd(t *testing.T) {
	t.Parallel()
	contract := enrollableContract()
	contract.Versions[0].EndsOn = date(2031, 7, 31)
	row := planRow(contract)
	assert.Equal(t, carecontract.EnrollmentReady, row.Status)
	assert.Equal(t, []carecontract.EnrollmentBooking{shortBooking(date(2030, 8, 1), date(2031, 8, 1), "mon", "tue")}, row.Bookings)

	// A version, a module or a termination that ends earlier ends the
	// booking with it.
	contract.Versions[0].EndsOn = date(2031, 1, 31)
	assert.Equal(t, *date(2031, 2, 1), planRow(contract).Bookings[0].ValidUntil)
	contract.Versions[0].EndsOn = nil
	contract.Versions[0].Services[0].LastDay, contract.Versions[0].Services[1].LastDay = date(2031, 2, 28), date(2031, 2, 28)
	row = planRow(contract)
	assert.Equal(t, carecontract.EnrollmentReady, row.Status)
	assert.Equal(t, *date(2031, 3, 1), row.Bookings[0].ValidUntil)
}

// plannedCorrection is enrollableContract with a planned offering correction
// from 1 February 2031: the full-day module on other weekdays, ending at end.
func plannedCorrection(end string) carecontract.EnrollmentContract {
	return func(end string) carecontract.EnrollmentContract {
		contract := enrollableContract()
		contract.NextNumber = 3
		contract.Versions = append(contract.Versions, carecontract.Version{
			ID: 32, Number: 2, Status: carecontract.VersionEffective, EffectiveFrom: *date(2031, 2, 1),
			Services: []carecontract.Service{importedService("mon", 2, "Ganztag", end), importedService("wed", 2, "Ganztag", end),
				importedService("fri", 2, "Ganztag", end)},
			Terms: contract.Versions[0].Terms, Source: carecontract.SourceOfferingCorrection,
		})
		return contract
	}(end)
}

// Walk (iii): the version in force and a planned offering correction with
// another module on other weekdays. The booking of today's version ends
// where the planned one begins, and the planned one is a change. The silent
// enrollment writes no dated change, so the row is held back until the
// planned version holds.
func TestAPlannedOfferingCorrectionHoldsTheRowBack(t *testing.T) {
	t.Parallel()
	row := planRow(plannedCorrection("16:30"))
	assert.Equal(t, carecontract.EnrollmentHeld, row.Status)
	assert.Equal(t, carecontract.EnrollmentReasonPlannedChange, row.Reason, "the bookings are the contract's, but the change is not written")
	assert.Equal(t, []carecontract.EnrollmentBooking{shortBooking(date(2030, 8, 1), date(2031, 2, 1), "mon", "tue")}, row.Bookings)
	assert.Equal(t, []carecontract.EnrollmentChange{{EffectiveFrom: *date(2031, 2, 1), Bookings: []carecontract.EnrollmentBooking{
		moduleBooking(2, "Ganztag", "16:30", date(2031, 2, 1), date(2031, 8, 1), "mon", "wed", "fri"),
	}}}, row.Changes)
	assert.Empty(t, row.Token, "a held row is not bound")

	// The correction kept the end time of the old module: the bookings would
	// make a version with the module's end time on its first day.
	row = planRow(plannedCorrection("14:00"))
	assert.Equal(t, carecontract.EnrollmentHeld, row.Status)
	assert.Equal(t, carecontract.EnrollmentReasonEndTime, row.Reason)
	assert.Len(t, row.Changes, 1, "a held row still shows what was derived")

	// Once the planned version holds, the child is enrolled with it.
	later := planEnrollmentRow(enrollmentSchool(), plannedCorrection("16:30"), nil, map[int64]bool{}, *date(2031, 2, 3))
	assert.Equal(t, carecontract.EnrollmentReady, later.Status)
	assert.Equal(t, []carecontract.EnrollmentBooking{
		moduleBooking(2, "Ganztag", "16:30", date(2030, 8, 1), date(2031, 8, 1), "mon", "wed", "fri")}, later.Bookings)

	// A child whose accepted application carries the change already is bound
	// to it: nothing is written for it.
	student := plannedStudent
	application := carecontract.Application{RequestChildID: plannedRequestChild, StudentID: &student, Bookings: []carecontract.Booking{
		{CareOfferingID: 1, Days: []string{"mon", "tue"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 2, 1)},
		{CareOfferingID: 2, Days: []string{"mon", "wed", "fri"}, ValidFrom: date(2031, 2, 1), ValidUntil: date(2031, 8, 1)}}}
	bound := planRow(plannedCorrection("16:30"), application)
	assert.Equal(t, carecontract.EnrollmentReady, bound.Status)
	assert.Equal(t, ident.ID(plannedRequestChild), bound.RequestChildID)
	application.Bookings = application.Bookings[:1]
	application.Bookings[0].ValidUntil = date(2031, 8, 1)
	assert.Equal(t, carecontract.EnrollmentReasonHasApplication, planRow(plannedCorrection("16:30"), application).Reason,
		"an application without the change is not the contract's")
}

// Walk (iv): the version started before the service of the phase. The
// booking starts with the service, where the roster of an approved child is
// read, and the amendment sees no change.
func TestAContractOlderThanItsPhaseIsBookedFromTheServiceStart(t *testing.T) {
	t.Parallel()
	contract := enrollableContract()
	contract.FirstFrom, contract.Versions[0].EffectiveFrom = *date(2030, 2, 1), *date(2030, 2, 1)
	row := planRow(contract)
	assert.Equal(t, carecontract.EnrollmentReady, row.Status)
	assert.Equal(t, *date(2030, 8, 1), row.Bookings[0].ValidFrom)

	// A version that started after the service start is booked from the
	// service start all the same: no version reaches back before it.
	contract.FirstFrom, contract.Versions[0].EffectiveFrom = *date(2030, 10, 1), *date(2030, 10, 1)
	row = planRow(contract)
	assert.Equal(t, carecontract.EnrollmentReady, row.Status)
	assert.Equal(t, *date(2030, 8, 1), row.Bookings[0].ValidFrom)
}

// An end time of today's version that is not the module's holds the row
// back: the default never makes a silent version.
func TestAnotherEndTimeHoldsTheRowBack(t *testing.T) {
	t.Parallel()
	contract := enrollableContract()
	contract.Versions[0].Services[1].EndsAt = "15:00"
	row := planRow(contract)
	assert.Equal(t, carecontract.EnrollmentHeld, row.Status)
	assert.Equal(t, carecontract.EnrollmentReasonEndTime, row.Reason)
}

// Bookings of another module or other weekdays than the contract's would
// make a version: they are not the contract's.
func TestOtherBookingsThanTheContractsAreNotProven(t *testing.T) {
	t.Parallel()
	contract := enrollableContract()
	prove := func(offering int64, days ...string) string {
		return provenBookings(enrollmentSchool(), contract, []carecontract.Booking{
			{CareOfferingID: offering, Days: days, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 8, 1)}}, *date(2030, 8, 1), *date(2031, 7, 31), enrollmentToday)
	}
	assert.Empty(t, prove(1, "mon", "tue"))
	assert.Equal(t, carecontract.EnrollmentReasonBookingsDiffer, prove(1, "mon", "tue", "wed"), "a further weekday")
	assert.Equal(t, carecontract.EnrollmentReasonBookingsDiffer, prove(2, "mon", "tue"), "another module")
	assert.Equal(t, carecontract.EnrollmentReasonCareEnds, prove(4, "mon", "tue"), "no booking in the phase")
}

// Each reason a contract cannot be turned into bookings.
func TestContractsThatCannotBeBookedSayWhy(t *testing.T) {
	t.Parallel()
	cases := map[string]struct {
		change func(*carecontract.EnrollmentContract)
		reason string
	}{
		"terminated": {func(c *carecontract.EnrollmentContract) { c.Status = carecontract.StatusTerminated }, carecontract.EnrollmentReasonContractNotActive},
		"no version": {func(c *carecontract.EnrollmentContract) { c.Versions = nil }, carecontract.EnrollmentReasonContractNotActive},
		"starts later": {func(c *carecontract.EnrollmentContract) {
			c.Versions[0].EffectiveFrom = *date(2031, 1, 1)
		}, carecontract.EnrollmentReasonNotBegun},
		"module gone": {func(c *carecontract.EnrollmentContract) { c.Versions[0].Services[0].CareOfferingID = 99 }, carecontract.EnrollmentReasonOfferingGone},
		"no module":   {func(c *carecontract.EnrollmentContract) { c.Versions[0].Services[1].CareOfferingID = 0 }, carecontract.EnrollmentReasonOfferingGone},
		"two phases": {func(c *carecontract.EnrollmentContract) {
			c.Versions[0].Services[1] = importedService("tue", 4, "Ganztag 2031/32", "16:30")
		}, carecontract.EnrollmentReasonTwoPhases},
		"phase not begun": {func(c *carecontract.EnrollmentContract) {
			c.Versions[0].Services = []carecontract.Service{importedService("mon", 4, "Ganztag 2031/32", "16:30")}
		}, carecontract.EnrollmentReasonPhaseNotBegun},
		"fixed weekdays": {func(c *carecontract.EnrollmentContract) {
			c.Versions[0].Services = []carecontract.Service{importedService("mon", 3, "Frühbetreuung", "08:00")}
		}, carecontract.EnrollmentReasonFixedDays},
		"weekday not offered": {func(c *carecontract.EnrollmentContract) {
			c.Versions[0].Services[1].Weekday = "sat"
		}, carecontract.EnrollmentReasonDayUnavailable},
		"version over": {func(c *carecontract.EnrollmentContract) { c.Versions[0].EndsOn = date(2030, 10, 31) }, carecontract.EnrollmentReasonCareEnds},
		"weekdays end apart": {func(c *carecontract.EnrollmentContract) {
			c.Versions[0].Services[0].LastDay = date(2031, 2, 28)
		}, carecontract.EnrollmentReasonCareEnds},
	}
	for name, tc := range cases {
		contract := enrollableContract()
		tc.change(&contract)
		row := planRow(contract)
		assert.Equal(t, carecontract.EnrollmentHeld, row.Status, name)
		assert.Equal(t, tc.reason, row.Reason, name)
	}

	ended := enrollmentSchool()
	row := planEnrollmentRow(ended, enrollableContract(), nil, map[int64]bool{}, *date(2031, 9, 1))
	assert.Equal(t, carecontract.EnrollmentReasonPhaseEnded, row.Reason, "the service of the phase is over")

	fixed := enrollableContract()
	fixed.Versions[0].Services = []carecontract.Service{importedService("mon", 3, "Frühbetreuung", "08:00"), importedService("wed", 3, "Frühbetreuung", "08:00")}
	assert.Equal(t, carecontract.EnrollmentReady, planRow(fixed).Status, "a fixed module on all its weekdays is booked")
}

// A contract without a child record is only named; a bound one is done.
func TestUnlinkedAndBoundContractsAreNotPlanned(t *testing.T) {
	t.Parallel()
	unlinked := enrollableContract()
	unlinked.StudentID = nil
	row := planRow(unlinked)
	assert.Equal(t, carecontract.EnrollmentUnlinked, row.Status)
	assert.Empty(t, row.Bookings)

	bound, child := enrollableContract(), plannedRequestChild
	bound.RequestChildID = &child
	row = planRow(bound)
	assert.Equal(t, carecontract.EnrollmentDone, row.Status)
	assert.Equal(t, ident.ID(5), row.RequestChildID)
}

// A child with an accepted application in the phase gets no second
// enrollment: the contract is bound to that application when its bookings
// are the contract's, which is also what a run finds after it enrolled the
// child and stopped before the binding.
func TestAChildWithAnApplicationIsBoundToItOnlyWhenItsBookingsAreTheContracts(t *testing.T) {
	t.Parallel()
	student := plannedStudent
	application := func(child int64, days ...string) carecontract.Application {
		return carecontract.Application{RequestChildID: child, StudentID: &student, Bookings: []carecontract.Booking{
			{CareOfferingID: 1, Days: days, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 8, 1)},
		}}
	}
	row := planRow(enrollableContract(), application(5, "mon", "tue"))
	require.Equal(t, carecontract.EnrollmentReady, row.Status)
	assert.Equal(t, ident.ID(5), row.RequestChildID, "the row names the application to bind")
	assert.Equal(t, "31:wirksam|5", row.Token, "the token names the application child the binding is for")

	row = planRow(enrollableContract(), application(5, "mon", "tue", "wed"))
	assert.Equal(t, carecontract.EnrollmentHeld, row.Status)
	assert.Equal(t, carecontract.EnrollmentReasonHasApplication, row.Reason, "other bookings would make a version")
	assert.Equal(t, ident.ID(5), row.RequestChildID)

	row = planRow(enrollableContract(), application(5, "mon", "tue"), application(6, "mon", "tue"))
	assert.Equal(t, carecontract.EnrollmentReasonHasApplication, row.Reason, "two applications name no single one")

	row = planEnrollmentRow(enrollmentSchool(), enrollableContract(), []carecontract.Application{application(5, "mon", "tue")},
		map[int64]bool{5: true}, enrollmentToday)
	assert.Equal(t, carecontract.EnrollmentReasonHasApplication, row.Reason, "the application has another contract")

	// An application of another phase is none of this one's.
	other := carecontract.Application{RequestChildID: 7, StudentID: &student, Bookings: []carecontract.Booking{
		{CareOfferingID: 4, Days: []string{"mon"}, ValidFrom: date(2031, 8, 1)}}}
	row = planRow(enrollableContract(), other)
	assert.Equal(t, carecontract.EnrollmentReady, row.Status)
	assert.Zero(t, row.RequestChildID)
}

// The proof is the amendment: the bookings of a ready row, handed to it as
// the application of the bound contract, make no version.
func TestTheBookingsOfAReadyRowMakeNoVersionAfterTheBinding(t *testing.T) {
	t.Parallel()
	contract := enrollableContract()
	row := planRow(contract)
	require.Equal(t, carecontract.EnrollmentReady, row.Status)
	amendable := AmendableContract{ID: contract.ID, Key: ContractKey{SchoolID: 4, RequestChildID: 5}, FirstFrom: contract.FirstFrom,
		NextNumber: contract.NextNumber, Latest: contract.Versions[0], Versions: contract.Versions}
	application := carecontract.Application{RequestChildID: 5, Bookings: enrollmentBookings(row.Bookings)}
	version, reason := nextVersion(enrollmentSchool(), application, amendable, enrollmentToday)
	assert.Nil(t, version)
	assert.Equal(t, carecontract.SkipCareEnds, reason, "an open contract only names the end of the school year, as a skip")

	contract.Versions[0].EndsOn = date(2031, 7, 31)
	amendable.Latest, amendable.Versions = contract.Versions[0], contract.Versions
	version, reason = nextVersion(enrollmentSchool(), application, amendable, enrollmentToday)
	assert.Nil(t, version)
	assert.Empty(t, reason)
}

// A version that started after the service start of its phase is booked
// from the service start. The amendment sees no change on any day then, so
// an end time that is not the module's shows only in the direct comparison
// of the promised and the booked care: the row is held back, never ready.
func TestAnEndTimeOfALaterVersionIsComparedDirectly(t *testing.T) {
	t.Parallel()
	contract := enrollableContract()
	contract.FirstFrom, contract.Versions[0].EffectiveFrom = *date(2030, 10, 1), *date(2030, 10, 1)
	for i := range contract.Versions[0].Services {
		contract.Versions[0].Services[i].EndsAt = "15:00"
	}
	bookings := []carecontract.Booking{{CareOfferingID: 1, Days: []string{"mon", "tue"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 8, 1)}}
	amendable := AmendableContract{ID: contract.ID, Key: ContractKey{SchoolID: 4}, FirstFrom: contract.FirstFrom,
		NextNumber: contract.NextNumber, Latest: contract.Versions[0], Versions: contract.Versions}
	plan, _ := nextAmendment(enrollmentSchool(), carecontract.Application{Bookings: bookings}, amendable, enrollmentToday)
	require.Nil(t, plan, "the amendment alone finds no version to write")

	row := planRow(contract)
	assert.Equal(t, carecontract.EnrollmentHeld, row.Status)
	assert.Equal(t, carecontract.EnrollmentReasonEndTime, row.Reason, "promised until 15:00, the module ends at 14:00")

	// The same holds for an accepted application of the child: from today on
	// its care is not the contract's.
	student := plannedStudent
	held := planRow(contract, carecontract.Application{RequestChildID: plannedRequestChild, StudentID: &student, Bookings: bookings})
	assert.Equal(t, carecontract.EnrollmentHeld, held.Status)
	assert.Equal(t, carecontract.EnrollmentReasonHasApplication, held.Reason)

	// A weekday or a module that differs is named as such.
	assert.Equal(t, carecontract.EnrollmentReasonBookingsDiffer, comparedCare(enrollmentSchool(), enrollableContract(),
		[]carecontract.Booking{{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 8, 1)}},
		*date(2030, 8, 1), *date(2031, 7, 31), enrollmentToday), "a promised weekday without a booking")
	assert.Equal(t, carecontract.EnrollmentReasonBookingsDiffer, comparedCare(enrollmentSchool(), enrollableContract(),
		[]carecontract.Booking{{CareOfferingID: 1, Days: []string{"mon", "tue"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 3, 1)}},
		*date(2030, 8, 1), *date(2031, 7, 31), enrollmentToday), "a booking that ends before the promise")
}

// A module of the version in force whose last day has passed is not booked
// and decides nothing: neither its phase nor its end time holds the row
// back.
func TestAModuleWhoseLastDayPassedDecidesNothing(t *testing.T) {
	t.Parallel()
	contract := enrollableContract()
	old := importedService("wed", 4, "Ganztag 2031/32", "16:30")
	old.LastDay = date(2030, 9, 30)
	contract.Versions[0].Services = append(contract.Versions[0].Services, old)
	row := planRow(contract)
	assert.Equal(t, carecontract.EnrollmentReady, row.Status, "the old module is of another phase, but no longer promised")
	assert.Equal(t, []carecontract.EnrollmentBooking{shortBooking(date(2030, 8, 1), date(2031, 8, 1), "mon", "tue")}, row.Bookings)

	contract.Versions[0].Services[2].LastDay = date(2031, 1, 31)
	assert.Equal(t, carecontract.EnrollmentReasonTwoPhases, planRow(contract).Reason, "a module that still runs counts")
}

// A run enrolled the child with both modules of the contract and stopped
// before the binding. Since then the last day of one module has passed, so
// the plan derives one booking only. The stored application still books
// both: the plan proves what is stored, names the application and binds to
// it, instead of comparing it with what it would derive today.
func TestAStoredEnrollmentIsProvenWithItsOwnBookingsAfterAModuleEnded(t *testing.T) {
	t.Parallel()
	contract := enrollableContract()
	early := importedService("wed", 2, "Ganztag", "16:30")
	early.LastDay = date(2030, 12, 20)
	contract.Versions[0].Services = append(contract.Versions[0].Services, early)

	first := planRow(contract)
	require.Equal(t, carecontract.EnrollmentReady, first.Status)
	require.Len(t, first.Bookings, 2, "the first run books both modules")
	student := plannedStudent
	stored := carecontract.Application{RequestChildID: plannedRequestChild, StudentID: &student, Bookings: enrollmentBookings(first.Bookings)}

	after := *date(2031, 1, 10)
	derivedNow := planEnrollmentRow(enrollmentSchool(), contract, nil, map[int64]bool{}, after)
	require.Len(t, derivedNow.Bookings, 1, "today only the module that still runs is derived")

	rerun := planEnrollmentRow(enrollmentSchool(), contract, []carecontract.Application{stored}, map[int64]bool{}, after)
	assert.Equal(t, carecontract.EnrollmentReady, rerun.Status)
	assert.Equal(t, ident.ID(plannedRequestChild), rerun.RequestChildID)
	assert.Equal(t, planToken(contract.Versions, plannedRequestChild), rerun.Token)
}

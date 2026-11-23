package application

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment/ports"
)

// The merge of the plan of Care Contract and the answers of the school's
// enrollment into the rows the office reads (ADR 0309 section 4). Where both
// answer, the enrollment's answer goes first. Nothing here reads or writes.

// rowKey relates an answer of the school's enrollment to its row: by the
// contract and the child record it names, never by its position.
type rowKey struct {
	contractID int64
	studentID  int64
}

type enrollmentAnswers map[rowKey]enrollment.ContractEnrollmentResult

func answersOf(results []enrollment.ContractEnrollmentResult) enrollmentAnswers {
	answers := make(enrollmentAnswers, len(results))
	for _, result := range results {
		answers[rowKey{contractID: result.ContractID, studentID: result.StudentID}] = result
	}
	return answers
}

func (a enrollmentAnswers) of(row carecontract.EnrollmentPlanRow) (enrollment.ContractEnrollmentResult, bool) {
	answer, ok := a[rowKey{contractID: row.ContractID.Int64(), studentID: row.StudentID.Int64()}]
	return answer, ok
}

// enrollmentInputs are the ready rows of the plan as the school's
// enrollment takes them. A row that names an accepted application asks for
// its confirmation, with the bookings the plan proved of it; any other asks
// for the enrollment with the derived bookings. Every row carries the child
// record as the preview shows it (children): the enrollment compares it with
// the record it reads under its gates, so the run creates and confirms only
// for the child the office saw. A child record the preview cannot show is
// the empty identity, which no child record with a name answers to.
func enrollmentInputs(plan carecontract.EnrollmentPlan, accountID int64, children map[int64]ports.Child) []enrollment.ContractEnrollment {
	inputs := []enrollment.ContractEnrollment{}
	for _, row := range plan.Rows {
		if row.Status != carecontract.EnrollmentReady {
			continue
		}
		input := enrollment.ContractEnrollment{StudentID: row.StudentID.Int64(), PhaseID: row.PhaseID.Int64(),
			ContractID: row.ContractID.Int64(), ServiceStart: row.PhaseStart, ServiceEnd: row.PhaseEnd, ActorAccountID: accountID,
			Confirmed: &enrollment.ContractChildIdentity{}}
		if child, known := children[row.StudentID.Int64()]; known {
			input.Confirmed = &enrollment.ContractChildIdentity{FirstName: child.FirstName, LastName: child.LastName, BirthDate: child.BirthDate}
		}
		if row.RequestChildID != 0 {
			input.RequestChildID, input.ProvedOn = row.RequestChildID.Int64(), row.ProvedOn
			input.Bookings = contractBookings(row.ApplicationBookings)
		} else {
			input.Bookings = contractBookings(row.Bookings)
			for _, change := range row.Changes {
				input.Changes = append(input.Changes, enrollment.ContractBookingChange{EffectiveFrom: change.EffectiveFrom,
					Bookings: contractBookings(change.Bookings)})
			}
		}
		inputs = append(inputs, input)
	}
	return inputs
}

// confirmedInputs are the inputs of the rows the preview showed as ready,
// related by contract and child record. A row of the plan that the check of
// the school's enrollment held back is not among them: the office confirmed
// a preview that writes nothing for it, and the enrollment reads the school
// again under its locks, where it may answer otherwise by then.
func confirmedInputs(seen look) []enrollment.ContractEnrollment {
	ready := map[rowKey]bool{}
	for i, row := range seen.rows {
		if row.Status == contractenrollment.RowReady {
			ready[rowKey{contractID: row.ContractID.Int64(), studentID: seen.plan.Rows[i].StudentID.Int64()}] = true
		}
	}
	inputs := []enrollment.ContractEnrollment{}
	for _, input := range seen.inputs {
		if ready[rowKey{contractID: input.ContractID, studentID: input.StudentID}] {
			inputs = append(inputs, input)
		}
	}
	return inputs
}

func contractBookings(planned []carecontract.EnrollmentBooking) []enrollment.ContractBooking {
	bookings := make([]enrollment.ContractBooking, len(planned))
	for i, booking := range planned {
		bookings[i] = enrollment.ContractBooking{CareOfferingID: booking.CareOfferingID.Int64(), Days: booking.Days,
			ValidFrom: booking.ValidFrom, ValidUntil: booking.ValidUntil, EndTimes: booking.EndTimes,
			AvailableDays: booking.AvailableDays, DaysOfWeekMode: booking.DaysOfWeekMode}
	}
	return bookings
}

// planSubjects are the contracts of the plan and the child records its rows
// name, each once and in order.
func planSubjects(plan carecontract.EnrollmentPlan) (contracts, students []int64) {
	contracts, students = make([]int64, 0, len(plan.Rows)), []int64{}
	for _, row := range plan.Rows {
		contracts = append(contracts, row.ContractID.Int64())
		if id := row.StudentID.Int64(); id > 0 && !slices.Contains(students, id) {
			students = append(students, id)
		}
	}
	slices.Sort(students)
	return contracts, students
}

// previewRows are the rows of the plan with what the school's enrollment
// would do with each ready one.
func previewRows(plan carecontract.EnrollmentPlan, answers enrollmentAnswers, children map[int64]ports.Child) []contractenrollment.EnrollmentRow {
	rows := make([]contractenrollment.EnrollmentRow, len(plan.Rows))
	for i, planned := range plan.Rows {
		row := plannedRow(plan.SchoolID, planned, children)
		if planned.Status == carecontract.EnrollmentReady {
			answer, ok := answers.of(planned)
			answered(&row, answer, ok)
			if row.Status == contractenrollment.RowChanged {
				// Plan and check read the school in one transaction: the
				// application is not what the plan proved, and stays so.
				row.Status, row.Reason = contractenrollment.RowHeld, contractenrollment.ReasonChanged
			}
		}
		rows[i] = stuck(row, planned)
	}
	return rows
}

// plannedRow is the row of the plan before the school's enrollment answers.
//
// A row that binds the application the plan proved shows the bookings of
// that application (ApplicationBookings), not the ones derived from the
// contract: nothing is written for it, and the stored bookings are what the
// contract follows after the binding. They carry a planned change already,
// so the row names no changes beside them. The row shows the weekdays such
// a booking holds (shownBookings).
func plannedRow(schoolID ident.ID, planned carecontract.EnrollmentPlanRow, children map[int64]ports.Child) contractenrollment.EnrollmentRow {
	row := contractenrollment.EnrollmentRow{ContractID: planned.ContractID, SchoolID: schoolID, Reason: planned.Reason,
		ContractChild: contractenrollment.ContractChildName{FirstName: planned.ChildFirstName, LastName: planned.ChildLastName},
		PhaseID:       planned.PhaseID, PhaseName: planned.PhaseName, Bookings: planned.Bookings, Changes: planned.Changes,
		RequestChildID: planned.RequestChildID, FollowsContractID: planned.FollowsContractID}
	if planned.Status == carecontract.EnrollmentReady && planned.RequestChildID != 0 {
		row.Bookings, row.Changes = shownBookings(planned.ApplicationBookings), nil
	}
	if row.Bookings == nil {
		row.Bookings = []carecontract.EnrollmentBooking{}
	}
	if row.Changes == nil {
		row.Changes = []carecontract.EnrollmentChange{}
	}
	if child, known := children[planned.StudentID.Int64()]; known {
		row.Student = &contractenrollment.ChildRecord{StudentID: ident.ID(child.StudentID), FirstName: child.FirstName,
			LastName: child.LastName, BirthDate: child.BirthDate}
	}
	switch planned.Status {
	case carecontract.EnrollmentDone:
		row.Status = contractenrollment.RowDone
	case carecontract.EnrollmentUnlinked:
		row.Status = contractenrollment.RowUnlinked
	case carecontract.EnrollmentReady:
		row.Status = contractenrollment.RowReady
	default:
		row.Status = contractenrollment.RowHeld
	}
	return row
}

// daysOfWeekFixed is the mode of a module that runs on all its weekdays.
const daysOfWeekFixed = "fixed"

// shownBookings are the bookings of an application as a row shows them: a
// booking of a module with fixed weekdays stores none and holds all the
// module offers, so the row names those, as a row that enrolls does. The
// bookings of the plan stay as stored: they are what the school's
// enrollment compares (enrollmentInputs) and what the fingerprint of the
// plan stands on.
func shownBookings(stored []carecontract.EnrollmentBooking) []carecontract.EnrollmentBooking {
	shown := slices.Clone(stored)
	for i, booking := range shown {
		if len(booking.Days) == 0 && booking.DaysOfWeekMode == daysOfWeekFixed {
			shown[i].Days = booking.AvailableDays
		}
	}
	return shown
}

// answered puts the answer of the school's enrollment for a ready row into
// it. Without an answer for the contract and its child record, and with the
// answer changed, the row is changed.
func answered(row *contractenrollment.EnrollmentRow, answer enrollment.ContractEnrollmentResult, ok bool) {
	switch {
	case !ok || answer.Status == enrollment.ContractEnrollmentChanged:
		row.Status, row.Action = contractenrollment.RowChanged, ""
	case answer.Status == enrollment.ContractEnrollmentEnrolled:
		row.Status, row.Action, row.Reason = contractenrollment.RowReady, contractenrollment.ActionEnroll, ""
	case answer.Status == enrollment.ContractEnrollmentExisting:
		row.Status, row.Action, row.Reason = contractenrollment.RowReady, contractenrollment.ActionBind, ""
		row.RequestChildID = ident.ID(answer.RequestChildID)
	case answer.Status == enrollment.ContractEnrollmentHasApplication:
		row.Status, row.Reason = contractenrollment.RowHeld, carecontract.EnrollmentReasonHasApplication
		row.RequestChildID = ident.ID(answer.RequestChildID)
	default:
		row.Status, row.Reason = contractenrollment.RowHeld, answer.Reason
		if answer.RequestChildID != 0 {
			// A refusal that names an application: the silent enrollment
			// of the contract in another phase (enrolled_elsewhere), or
			// the one of a child record that is gone or no longer active.
			row.RequestChildID = ident.ID(answer.RequestChildID)
		}
	}
}

// stuck turns a held row into a stuck one when the child has the silent
// enrollment of an earlier run without a contract, and names it.
func stuck(row contractenrollment.EnrollmentRow, planned carecontract.EnrollmentPlanRow) contractenrollment.EnrollmentRow {
	if row.Status == contractenrollment.RowHeld && planned.EnrollmentChildID != 0 {
		row.Status, row.RequestChildID = contractenrollment.RowStuck, planned.EnrollmentChildID
	}
	return row
}

// bindingsOf are the bindings of the rows the school's enrollment answered
// as enrolled or existing, each with the child record and the application
// child of that answer and the token of its plan row.
func bindingsOf(plan carecontract.EnrollmentPlan, answers enrollmentAnswers) []carecontract.ApplicationBinding {
	bindings := []carecontract.ApplicationBinding{}
	for _, row := range plan.Rows {
		answer, ok := answers.of(row)
		if !ok || row.Status != carecontract.EnrollmentReady || !confirmed(answer) {
			continue
		}
		bindings = append(bindings, carecontract.ApplicationBinding{ContractID: row.ContractID, StudentID: ident.ID(answer.StudentID),
			RequestChildID: ident.ID(answer.RequestChildID), Token: row.Token, Enrollment: answer.Status})
	}
	return bindings
}

func confirmed(answer enrollment.ContractEnrollmentResult) bool {
	return answer.Status == enrollment.ContractEnrollmentEnrolled || answer.Status == enrollment.ContractEnrollmentExisting
}

// committed tells whether a run wrote something that stays: the school's
// enrollment enrolled a child, or the binding bound a contract. An
// enrollment it only found (existing) and a contract that was bound already
// (done) are no change.
func committed(answers enrollmentAnswers, bound map[int64]string) bool {
	for _, answer := range answers {
		if answer.Status == enrollment.ContractEnrollmentEnrolled {
			return true
		}
	}
	for _, status := range bound {
		if status == carecontract.BindingBound {
			return true
		}
	}
	return false
}

// runRows are the rows after a run: a row the preview did not show as ready
// stays what the preview showed, nothing was asked or written for it; a
// ready row says what the school's enrollment and the binding did with it.
func runRows(seen look, answers enrollmentAnswers, bound map[int64]string) []contractenrollment.EnrollmentRow {
	rows := make([]contractenrollment.EnrollmentRow, len(seen.rows))
	for i, row := range seen.rows {
		planned := seen.plan.Rows[i]
		if row.Status != contractenrollment.RowReady {
			rows[i] = row
			continue
		}
		answer, ok := answers.of(planned)
		answered(&row, answer, ok)
		if row.Status == contractenrollment.RowReady {
			row.RequestChildID = ident.ID(answer.RequestChildID)
			switch bound[planned.ContractID.Int64()] {
			case carecontract.BindingBound, carecontract.BindingDone:
				row.Status, row.Reason = contractenrollment.RowDone, ""
			default:
				row.Status, row.Action = contractenrollment.RowChanged, ""
			}
		}
		rows[i] = stuck(row, planned)
	}
	return rows
}

func countRows(rows []contractenrollment.EnrollmentRow) contractenrollment.EnrollmentRowCounts {
	var counts contractenrollment.EnrollmentRowCounts
	for _, row := range rows {
		switch row.Status {
		case contractenrollment.RowReady:
			counts.Ready++
		case contractenrollment.RowDone:
			counts.Done++
		case contractenrollment.RowUnlinked:
			counts.Unlinked++
		case contractenrollment.RowHeld:
			counts.Held++
		case contractenrollment.RowStuck:
			counts.Stuck++
		case contractenrollment.RowChanged:
			counts.Changed++
		}
	}
	return counts
}

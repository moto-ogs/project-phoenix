package peopledirectory

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// StudentRecordVersion is the read-state token of the master data the child's
// edit form shows and saves back as a whole (ADR 0311): name, birthday,
// class, group, address, notes, departure plan and photo consent. The child
// detail read hands it out and the student update compares it under the
// child's row lock, so a form opened on an older state cannot put back what a
// colleague changed since.
//
// Sick, excused and the other live fields stay out: they change through their
// own commands many times a day and must not refuse an unrelated edit. An
// empty and a missing text count as the same state, since two reads of one
// row may hydrate either.
func StudentRecordVersion(student StudentState, person Person) string {
	type plan struct {
		Allowed   map[string][]string `json:"allowed,omitempty"`
		Days      map[string]string   `json:"days,omitempty"`
		Pickup    []string            `json:"pickup,omitempty"`
		Bus       []string            `json:"bus,omitempty"`
		Status    string              `json:"status,omitempty"`
		Companion string              `json:"companion,omitempty"`
	}
	type record struct {
		FirstName    string `json:"first_name"`
		LastName     string `json:"last_name"`
		Birthday     string `json:"birthday,omitempty"`
		SchoolClass  string `json:"school_class"`
		GroupID      int64  `json:"group_id,omitempty"`
		Street       string `json:"street,omitempty"`
		City         string `json:"city,omitempty"`
		PostalCode   string `json:"postal_code,omitempty"`
		HealthInfo   string `json:"health_info,omitempty"`
		ExtraInfo    string `json:"extra_info,omitempty"`
		PhotoConsent bool   `json:"photo_consent,omitempty"`
		Plan         plan   `json:"plan"`
	}
	current := record{
		FirstName: person.FirstName, LastName: person.LastName, Birthday: person.Birthday,
		SchoolClass: student.SchoolClass, Street: text(student.AddressStreet), City: text(student.AddressCity),
		PostalCode: text(student.AddressPostalCode), HealthInfo: text(student.HealthInfo), ExtraInfo: text(student.ExtraInfo),
		PhotoConsent: student.PhotoConsentGivenAt != nil,
		Plan: plan{
			Days: map[string]string{}, Allowed: map[string][]string{},
			Pickup: chosenDays(student.PickupDays), Bus: chosenDays(student.BusDays),
			Status: text(student.PickupStatus), Companion: text(student.DepartureCompanionNote),
		},
	}
	if student.GroupID != nil {
		current.GroupID = *student.GroupID
	}
	for day, mode := range student.DepartureDays {
		current.Plan.Days[day] = string(mode)
	}
	for day, modes := range student.AllowedDepartureModes {
		names := make([]string, 0, len(modes))
		for _, mode := range modes {
			names = append(names, string(mode))
		}
		slices.Sort(names)
		if len(names) > 0 {
			current.Plan.Allowed[day] = names
		}
	}
	return readstate.Fingerprint(current)
}

// StudentRecordEdits is the lock the child's edit form saves under (ADR
// 0311). It stands beside the owner's facade; the child update route is its
// only caller.
type StudentRecordEdits interface {
	// LockStudentRecordForEdit locks the child's row, then its person, the
	// order every writer of a child's person takes, and compares the
	// StudentRecordVersion of the locked state with expectedVersion. It
	// returns ErrStudentNotFound for a child that is gone and
	// readstate.ErrChanged for another or an empty version; the caller
	// writes the child and the person from the returned copies in the same
	// transaction.
	LockStudentRecordForEdit(ctx context.Context, studentID int64, expectedVersion string) (StudentRecord, Person, error)
}

func text(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func chosenDays[M ~map[string]bool](days M) []string {
	chosen := make([]string, 0, len(days))
	for day, set := range days {
		if set {
			chosen = append(chosen, day)
		}
	}
	slices.Sort(chosen)
	return chosen
}

package schoolmembership

import "github.com/moto-ogs/project-phoenix/sharedkernel/readstate"

// StaffRecordVersion is the token of what the staff record form shows and
// PUT /api/staff/{id} writes back whole (ADR 0311): the person the record
// names, the notes and the caregiver profile's fields. A retired profile
// counts as none, as the record read leaves it out. The other columns of
// the staff row (employment, schedule binding, exit) have their own forms
// and do not refuse this one.
func StaffRecordVersion(staff Staff, teacher *Teacher) string {
	state := []any{staff.PersonID, staff.StaffNotes, nil}
	if teacher != nil && teacher.DeletedAt == nil {
		state[2] = []string{teacher.Specialization, teacher.Role, teacher.Qualifications}
	}
	return readstate.Fingerprint(state)
}

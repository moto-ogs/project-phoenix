package schoolstructure

import "github.com/moto-ogs/project-phoenix/sharedkernel/readstate"

// StaffSchoolClassesVersion is the token of a staff member's class
// assignments as GetStaffSchoolClasses answers them, in class order (ADR
// 0311). The read hands it out and SetStaffSchoolClasses compares it under
// the staff row lock with the assignments stored then.
func StaffSchoolClassesVersion(classes []string) string {
	if classes == nil {
		classes = []string{}
	}
	return readstate.Fingerprint(classes)
}

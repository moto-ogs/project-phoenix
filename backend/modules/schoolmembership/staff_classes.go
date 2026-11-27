package schoolmembership

import (
	"context"
	"errors"
)

// StaffClassReads reads a person's live staff record together with the
// school classes assigned to it, in one statement (#8155). "Heute anders"
// in moto schule needs both for the Lehrkraft: the staff record for her
// Aufsichten and appointments, the classes for the Unterrichtsschluss of her
// own classes. found is false, without an error, when the person has no live
// staff record; the classes are trimmed, without empty ones and duplicates,
// in class order.
type StaffClassReads interface {
	FindStaffClassesByPerson(ctx context.Context, personID int64) (staffID int64, classes []string, found bool, err error)
}

// ErrNoStaffClassReads reports a capability composed without the read.
var ErrNoStaffClassReads = errors.New("school membership: the capability reads no staff classes")

// StaffClassReadsOf is the staff class read of the composed capability.
func StaffClassReadsOf(capability Capability) (StaffClassReads, error) {
	reads, ok := capability.(StaffClassReads)
	if !ok {
		return nil, ErrNoStaffClassReads
	}
	return reads, nil
}

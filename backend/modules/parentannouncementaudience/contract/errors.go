package contract

import "errors"

// ErrStudentNotInSchool reports a child read in a school it does not belong
// to, or one that does not exist (#4814).
var ErrStudentNotInSchool = errors.New("parent announcement audience: student is not in the school")

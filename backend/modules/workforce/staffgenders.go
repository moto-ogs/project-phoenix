package workforce

import "context"

// StaffGenderReader reads the gender of the personnel records of several
// staff members at once. The staff directory uses it to show the free-text
// position in the matching form („Betreuerin“), so the list costs one more
// read regardless of staff count. The staff employment owner
// (compose.NewStaffEmployment) implements it.
type StaffGenderReader interface {
	// StaffGenders maps staff ID -> GenderFemale, GenderMale or
	// GenderDiverse. Staff members without a stated gender are absent.
	StaffGenders(ctx context.Context, staffIDs []int64) (map[int64]string, error)
}

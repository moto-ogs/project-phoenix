package api

import (
	"context"
	"fmt"
)

// seedStaffWithGenders creates the demo staff, then writes their gender.
func (s *FixedSeeder) seedStaffWithGenders(ctx context.Context, result *FixedResult) error {
	if err := s.seedStaff(ctx, result); err != nil {
		return err
	}
	for i, staff := range DemoStaff {
		if err := s.seedStaffGender(i, staff, s.staffIDs[staff.FirstName+" "+staff.LastName]); err != nil {
			return err
		}
	}
	return nil
}

// seedStaffGender writes the demo gender into the Stammdaten. The visitor's
// own record stays without one: moto does not guess it from the name.
func (s *FixedSeeder) seedStaffGender(i int, staff DemoStaffMember, staffID int64) error {
	if staff.Gender == "" || (!s.visitor.empty() && i == visitorStaffIndex) {
		return nil
	}
	first, last := visitorDisplayName(s.visitor, i == visitorStaffIndex,
		staff.FirstName, staff.LastName, DemoStaff[visitorStaffIndex].FirstName, DemoStaff[visitorStaffIndex].LastName)
	if err := putStammdatenSection(s.client, staffID, "person", map[string]any{
		"first_name": first, "last_name": last, "gender": staff.Gender, "note": "Geschlecht ergänzt",
	}); err != nil {
		return fmt.Errorf("seed gender of %s %s: %w", staff.FirstName, staff.LastName, err)
	}
	return nil
}

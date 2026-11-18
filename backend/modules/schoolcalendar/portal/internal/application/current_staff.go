package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal/internal/ports"
)

// currentStaff resolves the caller's staff profile for staff-only calendar
// operations. A caller without a staff profile in this school is refused with
// ErrNoStaffProfile; a failed lookup stays a server fault instead of hiding
// behind a refusal (#7306).
func (s *service) currentStaff(ctx context.Context) (*ports.Staff, error) {
	staff, err := s.cfg.UserContext.GetCurrentStaff(ctx)
	if err != nil {
		// No signed-in account is no missing profile; it keeps the generic
		// refusal it had before.
		if s.cfg.UserContext.MissingUser(err) {
			return nil, fmt.Errorf("%w: current account required", ErrForbidden)
		}
		if s.cfg.UserContext.MissingStaff(err) {
			return nil, ErrNoStaffProfile
		}
		return nil, fmt.Errorf("resolve current staff: %w", err)
	}
	if staff == nil {
		return nil, ErrNoStaffProfile
	}
	return staff, nil
}
